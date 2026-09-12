import { db } from '../db';
import { exportForSync, type DeviceSyncPayload } from './device-sync';
import type { SyncPeer } from './webrtc';

const SYNCED_TABLES = ['projects', 'tasks', 'dependencies', 'milestones', 'people'] as const;
type SyncTable = typeof SYNCED_TABLES[number];

interface SyncChange {
  table: SyncTable;
  id: string;
  record: Record<string, unknown> | null;
}

export type SessionStatus = 'connected' | 'syncing' | 'disconnected';

const listeners = new Set<() => void>();
let active: SyncSession | null = null;

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

export class SyncSession {
  private peer: SyncPeer;
  private lastState: DeviceSyncPayload;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _status: SessionStatus = 'connected';
  private applying = false;

  constructor(peer: SyncPeer, initialState: DeviceSyncPayload) {
    this.peer = peer;
    this.lastState = initialState;

    peer.onStateChange = (state) => {
      if (state === 'closed' || state === 'failed') {
        this._status = 'disconnected';
        this.stopTimer();
        active = null;
        notify();
      }
    };

    peer.onMessage = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'changes') this.applyIncoming(msg.changes);
      } catch (err) {
        console.error('Sync message error', err);
      }
    };

    this.timer = setInterval(() => this.tick(), 3000);
    active = this;
    notify();
  }

  get status() {
    return this._status;
  }

  disconnect() {
    this.peer.close();
    this.stopTimer();
    this._status = 'disconnected';
    active = null;
    notify();
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
      if (changes.length === 0) return;

      this._status = 'syncing';
      notify();

      await this.peer.send(JSON.stringify({ type: 'changes', changes }));
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
      this.lastState = await exportForSync();
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
