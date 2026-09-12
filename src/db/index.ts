import Dexie, { type Table } from 'dexie';
import { generateId } from '../utils/id';
import type {
  Project,
  Task,
  Dependency,
  Milestone,
  Person,
  ProviderRef,
  SyncBase,
  OpLogEntry,
  SecretEntry,
  HandleEntry,
  MetaEntry,
  Snapshot,
} from '../types';

export class ProjectPlannerDB extends Dexie {
  projects!: Table<Project, string>;
  tasks!: Table<Task, string>;
  dependencies!: Table<Dependency, string>;
  milestones!: Table<Milestone, string>;
  people!: Table<Person, string>;
  providerRefs!: Table<ProviderRef, [string, string, string]>;
  syncBase!: Table<SyncBase, string>;
  oplog!: Table<OpLogEntry, number>;
  secrets!: Table<SecretEntry, string>;
  handles!: Table<HandleEntry, string>;
  meta!: Table<MetaEntry, string>;
  snapshots!: Table<Snapshot, string>;

  constructor() {
    super('ProjectPlanner');

    this.version(1).stores({
      projects: 'id, updatedAt',
      tasks: 'id, projectId, parentId, milestoneId, *assigneeIds, *labels, start, end, updatedAt',
      dependencies: 'id, fromId, toId',
      milestones: 'id, projectId, due',
      people: 'id',
      providerRefs: '[provider+kind+remoteId], localId, provider',
      syncBase: 'key',
      oplog: '++seq, [entity+id], at',
      secrets: 'id',
      handles: 'id',
      meta: 'key',
    });

    this.version(2)
      .stores({
        oplog: '++seq, [entity+id], at, txnId, undone',
        snapshots: 'id, createdAt',
      })
      .upgrade(async tx => {
        // Pre-v2 entries predate transaction grouping: give each its own txn so
        // they stay individually undoable under the new model. A malformed row
        // must not fail the upgrade and lock the user out of their data.
        try {
          await tx.table('oplog').toCollection().modify((entry: OpLogEntry) => {
            entry.txnId ??= `legacy-${entry.seq}`;
            entry.deviceId ??= 'legacy';
            entry.lamport ??= entry.seq ?? 0;
            entry.undone ??= 0;
          });
        } catch (err) {
          console.error('Could not backfill oplog; clearing undo history', err);
          await tx.table('oplog').clear();
        }
      });
  }
}

export const db = new ProjectPlannerDB();

let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const existing = await db.meta.get('deviceId');
  if (existing?.value) {
    cachedDeviceId = existing.value as string;
    return cachedDeviceId;
  }
  const id = generateId();
  await db.meta.put({ key: 'deviceId', value: id });
  cachedDeviceId = id;
  return id;
}

export async function nextLamport(): Promise<number> {
  const entry = await db.meta.get('lamport');
  const next = ((entry?.value as number) ?? 0) + 1;
  await db.meta.put({ key: 'lamport', value: next });
  return next;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist();
  }
  return false;
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  }
  return null;
}
