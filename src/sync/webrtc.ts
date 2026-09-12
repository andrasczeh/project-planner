import { deflateSync, inflateSync } from 'fflate';

interface PeerSignal {
  s: string;
  c: RTCIceCandidateInit[];
}

function uint8ToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlToUint8(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function stripSDP(sdp: string): string {
  return sdp
    .split('\r\n')
    .filter(l => !l.startsWith('a=extmap-allow-mixed') && !l.startsWith('a=msid-semantic'))
    .join('\r\n');
}

export function encodeSignal(signal: PeerSignal): string {
  const json = JSON.stringify(signal);
  const compressed = deflateSync(new TextEncoder().encode(json));
  return uint8ToBase64url(compressed);
}

export function decodeSignal(encoded: string): PeerSignal {
  const bytes = base64urlToUint8(encoded);
  const decompressed = inflateSync(bytes);
  return JSON.parse(new TextDecoder().decode(decompressed));
}

const CHUNK_SIZE = 16 * 1024;

export type ConnectionState = 'connecting' | 'open' | 'closed' | 'failed';

export interface SyncPeer {
  send(data: string): Promise<void>;
  onMessage: ((data: string) => void) | null;
  onStateChange: ((state: ConnectionState) => void) | null;
  close(): void;
  state: ConnectionState;
}

async function sendChunked(dc: RTCDataChannel, data: string): Promise<void> {
  dc.send(`SYNC:${data.length}\n`);
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    while (dc.bufferedAmount > CHUNK_SIZE * 8) {
      await new Promise(r => setTimeout(r, 10));
    }
    dc.send(data.slice(i, i + CHUNK_SIZE));
  }
  dc.send('SYNC:END');
}

function setupReceiver(dc: RTCDataChannel, onComplete: (data: string) => void): void {
  let buffer = '';
  let receiving = false;

  dc.onmessage = (e) => {
    const msg = e.data as string;
    if (!receiving && msg.startsWith('SYNC:') && msg.endsWith('\n')) {
      buffer = '';
      receiving = true;
      return;
    }
    if (msg === 'SYNC:END') {
      if (receiving) {
        receiving = false;
        onComplete(buffer);
        buffer = '';
      }
      return;
    }
    if (receiving) buffer += msg;
  };
}

export function makePeer(pc: RTCPeerConnection): SyncPeer {
  const peer: SyncPeer = {
    onMessage: null,
    onStateChange: null,
    state: 'connecting',
    send: async () => {},
    close() {
      pc.close();
      peer.state = 'closed';
      peer.onStateChange?.('closed');
    },
  };
  return peer;
}

export function wireDC(dc: RTCDataChannel, peer: SyncPeer): void {
  setupReceiver(dc, (data) => peer.onMessage?.(data));
  peer.send = (data: string) => sendChunked(dc, data);
  dc.onopen = () => { peer.state = 'open'; peer.onStateChange?.('open'); };
  dc.onclose = () => { peer.state = 'closed'; peer.onStateChange?.('closed'); };
  dc.onerror = () => { peer.state = 'failed'; peer.onStateChange?.('failed'); };
}

async function gatherCandidates(pc: RTCPeerConnection): Promise<RTCIceCandidateInit[]> {
  const candidates: RTCIceCandidateInit[] = [];
  return new Promise(resolve => {
    pc.onicecandidate = (e) => {
      if (e.candidate) candidates.push(e.candidate.toJSON());
      else resolve(candidates);
    };
    setTimeout(() => resolve(candidates), 3000);
  });
}

export async function createHost(): Promise<{
  peer: SyncPeer;
  getSignal: () => Promise<string>;
  acceptAnswer: (answerSignal: string) => Promise<void>;
}> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('sync', { ordered: true });
  const peer = makePeer(pc);
  wireDC(dc, peer);

  const candidatesPromise = gatherCandidates(pc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  return {
    peer,
    async getSignal() {
      const candidates = await candidatesPromise;
      return encodeSignal({ s: stripSDP(pc.localDescription!.sdp), c: candidates });
    },
    async acceptAnswer(answerSignal: string) {
      const signal = decodeSignal(answerSignal);
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.s });
      for (const c of signal.c) await pc.addIceCandidate(c);
    },
  };
}

export async function joinPeer(offerSignal: string): Promise<{
  peer: SyncPeer;
  getSignal: () => Promise<string>;
}> {
  const offer = decodeSignal(offerSignal);
  const pc = new RTCPeerConnection({ iceServers: [] });
  const peer = makePeer(pc);

  pc.ondatachannel = (e) => wireDC(e.channel, peer);

  const candidatesPromise = gatherCandidates(pc);
  await pc.setRemoteDescription({ type: 'offer', sdp: offer.s });
  for (const c of offer.c) await pc.addIceCandidate(c);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  return {
    peer,
    async getSignal() {
      const candidates = await candidatesPromise;
      return encodeSignal({ s: stripSDP(pc.localDescription!.sdp), c: candidates });
    },
  };
}
