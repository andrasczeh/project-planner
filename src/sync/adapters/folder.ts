import type { Task, Project, Person, ID } from '../../types';

interface TaskFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function serializeTask(task: Task, people: Person[], milestones: { id: ID; title: string }[]): string {
  const fm: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
  };

  if (task.assigneeIds.length > 0) {
    fm.assignees = task.assigneeIds
      .map(id => people.find(p => p.id === id)?.name)
      .filter(Boolean);
  }
  if (task.start) fm.start = task.start;
  if (task.end) fm.end = task.end;
  if (task.estimateHours != null) fm.estimate = task.estimateHours;
  if (task.priority != null) fm.priority = task.priority;
  if (task.labels.length > 0) fm.labels = task.labels;
  if (task.milestoneId) {
    const ms = milestones.find(m => m.id === task.milestoneId);
    if (ms) fm.milestone = ms.title;
  }
  if (task.parentId) fm.parent = task.parentId;

  const yaml = Object.entries(fm)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map(i => typeof i === 'string' ? i : JSON.stringify(i)).join(', ')}]`;
      if (typeof v === 'string') return `${k}: ${v}`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join('\n');

  return `---\n${yaml}\n---\n${task.body}\n`;
}

export function parseTaskFile(content: string): TaskFile {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fmLines = match[1].split('\n');
  const frontmatter: Record<string, unknown> = {};

  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      value = Number(value);
    } else if (typeof value === 'string' && /^\d+\.\d+$/.test(value)) {
      value = Number(value);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2].trim() };
}

export function taskFilename(task: Task): string {
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `T-${task.id.slice(-6)}-${slug}.md`;
}

export function serializeProject(project: Project, people: Person[]): string {
  const data: Record<string, unknown> = {
    name: project.name,
    statuses: project.statuses,
    defaultStatus: project.defaultStatus,
  };
  if (project.description) data.description = project.description;
  if (people.length > 0) {
    data.people = people.map(p => ({
      name: p.name,
      hoursPerDay: p.hoursPerDay,
      workDays: p.workDays,
      github: p.providerLogins.github,
    }));
  }
  return JSON.stringify(data, null, 2);
}

export async function exportToFolder(handle: FileSystemDirectoryHandle, project: Project, tasks: Task[], milestones: { id: ID; title: string }[], people: Person[]): Promise<void> {
  const projFile = await handle.getFileHandle('project.json', { create: true });
  const projWritable = await projFile.createWritable();
  await projWritable.write(serializeProject(project, people));
  await projWritable.close();

  let tasksDir: FileSystemDirectoryHandle;
  try {
    tasksDir = await handle.getDirectoryHandle('tasks', { create: true });
  } catch {
    throw new Error('Could not create tasks directory');
  }

  for (const task of tasks) {
    if (task.deleted) continue;
    const filename = taskFilename(task);
    const file = await tasksDir.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(serializeTask(task, people, milestones));
    await writable.close();
  }
}

export async function importFromFolder(handle: FileSystemDirectoryHandle): Promise<{
  tasks: TaskFile[];
  projectConfig: Record<string, unknown> | null;
}> {
  const tasks: TaskFile[] = [];
  let projectConfig: Record<string, unknown> | null = null;

  try {
    const projFile = await handle.getFileHandle('project.json');
    const file = await projFile.getFile();
    const text = await file.text();
    projectConfig = JSON.parse(text);
  } catch {
    // no project.json
  }

  try {
    const tasksDir = await handle.getDirectoryHandle('tasks');
    for await (const [name, entry] of tasksDir as unknown as Iterable<[string, FileSystemHandle]>) {
      if (entry.kind !== 'file' || !name.endsWith('.md')) continue;
      const file = await (entry as FileSystemFileHandle).getFile();
      const text = await file.text();
      tasks.push(parseTaskFile(text));
    }
  } catch {
    // no tasks directory
  }

  return { tasks, projectConfig };
}

export async function exportToZip(project: Project, tasks: Task[], milestones: { id: ID; title: string }[], people: Person[]): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');

  const files: Record<string, Uint8Array> = {};
  files['project.json'] = strToU8(serializeProject(project, people));

  for (const task of tasks) {
    if (task.deleted) continue;
    const filename = `tasks/${taskFilename(task)}`;
    files[filename] = strToU8(serializeTask(task, people, milestones));
  }

  const zipped = zipSync(files);
  return new Blob([zipped], { type: 'application/zip' });
}
