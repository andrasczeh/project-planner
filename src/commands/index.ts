import { db, getDeviceId } from '../db';
import { generateId } from '../utils/id';
import type {
  Project,
  Task,
  Dependency,
  Milestone,
  Person,
  OpLogEntry,
  ID,
} from '../types';

type EntityTable = 'projects' | 'tasks' | 'dependencies' | 'milestones' | 'people';

const entityTableMap: Record<string, EntityTable> = {
  project: 'projects',
  task: 'tasks',
  dependency: 'dependencies',
  milestone: 'milestones',
  person: 'people',
};

const MAX_OPLOG_ENTRIES = 500;

const mutableTables = () => [db.projects, db.tasks, db.dependencies, db.milestones, db.people];

let deviceId = 'unknown';
let lamportCounter = 0;

/** Buffers a multi-step user action so it collapses into a single undo step. */
let openTxn: { id: string; buffer: Map<string, OpLogEntry> } | null = null;

export async function initCommands(): Promise<void> {
  deviceId = await getDeviceId();
  const stored = await db.meta.get('lamport');
  lamportCounter = (stored?.value as number) ?? 0;
}

export function beginTxn(): string {
  if (openTxn) return openTxn.id;
  openTxn = { id: crypto.randomUUID(), buffer: new Map() };
  return openTxn.id;
}

export async function endTxn(): Promise<void> {
  if (!openTxn) return;
  const entries = [...openTxn.buffer.values()];
  openTxn = null;
  if (entries.length === 0) return;

  await db.transaction('rw', [db.oplog, db.meta], async () => {
    await truncateRedoBranch();
    await db.oplog.bulkAdd(entries);
    await db.meta.put({ key: 'lamport', value: lamportCounter });
    await trimOpLog();
  });
}

export function abortTxn(): void {
  openTxn = null;
}

export async function runInTxn<T>(fn: () => Promise<T>): Promise<T> {
  beginTxn();
  try {
    const result = await fn();
    await endTxn();
    return result;
  } catch (err) {
    abortTxn();
    throw err;
  }
}

function diffFields(before: Record<string, unknown> | undefined, after: Record<string, unknown>): string[] {
  if (!before) return Object.keys(after);
  const fields: string[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      fields.push(key);
    }
  }
  return fields;
}

/** Redoable entries are only valid on the branch they were undone from; any new edit discards them. */
async function truncateRedoBranch(): Promise<void> {
  await db.oplog.where('undone').equals(1).delete();
}

async function trimOpLog(): Promise<void> {
  const count = await db.oplog.count();
  if (count <= MAX_OPLOG_ENTRIES) return;
  const oldest = await db.oplog.orderBy('seq').limit(count - MAX_OPLOG_ENTRIES).toArray();
  await db.oplog.bulkDelete(oldest.map(e => e.seq!));
}

function newEntry(
  entity: string,
  id: ID,
  op: 'put' | 'delete',
  fields: string[],
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  hard: boolean,
): OpLogEntry {
  lamportCounter += 1;
  return {
    txnId: openTxn?.id ?? crypto.randomUUID(),
    entity,
    id,
    op,
    hard,
    fields,
    before,
    after,
    deviceId,
    lamport: lamportCounter,
    at: Date.now(),
    undone: 0,
  };
}

async function record(entry: OpLogEntry): Promise<void> {
  if (openTxn) {
    const key = `${entry.entity}:${entry.id}`;
    const prev = openTxn.buffer.get(key);
    if (prev && prev.op === 'put' && entry.op === 'put') {
      // Collapse repeated edits to the same record: keep the oldest `before`, take the newest `after`.
      for (const field of entry.fields) {
        if (!prev.fields.includes(field)) {
          prev.fields.push(field);
          if (prev.before) prev.before[field] = entry.before?.[field];
        }
      }
      prev.after = { ...prev.after, ...entry.after };
      prev.lamport = entry.lamport;
      prev.at = entry.at;
      return;
    }
    openTxn.buffer.set(key, entry);
    return;
  }

  await truncateRedoBranch();
  await db.oplog.add(entry);
  await trimOpLog();
}

