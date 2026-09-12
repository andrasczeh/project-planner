import Dexie, { type Table } from 'dexie';
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
  }
}

export const db = new ProjectPlannerDB();

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
