import { describe, it, expect } from 'vitest';
import { encodeSignal, decodeSignal } from '../src/sync/webrtc';

describe('signal encoding', () => {
  it('round-trips a signal through encode/decode', () => {
    const signal = {
      s: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
      c: [
        { candidate: 'candidate:1 1 udp 2122194687 192.168.1.100 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      ],
    };
    const encoded = encodeSignal(signal);
    const decoded = decodeSignal(encoded);
    expect(decoded.s).toBe(signal.s);
    expect(decoded.c).toEqual(signal.c);
  });

  it('produces a reasonably compact encoding', () => {
    const signal = {
      s: 'v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:abcd\r\na=ice-pwd:abcdefghijklmnopqrstuvwx\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n',
      c: [
        { candidate: 'candidate:842163049 1 udp 2122194687 192.168.1.100 54321 typ host generation 0 ufrag abcd network-id 1', sdpMid: '0', sdpMLineIndex: 0 },
      ],
    };
    const encoded = encodeSignal(signal);
    const rawJson = JSON.stringify(signal);
    // Compressed + base64 should be smaller than uncompressed JSON
    expect(encoded.length).toBeLessThan(rawJson.length);
  });
});