async function logPut(
  entity: string,
  id: ID,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): Promise<void> {
  const fields = diffFields(before, after);
  if (fields.length === 0) return;
  await record(newEntry(
    entity,
    id,
    'put',
    fields,
    before ? Object.fromEntries(fields.map(f => [f, before[f]])) : undefined,
    Object.fromEntries(fields.map(f => [f, after[f]])),
    false,
  ));
}

/** Deletes store the complete prior record so undo can resurrect it even after a hard delete. */
async function logDelete(
  entity: string,
  id: ID,
  full: Record<string, unknown>,
  hard: boolean,
): Promise<void> {
  await record(newEntry(
    entity,
    id,
    'delete',
    Object.keys(full),
    { ...full },
    hard ? undefined : { ...full, deleted: true },
    hard,
  ));
}

export async function createProject(data: Omit<Project, 'id' | 'updatedAt'>): Promise<Project> {
  const project: Project = { ...data, id: generateId(), updatedAt: Date.now() };
  await db.transaction('rw', [db.projects, db.oplog], async () => {
    await db.projects.add(project);
    await logPut('project', project.id, undefined, project as unknown as Record<string, unknown>);
  });
  return project;
}

export async function updateProject(id: ID, changes: Partial<Omit<Project, 'id'>>): Promise<void> {
  await db.transaction('rw', [db.projects, db.oplog], async () => {
    const existing = await db.projects.get(id);
    if (!existing) throw new Error(`Project ${id} not found`);
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await db.projects.put(updated);
    await logPut('project', id, existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function deleteProject(id: ID): Promise<void> {
  await db.transaction('rw', [db.projects, db.oplog], async () => {
    const existing = await db.projects.get(id);
    if (!existing) return;
    await db.projects.put({ ...existing, deleted: true, updatedAt: Date.now() });
    await logDelete('project', id, existing as unknown as Record<string, unknown>, false);
  });
}

export async function createTask(data: Omit<Task, 'id' | 'updatedAt'>): Promise<Task> {
  const task: Task = { ...data, id: generateId(), updatedAt: Date.now() };
  await db.transaction('rw', [db.tasks, db.oplog], async () => {
    await db.tasks.add(task);
    await logPut('task', task.id, undefined, task as unknown as Record<string, unknown>);
  });
  return task;
}

export async function updateTask(id: ID, changes: Partial<Omit<Task, 'id'>>): Promise<void> {
  await db.transaction('rw', [db.tasks, db.oplog], async () => {
    const existing = await db.tasks.get(id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await db.tasks.put(updated);
    await logPut('task', id, existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function deleteTask(id: ID): Promise<void> {
  await db.transaction('rw', [db.tasks, db.oplog], async () => {
    const existing = await db.tasks.get(id);
    if (!existing) return;
    await db.tasks.put({ ...existing, deleted: true, updatedAt: Date.now() });
    await logDelete('task', id, existing as unknown as Record<string, unknown>, false);
  });
}

export async function createDependency(data: Omit<Dependency, 'id'>): Promise<Dependency> {
  const dep: Dependency = { ...data, id: generateId() };
  await db.transaction('rw', [db.dependencies, db.oplog], async () => {
    await db.dependencies.add(dep);
    await logPut('dependency', dep.id, undefined, dep as unknown as Record<string, unknown>);
  });
  return dep;
}

export async function deleteDependency(id: ID): Promise<void> {
  await db.transaction('rw', [db.dependencies, db.oplog], async () => {
    const existing = await db.dependencies.get(id);
    if (!existing) return;
    await db.dependencies.delete(id);
    await logDelete('dependency', id, existing as unknown as Record<string, unknown>, true);
  });
}

export async function createMilestone(data: Omit<Milestone, 'id' | 'updatedAt'>): Promise<Milestone> {
  const milestone: Milestone = { ...data, id: generateId(), updatedAt: Date.now() };
  await db.transaction('rw', [db.milestones, db.oplog], async () => {
    await db.milestones.add(milestone);
    await logPut('milestone', milestone.id, undefined, milestone as unknown as Record<string, unknown>);
  });
  return milestone;
}

export async function updateMilestone(id: ID, changes: Partial<Omit<Milestone, 'id'>>): Promise<void> {
  await db.transaction('rw', [db.milestones, db.oplog], async () => {
    const existing = await db.milestones.get(id);
    if (!existing) throw new Error(`Milestone ${id} not found`);
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await db.milestones.put(updated);
    await logPut('milestone', id, existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function deleteMilestone(id: ID): Promise<void> {
  await db.transaction('rw', [db.milestones, db.oplog], async () => {
    const existing = await db.milestones.get(id);
    if (!existing) return;
    await db.milestones.put({ ...existing, deleted: true, updatedAt: Date.now() });
    await logDelete('milestone', id, existing as unknown as Record<string, unknown>, false);
  });
}

export async function createPerson(data: Omit<Person, 'id' | 'updatedAt'>): Promise<Person> {
  const person: Person = { ...data, id: generateId(), updatedAt: Date.now() };
  await db.transaction('rw', [db.people, db.oplog], async () => {
    await db.people.add(person);
    await logPut('person', person.id, undefined, person as unknown as Record<string, unknown>);
  });
  return person;
}

export async function updatePerson(id: ID, changes: Partial<Omit<Person, 'id'>>): Promise<void> {
  await db.transaction('rw', [db.people, db.oplog], async () => {
    const existing = await db.people.get(id);
    if (!existing) throw new Error(`Person ${id} not found`);
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await db.people.put(updated);
    await logPut('person', id, existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function deletePerson(id: ID): Promise<void> {
  await db.transaction('rw', [db.people, db.oplog], async () => {
    const existing = await db.people.get(id);
    if (!existing) return;
    await db.people.put({ ...existing, deleted: true, updatedAt: Date.now() });
    await logDelete('person', id, existing as unknown as Record<string, unknown>, false);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tableFor(entity: string): any {
  const name = entityTableMap[entity];
  return name ? db[name] : null;
}

async function revertEntry(entry: OpLogEntry): Promise<void> {
  const tbl = tableFor(entry.entity);
  if (!tbl) return;

  if (entry.op === 'delete') {
    await tbl.put(entry.before);
    return;
  }

  if (!entry.before) {
    await tbl.delete(entry.id);
    return;
  }

  const current = await tbl.get(entry.id);
  if (current) await tbl.put({ ...current, ...entry.before });
}

async function reapplyEntry(entry: OpLogEntry): Promise<void> {
  const tbl = tableFor(entry.entity);
  if (!tbl) return;

  if (entry.op === 'delete') {
    if (entry.hard) await tbl.delete(entry.id);
    else await tbl.put(entry.after);
    return;
  }

  if (!entry.before) {
    await tbl.put(entry.after);
    return;
  }

  const current = await tbl.get(entry.id);
  if (current) await tbl.put({ ...current, ...entry.after });
}

/** Reverts the newest applied transaction. Returns its entries, or null when there is nothing to undo. */
export async function undo(): Promise<OpLogEntry[] | null> {
  return db.transaction('rw', [...mutableTables(), db.oplog], async () => {
    const applied = await db.oplog.where('undone').equals(0).sortBy('seq');
    const last = applied[applied.length - 1];
    if (!last) return null;

    const entries = applied.filter(e => e.txnId === last.txnId);
    for (const entry of [...entries].reverse()) {
      await revertEntry(entry);
      await db.oplog.update(entry.seq!, { undone: 1 });
    }
    return entries;
  });
}

/** Re-applies the oldest undone transaction. Returns its entries, or null when there is nothing to redo. */
export async function redo(): Promise<OpLogEntry[] | null> {
  return db.transaction('rw', [...mutableTables(), db.oplog], async () => {
    const undone = await db.oplog.where('undone').equals(1).sortBy('seq');
    const first = undone[0];
    if (!first) return null;

    const entries = undone.filter(e => e.txnId === first.txnId);
    for (const entry of entries) {
      await reapplyEntry(entry);
      await db.oplog.update(entry.seq!, { undone: 0 });
    }
    return entries;
  });
}
