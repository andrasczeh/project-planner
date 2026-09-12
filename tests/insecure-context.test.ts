import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, getDeviceId } from '../src/db';
import { initCommands, createProject, createTask, undo } from '../src/commands';

/**
 * Safari over plain http (e.g. http://amd-ai) is an insecure context, where
 * crypto.randomUUID is undefined. Nothing on the startup path may depend on it.
 */
const realRandomUUID = globalThis.crypto?.randomUUID;

beforeEach(async () => {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: undefined,
  });
  await db.delete();
  await db.open();
});

afterEach(() => {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: realRandomUUID,
  });
});

describe('insecure context (no crypto.randomUUID)', () => {
  it('provisions a device id', async () => {
    await expect(getDeviceId()).resolves.toBeTruthy();
  });

  it('boots and records undoable edits', async () => {
    await initCommands();

    const project = await createProject({
      name: 'P', statuses: ['todo'], defaultStatus: 'todo', customFieldDefs: [],
    });
    const task = await createTask({
      projectId: project.id, title: 'Original', body: '', status: 'todo',
      labels: [], assigneeIds: [], custom: {},
    });

    const entries = await db.oplog.toArray();
    expect(entries.every(e => !!e.txnId)).toBe(true);

    await undo();
    expect(await db.tasks.get(task.id)).toBeUndefined();
  });
});
