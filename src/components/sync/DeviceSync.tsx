import { useState, useRef, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { createHost, joinPeer, type SyncPeer } from '../../sync/webrtc';
import {
  exportForSync,
  computeDeviceDiffs,
  resolveOps,
  applySyncOps,
  type DeviceSyncPayload,
} from '../../sync/device-sync';
import { DiffPreview } from './DiffPreview';
import type { RecordDiff } from '../../sync/diff';

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

type SyncState =
  | { step: 'choose' }
  | { step: 'host-generating' }
  | { step: 'host-offer'; signal: string; qrUrl: string }
  | { step: 'host-scan' }
  | { step: 'join-scanning' }
  | { step: 'join-generating' }
  | { step: 'join-answer'; signal: string; qrUrl: string }
  | { step: 'connecting' }
  | { step: 'exchanging' }
  | { step: 'waiting-for-host' }
  | { step: 'reviewing'; diffs: RecordDiff[]; local: DeviceSyncPayload; remote: DeviceSyncPayload }
  | { step: 'no-changes' }
  | { step: 'done'; count: number }
  | { step: 'error'; message: string };

interface Props {
  onClose: () => void;
}

export function DeviceSync({ onClose }: Props) {
  const [state, setState] = useState<SyncState>({ step: 'choose' });
  const peerRef = useRef<SyncPeer | null>(null);
  const hostCtx = useRef<Awaited<ReturnType<typeof createHost>> | null>(null);
  const localDataRef = useRef<DeviceSyncPayload | null>(null);
  const remoteDataRef = useRef<DeviceSyncPayload | null>(null);
  const roleRef = useRef<'host' | 'join'>('host');

  const cleanup = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    hostCtx.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleError = useCallback((msg: string) => {
    cleanup();
    setState({ step: 'error', message: msg });
  }, [cleanup]);

  const onConnected = useCallback(async (peer: SyncPeer) => {
    peerRef.current = peer;
    setState({ step: 'exchanging' });

    const localData = await exportForSync();
    localDataRef.current = localData;

    peer.onMessage = (raw: string) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'data') {
          remoteDataRef.current = msg.payload as DeviceSyncPayload;
          if (roleRef.current === 'host') {
            const diffs = computeDeviceDiffs(localData, msg.payload);
            if (diffs.length === 0) {
              peer.send(JSON.stringify({ type: 'result', ops: { puts: [] } })).catch(() => {});
              setState({ step: 'no-changes' });
            } else {
              setState({ step: 'reviewing', diffs, local: localData, remote: msg.payload });
            }
          } else {
            setState({ step: 'waiting-for-host' });
          }
        } else if (msg.type === 'result') {
          applySyncOps(msg.ops).then(count => {
            peer.send(JSON.stringify({ type: 'done' })).catch(() => {});
            if (count === 0 && msg.ops.puts.length === 0) {
              setState({ step: 'no-changes' });
            } else {
              setState({ step: 'done', count });
            }
          });
        } else if (msg.type === 'done') {
          // Host received confirmation from joiner
        }
      } catch (err) {
        handleError(`Failed to process sync data: ${(err as Error).message}`);
      }
    };

    peer.send(JSON.stringify({ type: 'data', payload: localData })).catch(err => {
      handleError(`Failed to send data: ${(err as Error).message}`);
    });
  }, [handleError]);

  const startHost = useCallback(async () => {
    roleRef.current = 'host';
    setState({ step: 'host-generating' });
    try {
      const ctx = await createHost();
      hostCtx.current = ctx;
      ctx.peer.onStateChange = (s) => {
        if (s === 'open') onConnected(ctx.peer);
        if (s === 'failed') handleError('Connection failed');
      };
      const signal = await ctx.getSignal();
      const qrUrl = await QRCode.toDataURL(signal, { errorCorrectionLevel: 'L', margin: 2, width: 280 });
      setState({ step: 'host-offer', signal, qrUrl });
    } catch (err) {
      handleError(`Failed to create host: ${(err as Error).message}`);
    }
  }, [onConnected, handleError]);

  const hostAcceptAnswer = useCallback(async (answerSignal: string) => {
    setState({ step: 'connecting' });
    try {
      await hostCtx.current!.acceptAnswer(answerSignal);
    } catch (err) {
      handleError(`Invalid answer code: ${(err as Error).message}`);
    }
  }, [handleError]);

  const startJoin = useCallback(() => {
    roleRef.current = 'join';
    setState({ step: 'join-scanning' });
  }, []);

  const joinWithOffer = useCallback(async (offerSignal: string) => {
    setState({ step: 'join-generating' });
    try {
      const ctx = await joinPeer(offerSignal);
      ctx.peer.onStateChange = (s) => {
        if (s === 'open') onConnected(ctx.peer);
        if (s === 'failed') handleError('Connection failed');
      };
      const signal = await ctx.getSignal();
      const qrUrl = await QRCode.toDataURL(signal, { errorCorrectionLevel: 'L', margin: 2, width: 280 });
      setState({ step: 'join-answer', signal, qrUrl });
    } catch (err) {
      handleError(`Invalid host code: ${(err as Error).message}`);
    }
  }, [onConnected, handleError]);

  const handleResolve = useCallback((di: number, fi: number, resolution: 'local' | 'remote') => {
    setState(prev => {
      if (prev.step !== 'reviewing') return prev;
      const diffs = [...prev.diffs];
      diffs[di] = {
        ...diffs[di],
        fields: diffs[di].fields.map((f, i) => i === fi ? { ...f, resolution } : f),
      };
      const hasConflicts = diffs.some(d => d.fields.some(f => !f.resolution));
      if (!hasConflicts) {
        for (const d of diffs) {
          const allLocal = d.fields.every(f => f.resolution === 'local');
          const allRemote = d.fields.every(f => f.resolution === 'remote');
          d.status = allLocal ? 'push' : allRemote ? 'pull' : 'conflict';
        }
      }
      return { ...prev, diffs };
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (state.step !== 'reviewing') return;
    const { diffs, local, remote } = state;
    const { localOps, remoteOps } = resolveOps(diffs, local, remote);

    const localCount = await applySyncOps(localOps);
    const peer = peerRef.current;
    if (peer) {
      await peer.send(JSON.stringify({ type: 'result', ops: remoteOps }));
    }
    setState({ step: 'done', count: localCount + remoteOps.puts.length });
  }, [state]);

  const handleClose = useCallback(() => {
    cleanup();
    onClose();
  }, [cleanup, onClose]);

  return (
    <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Device Sync</h2>
        <button className="btn-icon" onClick={handleClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {state.step === 'choose' && (
        <ChooseStep onHost={startHost} onJoin={startJoin} />
      )}

      {state.step === 'host-generating' && (
        <StatusMessage text="Generating connection code..." />
      )}

      {state.step === 'host-offer' && (
        <HostOfferStep
          qrUrl={state.qrUrl}
          signal={state.signal}
          onScanAnswer={() => setState({ step: 'host-scan' })}
        />
      )}

      {state.step === 'host-scan' && (
        <ScanStep label="Scan the answer QR from the other device" onScan={hostAcceptAnswer} onBack={() => {
          if (hostCtx.current) {
            hostCtx.current.getSignal().then(async signal => {
              const qrUrl = await QRCode.toDataURL(signal, { errorCorrectionLevel: 'L', margin: 2, width: 280 });
              setState({ step: 'host-offer', signal, qrUrl });
            });
          }
        }} />
      )}

      {state.step === 'join-scanning' && (
        <ScanStep label="Scan the QR code on the host device" onScan={joinWithOffer} onBack={() => setState({ step: 'choose' })} />
      )}

      {state.step === 'join-generating' && (
        <StatusMessage text="Generating answer..." />
      )}

      {state.step === 'join-answer' && (
        <JoinAnswerStep qrUrl={state.qrUrl} signal={state.signal} />
      )}

      {state.step === 'connecting' && (
        <StatusMessage text="Connecting..." />
      )}

      {state.step === 'exchanging' && (
        <StatusMessage text="Exchanging data..." />
      )}

      {state.step === 'waiting-for-host' && (
        <StatusMessage text="Waiting for host to review changes..." />
      )}

      {state.step === 'reviewing' && (
        <div>
          <DiffPreview
            diffs={state.diffs}
            onResolve={handleResolve}
            onConfirm={handleConfirm}
            onCancel={handleClose}
          />
        </div>
      )}

      {state.step === 'no-changes' && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>&#10003;</div>
          <h3>Already in sync</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>Both devices have the same data.</p>
          <button className="btn btn-primary" onClick={handleClose}>Done</button>
        </div>
      )}

      {state.step === 'done' && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>&#10003;</div>
          <h3>Sync Complete</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
            {state.count} {state.count === 1 ? 'record' : 'records'} synchronized.
          </p>
          <button className="btn btn-primary" onClick={handleClose}>Done</button>
        </div>
      )}

      {state.step === 'error' && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>!</div>
          <h3>Sync Failed</h3>
          <p style={{ color: 'var(--danger)', marginBottom: '16px' }}>{state.message}</p>
          <div className="toolbar" style={{ justifyContent: 'center' }}>
            <button className="btn btn-secondary" onClick={() => setState({ step: 'choose' })}>Try Again</button>
            <button className="btn btn-secondary" onClick={handleClose}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChooseStep({ onHost, onJoin }: { onHost: () => void; onJoin: () => void }) {
  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '13px' }}>
        Sync data between two devices on the same network.
        One device hosts the session, the other joins by scanning a QR code.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <button className="btn btn-primary" onClick={onHost} style={{ padding: '16px' }}>
          <strong>Host Session</strong>
          <br />
          <span style={{ fontSize: '12px', opacity: 0.8 }}>Show a QR code for the other device to scan</span>
        </button>
        <button className="btn btn-secondary" onClick={onJoin} style={{ padding: '16px' }}>
          <strong>Join Session</strong>
          <br />
          <span style={{ fontSize: '12px', opacity: 0.8 }}>Scan the QR code from the host device</span>
        </button>
      </div>
    </div>
  );
}

