import { db } from '../db';
import {
  exportForSync,
  computeDeviceDiffs,
  resolveOps,
  applySyncOps,
  type DeviceSyncPayload,
} from './device-sync';
import { connectViaTracker, type TrackerHandle } from './tracker';
import type { SyncPeer } from './webrtc';

const SYNCED_TABLES = ['projects', 'tasks', 'dependencies', 'milestones', 'people'] as const;
type SyncTable = typeof SYNCED_TABLES[number];

interface SyncChange {
  table: SyncTable;
  id: string;
  record: Record<string, unknown> | null;
}

export type SessionStatus = 'connected' | 'syncing' | 'searching' | 'disconnected';

export interface SyncDetails {
  status: SessionStatus;
  connectedSince: number | null;
  lastSyncAt: number | null;
  pendingChanges: number;
  totalSent: number;
  totalReceived: number;
  autoReconnect: boolean;
}

const listeners = new Set<() => void>();
let active: SyncSession | null = null;
let trackerHandle: TrackerHandle | null = null;

export function getSession(): SyncSession | null {
  return active;
}

export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach(fn => fn());
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function isAutoReconnectEnabled(): Promise<boolean> {
  const entry = await db.meta.get('syncRoomCode');
  return !!entry?.value;
}

export async function tryAutoReconnect(): Promise<void> {
  if (active || trackerHandle) return;
  const entry = await db.meta.get('syncRoomCode');
  const roomCode = entry?.value as string | undefined;
  if (!roomCode) return;

  _status = 'searching';
  notify();

  trackerHandle = connectViaTracker(roomCode);
  trackerHandle.onPeer = (peer, isHost) => {
    trackerHandle = null;
    initSyncExchange(peer, isHost);
  };
}

export function stopAutoReconnect(): void {
  trackerHandle?.close();
  trackerHandle = null;
  if (_status === 'searching') {
    _status = 'disconnected';
    notify();
  }
}

let _status: SessionStatus = 'disconnected';

export function getGlobalStatus(): SessionStatus {
  if (active) return active.status;
  return _status;
}

export function getDetails(): SyncDetails {
  if (active) return active.details;
  return {
    status: _status,
    connectedSince: null,
    lastSyncAt: null,
    pendingChanges: 0,
    totalSent: 0,
    totalReceived: 0,
    autoReconnect: false,
  };
}

async function initSyncExchange(peer: SyncPeer, isHost: boolean): Promise<void> {
  _status = 'syncing';
  notify();

  const localData = await exportForSync();

  peer.onMessage = async (raw: string) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'data') {
        if (isHost) {
          const diffs = computeDeviceDiffs(localData, msg.payload);
          const { localOps, remoteOps } = resolveOps(diffs, localData, msg.payload);
          await applySyncOps(localOps);
          await peer.send(JSON.stringify({ type: 'result', ops: remoteOps }));
          const state = await exportForSync();
          new SyncSession(peer, state);
        }
      } else if (msg.type === 'result') {
        await applySyncOps(msg.ops);
        await peer.send(JSON.stringify({ type: 'done' })).catch(() => {});
        const state = await exportForSync();
        new SyncSession(peer, state);
      }
    } catch (err) {
      console.error('Auto-reconnect exchange error', err);
      peer.close();
      _status = 'disconnected';
      notify();
    }
  };

  peer.send(JSON.stringify({ type: 'data', payload: localData })).catch(() => {
    peer.close();
    _status = 'disconnected';
    notify();
  });
}

export class SyncSession {
  private peer: SyncPeer;
  private lastState: DeviceSyncPayload;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _status: SessionStatus = 'connected';
  private applying = false;
  private _connectedSince = Date.now();
  private _lastSyncAt: number | null = null;
  private _pendingChanges = 0;
  private _totalSent = 0;
  private _totalReceived = 0;
  private _autoReconnect = false;

