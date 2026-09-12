import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db';
import {
  createProject,
  createTask,
  updateTask,
  deleteTask,
  createDependency,
  createPerson,
  createMilestone,
  undo,
} from '../src/commands';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('project commands', () => {
  it('creates a project', async () => {
    const project = await createProject({
      name: 'Test Project',
      statuses: ['todo', 'done'],
      defaultStatus: 'todo',
      customFieldDefs: [],
    });
    expect(project.id).toBeTruthy();
    expect(project.name).toBe('Test Project');

    const stored = await db.projects.get(project.id);
    expect(stored).toBeTruthy();
    expect(stored!.name).toBe('Test Project');
  });
});

describe('task commands', () => {
  it('creates and retrieves a task', async () => {
    const project = await createProject({
      name: 'P',
      statuses: ['todo'],
      defaultStatus: 'todo',
      customFieldDefs: [],
    });

    const task = await createTask({
      projectId: project.id,
      title: 'My Task',
      body: '',
      status: 'todo',
      labels: ['frontend'],
      assigneeIds: [],
      custom: {},
    });

    expect(task.id).toBeTruthy();
    expect(task.title).toBe('My Task');

    const stored = await db.tasks.get(task.id);
    expect(stored!.title).toBe('My Task');
    expect(stored!.labels).toContain('frontend');
  });

  it('updates a task and writes oplog', async () => {
    const project = await createProject({
      name: 'P',
      statuses: ['todo', 'done'],
      defaultStatus: 'todo',
      customFieldDefs: [],
    });

    const task = await createTask({
      projectId: project.id,
      title: 'Before',
      body: '',
      status: 'todo',
      labels: [],
      assigneeIds: [],
      custom: {},
    });

    await updateTask(task.id, { title: 'After' });

    const updated = await db.tasks.get(task.id);
    expect(updated!.title).toBe('After');

    const ops = await db.oplog.toArray();
    expect(ops.length).toBeGreaterThanOrEqual(2);
  });

  it('soft-deletes a task', async () => {
    const project = await createProject({
      name: 'P',
      statuses: ['todo'],
      defaultStatus: 'todo',
      customFieldDefs: [],
    });

    const task = await createTask({
      projectId: project.id,
      title: 'T',
      body: '',
      status: 'todo',
      labels: [],
      assigneeIds: [],
      custom: {},
    });

    await deleteTask(task.id);
    const deleted = await db.tasks.get(task.id);
    expect(deleted!.deleted).toBe(true);
  });
});

describe('undo', () => {
  it('reverts the last operation', async () => {
    const project = await createProject({
      name: 'P',
      statuses: ['todo'],
      defaultStatus: 'todo',
      customFieldDefs: [],
    });

    const task = await createTask({
      projectId: project.id,
      title: 'Original',
      body: '',
      status: 'todo',
      labels: [],
      assigneeIds: [],
      custom: {},
    });

    await updateTask(task.id, { title: 'Changed' });
    let stored = await db.tasks.get(task.id);
    expect(stored!.title).toBe('Changed');

    await undo();
    stored = await db.tasks.get(task.id);
    expect(stored!.title).toBe('Original');
  });
});

describe('dependencies', () => {
  it('creates a dependency', async () => {
    const project = await createProject({
      name: 'P',
      statuses: ['todo'],
      defaultStatus: 'todo',
      customFieldDefs: [],
    });

    const t1 = await createTask({
      projectId: project.id,
      title: 'A',
      body: '',
      status: 'todo',
      labels: [],
      assigneeIds: [],
      custom: {},
    });

    const t2 = await createTask({
      projectId: project.id,
      title: 'B',
      body: '',
      status: 'todo',
      labels: [],
      assigneeIds: [],
      custom: {},
    });

    const dep = await createDependency({
      fromId: t1.id,
      toId: t2.id,
      type: 'FS',
      lagDays: 0,
    });

    expect(dep.fromId).toBe(t1.id);
    expect(dep.toId).toBe(t2.id);

    const stored = await db.dependencies.get(dep.id);
    expect(stored!.type).toBe('FS');
  });
});

describe('people and milestones', () => {
  it('creates a person with multi-entry index on assigneeIds', async () => {
    const person = await createPerson({
      name: 'Alice',
      hoursPerDay: 8,
      workDays: [1, 2, 3, 4, 5],
      providerLogins: { github: 'alice' },
    });

    const project = await createProject({
      name: 'P',
      statuses: ['todo'],
      defaultStatus: 'todo',
      customFieldDefs: [],
    });

    await createTask({
      projectId: project.id,
      title: 'Alice Task',
      body: '',
      status: 'todo',
      labels: [],
      assigneeIds: [person.id],
      custom: {},
    });

    const tasksForAlice = await db.tasks.where('assigneeIds').equals(person.id).toArray();
    expect(tasksForAlice).toHaveLength(1);
    expect(tasksForAlice[0].title).toBe('Alice Task');
  });

  it('creates a milestone', async () => {
    const project = await createProject({
      name: 'P',
      statuses: ['todo'],
      defaultStatus: 'todo',
      customFieldDefs: [],
    });

    const ms = await createMilestone({
      projectId: project.id,
      title: 'Beta',
      due: '2026-12-01',
    });

    expect(ms.title).toBe('Beta');
    const stored = await db.milestones.get(ms.id);
    expect(stored!.due).toBe('2026-12-01');
  });
});