function StatusMessage({ text }: { text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <div className="spinner" style={{ margin: '0 auto 12px' }} />
      <p style={{ color: 'var(--text-secondary)' }}>{text}</p>
    </div>
  );
}

function HostOfferStep({ qrUrl, signal, onScanAnswer }: {
  qrUrl: string;
  signal: string;
  onScanAnswer: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(signal);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = signal;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '13px', textAlign: 'center' }}>
        Scan this code from the other device, then scan its answer code.
      </p>
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <img src={qrUrl} alt="Connection QR code" style={{ maxWidth: '280px', borderRadius: '8px' }} />
      </div>
      <div className="toolbar" style={{ justifyContent: 'center', marginBottom: '16px' }}>
        <button className="btn btn-sm btn-secondary" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy code'}
        </button>
      </div>
      <button className="btn btn-primary" onClick={onScanAnswer} style={{ width: '100%' }}>
        Scan Answer Code
      </button>
    </div>
  );
}

function JoinAnswerStep({ qrUrl, signal }: { qrUrl: string; signal: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(signal);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = signal;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '13px', textAlign: 'center' }}>
        Show this code to the host device.
      </p>
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <img src={qrUrl} alt="Answer QR code" style={{ maxWidth: '280px', borderRadius: '8px' }} />
      </div>
      <div className="toolbar" style={{ justifyContent: 'center', marginBottom: '12px' }}>
        <button className="btn btn-sm btn-secondary" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy code'}
        </button>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 8px' }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Waiting for host to connect...</p>
      </div>
    </div>
  );
}

