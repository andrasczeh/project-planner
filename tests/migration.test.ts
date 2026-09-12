import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db';
import { initCommands, undo } from '../src/commands';

/** Recreates a v1 database (Dexie v1 == IndexedDB version 10) holding real user data. */
async function seedV1Database() {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('ProjectPlanner', 10);
    req.onupgradeneeded = () => {
      const idb = req.result;
      idb.createObjectStore('projects', { keyPath: 'id' });
      idb.createObjectStore('tasks', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      idb.createObjectStore('dependencies', { keyPath: 'id' });
      idb.createObjectStore('milestones', { keyPath: 'id' });
      idb.createObjectStore('people', { keyPath: 'id' });
      idb.createObjectStore('providerRefs', { keyPath: ['provider', 'kind', 'remoteId'] });
      idb.createObjectStore('syncBase', { keyPath: 'key' });
      idb.createObjectStore('oplog', { keyPath: 'seq', autoIncrement: true });
      idb.createObjectStore('secrets', { keyPath: 'id' });
      idb.createObjectStore('handles', { keyPath: 'id' });
      idb.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const idb = req.result;
      const tx = idb.transaction(['projects', 'tasks', 'oplog'], 'readwrite');
      tx.objectStore('projects').put({
        id: 'p1', name: 'Existing Project', statuses: ['todo'], defaultStatus: 'todo',
        customFieldDefs: [], updatedAt: Date.now(),
      });
      tx.objectStore('tasks').put({
        id: 't1', projectId: 'p1', title: 'Existing Task', body: '', status: 'todo',
        labels: [], assigneeIds: [], custom: {}, updatedAt: Date.now(),
      });
      // A pre-v2 oplog row: no txnId, deviceId, lamport or undone.
      tx.objectStore('oplog').put({
        entity: 'task', id: 't1', op: 'put', fields: ['title'],
        before: { title: 'Old' }, after: { title: 'Existing Task' }, at: Date.now(),
      });
      tx.oncomplete = () => { idb.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  await db.close();
  await new Promise<void>(res => {
    const del = indexedDB.deleteDatabase('ProjectPlanner');
    del.onsuccess = () => res();
    del.onerror = () => res();
    del.onblocked = () => res();
  });
});

describe('v1 -> v2 migration', () => {
  it('opens an existing v1 database without losing data', async () => {
    await seedV1Database();

    await db.open();
    await initCommands();

    expect((await db.projects.toArray()).map(p => p.name)).toEqual(['Existing Project']);
    expect((await db.tasks.toArray()).map(t => t.title)).toEqual(['Existing Task']);
  });

  it('backfills pre-v2 oplog rows so they stay undoable', async () => {
    await seedV1Database();
    await db.open();
    await initCommands();

    const entries = await db.oplog.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].txnId).toBeTruthy();
    expect(entries[0].undone).toBe(0);

    // The backfilled `undone` value must be indexed, or undo cannot find the entry.
    expect(await db.oplog.where('undone').equals(0).count()).toBe(1);

    const reverted = await undo();
    expect(reverted).not.toBeNull();
    expect((await db.tasks.get('t1'))!.title).toBe('Old');
  });
});