  constructor(peer: SyncPeer, initialState: DeviceSyncPayload) {
    this.peer = peer;
    this.lastState = initialState;

    isAutoReconnectEnabled().then(v => { this._autoReconnect = v; });

    peer.onStateChange = (state) => {
      if (state === 'closed' || state === 'failed') {
        this._status = 'disconnected';
        this.stopTimer();
        active = null;
        notify();
        tryAutoReconnect();
      }
    };

    peer.onMessage = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'changes') this.applyIncoming(msg.changes);
        else if (msg.type === 'auto-reconnect') this.storeRoomCode(msg.roomCode);
        else if (msg.type === 'auto-reconnect-off') this.clearRoomCode();
      } catch (err) {
        console.error('Sync message error', err);
      }
    };

    this.timer = setInterval(() => this.tick(), 3000);
    active = this;
    _status = 'connected';
    notify();
  }

  get status() {
    return this._status;
  }

  get details(): SyncDetails {
    return {
      status: this._status,
      connectedSince: this._connectedSince,
      lastSyncAt: this._lastSyncAt,
      pendingChanges: this._pendingChanges,
      totalSent: this._totalSent,
      totalReceived: this._totalReceived,
      autoReconnect: this._autoReconnect,
    };
  }

  disconnect() {
    this.peer.close();
    this.stopTimer();
    this._status = 'disconnected';
    active = null;
    stopAutoReconnect();
    notify();
  }

  async enableAutoReconnect(): Promise<string> {
    const roomCode = randomHex(20);
    await db.meta.put({ key: 'syncRoomCode', value: roomCode });
    await this.peer.send(JSON.stringify({ type: 'auto-reconnect', roomCode }));
    this._autoReconnect = true;
    notify();
    return roomCode;
  }

  async disableAutoReconnect(): Promise<void> {
    await db.meta.delete('syncRoomCode');
    await this.peer.send(JSON.stringify({ type: 'auto-reconnect-off' }));
    this._autoReconnect = false;
    notify();
  }

  private async storeRoomCode(roomCode: string) {
    await db.meta.put({ key: 'syncRoomCode', value: roomCode });
  }

  private async clearRoomCode() {
    await db.meta.delete('syncRoomCode');
  }

  private stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this._status !== 'connected' || this.applying) return;

    try {
      const current = await exportForSync();
      const changes = findChanges(this.lastState, current);
      this._pendingChanges = changes.length;

      if (changes.length === 0) {
        notify();
        return;
      }

      this._status = 'syncing';
      notify();

      await this.peer.send(JSON.stringify({ type: 'changes', changes }));
      this._totalSent += changes.length;
      this._lastSyncAt = Date.now();
      this._pendingChanges = 0;
      this.lastState = current;

      this._status = 'connected';
      notify();
    } catch (err) {
      console.error('Auto-sync tick error', err);
    }
  }

  private async applyIncoming(changes: SyncChange[]) {
    this.applying = true;
    try {
      await db.transaction('rw', [db.projects, db.tasks, db.dependencies, db.milestones, db.people], async () => {
        for (const c of changes) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tbl = db[c.table] as any;
          if (c.record) await tbl.put(c.record);
          else await tbl.delete(c.id);
        }
      });
      this._totalReceived += changes.length;
      this._lastSyncAt = Date.now();
      this.lastState = await exportForSync();
      notify();
    } catch (err) {
      console.error('Apply incoming error', err);
    }
    this.applying = false;
  }
}

function findChanges(last: DeviceSyncPayload, current: DeviceSyncPayload): SyncChange[] {
  const changes: SyncChange[] = [];
  for (const table of SYNCED_TABLES) {
    const prev = new Map(last.tables[table].map(r => [r.id as string, r]));
    const now = new Map(current.tables[table].map(r => [r.id as string, r]));

    for (const [id, record] of now) {
      const old = prev.get(id);
      if (!old || JSON.stringify(old) !== JSON.stringify(record)) {
        changes.push({ table, id, record });
      }
    }
    for (const id of prev.keys()) {
      if (!now.has(id)) changes.push({ table, id, record: null });
    }
  }
  return changes;
}