function ScanStep({ label, onScan, onBack }: {
  label: string;
  onScan: (data: string) => void;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [hasCamera, setHasCamera] = useState(true);
  const [pasteValue, setPasteValue] = useState('');
  const scannedRef = useRef(false);

  useEffect(() => {
    let stopped = false;

    const start = async () => {
      const hasBarcodeDetector = 'BarcodeDetector' in window;
      if (!hasBarcodeDetector) {
        setHasCamera(false);
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch {
        setHasCamera(false);
        return;
      }
      if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const detector = new BarcodeDetector({ formats: ['qr_code'] });

      const scan = async () => {
        if (stopped || scannedRef.current || !video) return;
        try {
          const results = await detector.detect(video);
          if (results.length > 0 && !scannedRef.current) {
            scannedRef.current = true;
            stream.getTracks().forEach(t => t.stop());
            onScan(results[0].rawValue);
            return;
          }
        } catch { /* frame not ready */ }
        if (!stopped) requestAnimationFrame(scan);
      };

      requestAnimationFrame(scan);
    };

    start();

    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [onScan]);

  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '13px', textAlign: 'center' }}>
        {label}
      </p>
      {hasCamera ? (
        <div style={{ position: 'relative', marginBottom: '16px', borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
          <video
            ref={videoRef}
            style={{ width: '100%', display: 'block' }}
            playsInline
            muted
          />
          <div style={{
            position: 'absolute',
            inset: '20%',
            border: '2px solid rgba(255,255,255,0.5)',
            borderRadius: '12px',
            pointerEvents: 'none',
          }} />
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '13px' }}>
          Camera not available. Paste the code below instead.
        </p>
      )}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <input
          className="form-input"
          type="text"
          value={pasteValue}
          onChange={e => setPasteValue(e.target.value)}
          placeholder="Or paste code here..."
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-primary"
          onClick={() => pasteValue.trim() && onScan(pasteValue.trim())}
          disabled={!pasteValue.trim()}
        >
          Go
        </button>
      </div>
      <button className="btn btn-secondary" onClick={onBack} style={{ width: '100%' }}>Back</button>
    </div>
  );
}
