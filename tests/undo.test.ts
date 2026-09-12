import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db';
import {
  initCommands,
  createProject,
  createTask,
  updateTask,
  deleteTask,
  createDependency,
  deleteDependency,
  beginTxn,
  endTxn,
  undo,
  redo,
} from '../src/commands';

async function makeProject() {
  return createProject({ name: 'P', statuses: ['todo'], defaultStatus: 'todo', customFieldDefs: [] });
}

async function makeTask(projectId: string, title = 'T') {
  return createTask({
    projectId,
    title,
    body: '',
    status: 'todo',
    labels: [],
    assigneeIds: [],
    custom: {},
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initCommands();
});

describe('undo/redo', () => {
  it('round-trips an update', async () => {
    const project = await makeProject();
    const task = await makeTask(project.id, 'Original');

    await updateTask(task.id, { title: 'Changed' });
    expect((await db.tasks.get(task.id))!.title).toBe('Changed');

    await undo();
    expect((await db.tasks.get(task.id))!.title).toBe('Original');

    await redo();
    expect((await db.tasks.get(task.id))!.title).toBe('Changed');
  });

  it('survives a reload by keeping undone entries in the log', async () => {
    const project = await makeProject();
    const task = await makeTask(project.id, 'Original');
    await updateTask(task.id, { title: 'Changed' });
    await undo();

    // Simulate a fresh page load: the redo branch must still be on disk.
    await db.close();
    await db.open();
    await initCommands();

    await redo();
    expect((await db.tasks.get(task.id))!.title).toBe('Changed');
  });

  it('undoes a create by removing the record', async () => {
    const project = await makeProject();
    const task = await makeTask(project.id, 'Temp');

    await undo();
    expect(await db.tasks.get(task.id)).toBeUndefined();

    await redo();
    expect((await db.tasks.get(task.id))!.title).toBe('Temp');
  });

  it('restores a soft-deleted task', async () => {
    const project = await makeProject();
    const task = await makeTask(project.id, 'Keep me');

    await deleteTask(task.id);
    expect((await db.tasks.get(task.id))!.deleted).toBe(true);

    await undo();
    expect((await db.tasks.get(task.id))!.deleted).toBeFalsy();
  });

  it('restores a hard-deleted dependency', async () => {
    const project = await makeProject();
    const a = await makeTask(project.id, 'A');
    const b = await makeTask(project.id, 'B');
    const dep = await createDependency({ fromId: a.id, toId: b.id, type: 'FS', lagDays: 2 });

    await deleteDependency(dep.id);
    expect(await db.dependencies.get(dep.id)).toBeUndefined();

    await undo();
    const restored = await db.dependencies.get(dep.id);
    expect(restored).toBeTruthy();
    expect(restored!.fromId).toBe(a.id);
    expect(restored!.lagDays).toBe(2);

    await redo();
    expect(await db.dependencies.get(dep.id)).toBeUndefined();
  });

  it('collapses a transaction into one undo step', async () => {
    const project = await makeProject();
    const task = await makeTask(project.id, 'Drag me');
    await updateTask(task.id, { start: '2026-01-01', end: '2026-01-05' });

    // Mimic a Gantt drag: many updates between beginTxn and endTxn.
    beginTxn();
    for (let day = 2; day <= 20; day++) {
      const d = String(day).padStart(2, '0');
      await updateTask(task.id, { start: `2026-01-${d}`, end: `2026-01-${d}` });
    }
    await endTxn();

    expect((await db.tasks.get(task.id))!.start).toBe('2026-01-20');

    // A single undo must return to the pre-drag position, not step back one day.
    await undo();
    const afterUndo = await db.tasks.get(task.id);
    expect(afterUndo!.start).toBe('2026-01-01');
    expect(afterUndo!.end).toBe('2026-01-05');

    await redo();
    expect((await db.tasks.get(task.id))!.start).toBe('2026-01-20');
  });

  it('discards the redo branch when a new edit lands', async () => {
    const project = await makeProject();
    const task = await makeTask(project.id, 'Original');

    await updateTask(task.id, { title: 'First' });
    await undo();
    await updateTask(task.id, { title: 'Second' });

    expect(await redo()).toBeNull();
    expect((await db.tasks.get(task.id))!.title).toBe('Second');
  });

  it('reports nothing to undo on an empty log', async () => {
    expect(await undo()).toBeNull();
    expect(await redo()).toBeNull();
  });
});
