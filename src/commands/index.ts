import { db } from '../db';
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

async function writeOpLog(
  entity: string,
  id: ID,
  op: 'put' | 'delete',
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): Promise<void> {
  const fields = diffFields(before, after);
  if (fields.length === 0 && op === 'put') return;

  const entry: OpLogEntry = {
    entity,
    id,
    op,
    fields,
    before: before ? Object.fromEntries(fields.map(f => [f, (before as Record<string, unknown>)[f]])) : undefined,
    after: Object.fromEntries(fields.map(f => [f, after[f]])),
    at: Date.now(),
  };
  await db.oplog.add(entry);
}

export async function createProject(data: Omit<Project, 'id' | 'updatedAt'>): Promise<Project> {
  const project: Project = {
    ...data,
    id: generateId(),
    updatedAt: Date.now(),
  };
  await db.transaction('rw', [db.projects, db.oplog], async () => {
    await db.projects.add(project);
    await writeOpLog('project', project.id, 'put', undefined, project as unknown as Record<string, unknown>);
  });
  return project;
}

export async function updateProject(id: ID, changes: Partial<Omit<Project, 'id'>>): Promise<void> {
  await db.transaction('rw', [db.projects, db.oplog], async () => {
    const existing = await db.projects.get(id);
    if (!existing) throw new Error(`Project ${id} not found`);
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await db.projects.put(updated);
    await writeOpLog('project', id, 'put', existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function deleteProject(id: ID): Promise<void> {
  await db.transaction('rw', [db.projects, db.oplog], async () => {
    const existing = await db.projects.get(id);
    if (!existing) return;
    const updated = { ...existing, deleted: true, updatedAt: Date.now() };
    await db.projects.put(updated);
    await writeOpLog('project', id, 'delete', existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function createTask(data: Omit<Task, 'id' | 'updatedAt'>): Promise<Task> {
  const task: Task = {
    ...data,
    id: generateId(),
    updatedAt: Date.now(),
  };
  await db.transaction('rw', [db.tasks, db.oplog], async () => {
    await db.tasks.add(task);
    await writeOpLog('task', task.id, 'put', undefined, task as unknown as Record<string, unknown>);
  });
  return task;
}

export async function updateTask(id: ID, changes: Partial<Omit<Task, 'id'>>): Promise<void> {
  await db.transaction('rw', [db.tasks, db.oplog], async () => {
    const existing = await db.tasks.get(id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await db.tasks.put(updated);
    await writeOpLog('task', id, 'put', existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function deleteTask(id: ID): Promise<void> {
  await db.transaction('rw', [db.tasks, db.oplog], async () => {
    const existing = await db.tasks.get(id);
    if (!existing) return;
    const updated = { ...existing, deleted: true, updatedAt: Date.now() };
    await db.tasks.put(updated);
    await writeOpLog('task', id, 'delete', existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function createDependency(data: Omit<Dependency, 'id'>): Promise<Dependency> {
  const dep: Dependency = { ...data, id: generateId() };
  await db.transaction('rw', [db.dependencies, db.oplog], async () => {
    await db.dependencies.add(dep);
    await writeOpLog('dependency', dep.id, 'put', undefined, dep as unknown as Record<string, unknown>);
  });
  return dep;
}

export async function deleteDependency(id: ID): Promise<void> {
  await db.transaction('rw', [db.dependencies, db.oplog], async () => {
    const existing = await db.dependencies.get(id);
    if (!existing) return;
    await db.dependencies.delete(id);
    await writeOpLog('dependency', id, 'delete', existing as unknown as Record<string, unknown>, {});
  });
}

export async function createMilestone(data: Omit<Milestone, 'id' | 'updatedAt'>): Promise<Milestone> {
  const milestone: Milestone = { ...data, id: generateId(), updatedAt: Date.now() };
  await db.transaction('rw', [db.milestones, db.oplog], async () => {
    await db.milestones.add(milestone);
    await writeOpLog('milestone', milestone.id, 'put', undefined, milestone as unknown as Record<string, unknown>);
  });
  return milestone;
}

export async function updateMilestone(id: ID, changes: Partial<Omit<Milestone, 'id'>>): Promise<void> {
  await db.transaction('rw', [db.milestones, db.oplog], async () => {
    const existing = await db.milestones.get(id);
    if (!existing) throw new Error(`Milestone ${id} not found`);
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await db.milestones.put(updated);
    await writeOpLog('milestone', id, 'put', existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function deleteMilestone(id: ID): Promise<void> {
  await db.transaction('rw', [db.milestones, db.oplog], async () => {
    const existing = await db.milestones.get(id);
    if (!existing) return;
    const updated = { ...existing, deleted: true, updatedAt: Date.now() };
    await db.milestones.put(updated);
    await writeOpLog('milestone', id, 'delete', existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function createPerson(data: Omit<Person, 'id' | 'updatedAt'>): Promise<Person> {
  const person: Person = { ...data, id: generateId(), updatedAt: Date.now() };
  await db.transaction('rw', [db.people, db.oplog], async () => {
    await db.people.add(person);
    await writeOpLog('person', person.id, 'put', undefined, person as unknown as Record<string, unknown>);
  });
  return person;
}

export async function updatePerson(id: ID, changes: Partial<Omit<Person, 'id'>>): Promise<void> {
  await db.transaction('rw', [db.people, db.oplog], async () => {
    const existing = await db.people.get(id);
    if (!existing) throw new Error(`Person ${id} not found`);
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await db.people.put(updated);
    await writeOpLog('person', id, 'put', existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

export async function deletePerson(id: ID): Promise<void> {
  await db.transaction('rw', [db.people, db.oplog], async () => {
    const existing = await db.people.get(id);
    if (!existing) return;
    const updated = { ...existing, deleted: true, updatedAt: Date.now() };
    await db.people.put(updated);
    await writeOpLog('person', id, 'delete', existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
  });
}

// Undo: revert the last oplog entry
export async function undo(): Promise<OpLogEntry | null> {
  return db.transaction('rw', [db.projects, db.tasks, db.dependencies, db.milestones, db.people, db.oplog], async () => {
    const last = await db.oplog.orderBy('seq').last();
    if (!last || !last.seq) return null;

    const table = entityTableMap[last.entity];
    if (!table) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tbl = db[table] as any;

    if (last.op === 'put' && !last.before) {
      await tbl.delete(last.id);
    } else if (last.op === 'put' && last.before) {
      const current = await tbl.get(last.id);
      if (current) {
        await tbl.put({ ...current, ...last.before });
      }
    } else if (last.op === 'delete' && last.before) {
      const current = await tbl.get(last.id);
      if (current) {
        await tbl.put({ ...current, ...last.before, deleted: undefined });
      }
    }

    await db.oplog.delete(last.seq);
    return last;
  });
}
