import { makePeer, wireDC, type SyncPeer } from './webrtc';

const TRACKER_URL = 'wss://tracker.openwebtorrent.com';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const REANNOUNCE_MS = 30_000;
const RECONNECT_MS = 5_000;

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function waitForIce(pc: RTCPeerConnection, ms = 5000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  return new Promise(resolve => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, ms);
  });
}

export interface TrackerHandle {
  onPeer: ((peer: SyncPeer, isHost: boolean) => void) | null;
  close(): void;
}

export function connectViaTracker(roomCode: string): TrackerHandle {
  const infoHash = roomCode.slice(0, 40).padEnd(40, '0');
  const peerId = randomHex(20);
  let ws: WebSocket | null = null;
  let closed = false;
  let found = false;
  let reannounceTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const pending = new Map<string, { pc: RTCPeerConnection; peer: SyncPeer }>();

  const handle: TrackerHandle = {
    onPeer: null,
    close() {
      closed = true;
      ws?.close();
      if (reannounceTimer) clearTimeout(reannounceTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const { pc } of pending.values()) pc.close();
      pending.clear();
    },
  };

  function peerFound(peer: SyncPeer, isHost: boolean) {
    if (found) { peer.close(); return; }
    found = true;
    if (reannounceTimer) clearTimeout(reannounceTimer);
    for (const [, { pc }] of pending) pc.close();
    pending.clear();
    handle.onPeer?.(peer, isHost);
  }

  async function announce() {
    if (closed || found || !ws || ws.readyState !== WebSocket.OPEN) return;

    for (const { pc } of pending.values()) pc.close();
    pending.clear();

    const offerId = randomHex(20);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const dc = pc.createDataChannel('sync', { ordered: true });
    const peer = makePeer(pc);
    wireDC(dc, peer);
    pending.set(offerId, { pc, peer });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);

    if (closed || found) { pc.close(); return; }

    ws?.send(JSON.stringify({
      action: 'announce',
      info_hash: infoHash,
      peer_id: peerId,
      numwant: 1,
      offers: [{ offer_id: offerId, offer: { type: 'offer', sdp: pc.localDescription!.sdp } }],
    }));

    peer.onStateChange = (s) => {
      if (s === 'open') peerFound(peer, true);
    };

    reannounceTimer = setTimeout(announce, REANNOUNCE_MS);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function onOffer(msg: any) {
    if (closed || found) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = makePeer(pc);
    pc.ondatachannel = (e) => wireDC(e.channel, peer);

    await pc.setRemoteDescription({ type: 'offer', sdp: msg.offer.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);

    if (closed || found) { pc.close(); return; }

    ws?.send(JSON.stringify({
      action: 'announce',
      info_hash: infoHash,
      peer_id: peerId,
      to_peer_id: msg.peer_id,
      offer_id: msg.offer_id,
      answer: { type: 'answer', sdp: pc.localDescription!.sdp },
    }));

    peer.onStateChange = (s) => {
      if (s === 'open') peerFound(peer, false);
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function onAnswer(msg: any) {
    const entry = pending.get(msg.offer_id);
    if (!entry || closed || found) return;
    await entry.pc.setRemoteDescription({ type: 'answer', sdp: msg.answer.sdp });
  }

  function connect() {
    if (closed || found) return;
    ws = new WebSocket(TRACKER_URL);

    ws.onopen = () => { announce(); };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.offer && msg.offer_id) onOffer(msg);
        else if (msg.answer && msg.offer_id) onAnswer(msg);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      if (!closed && !found) {
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      }
    };

    ws.onerror = () => { /* onclose fires next */ };
  }

  connect();
  return handle;
}
