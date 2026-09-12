import { db } from '../db';

export interface BackupData {
  version: 1;
  exportedAt: string;
  projects: unknown[];
  tasks: unknown[];
  dependencies: unknown[];
  milestones: unknown[];
  people: unknown[];
}

export async function exportBackup(): Promise<BackupData> {
  const [projects, tasks, dependencies, milestones, people] = await Promise.all([
    db.projects.toArray(),
    db.tasks.toArray(),
    db.dependencies.toArray(),
    db.milestones.toArray(),
    db.people.toArray(),
  ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    projects,
    tasks,
    dependencies,
    milestones,
    people,
  };
}

export async function importBackup(data: BackupData): Promise<{ counts: Record<string, number> }> {
  if (data.version !== 1) throw new Error(`Unsupported backup version: ${data.version}`);

  const counts: Record<string, number> = {};

  await db.transaction('rw', [db.projects, db.tasks, db.dependencies, db.milestones, db.people], async () => {
    if (data.projects?.length) {
      await db.projects.bulkPut(data.projects as never[]);
      counts.projects = data.projects.length;
    }
    if (data.tasks?.length) {
      await db.tasks.bulkPut(data.tasks as never[]);
      counts.tasks = data.tasks.length;
    }
    if (data.dependencies?.length) {
      await db.dependencies.bulkPut(data.dependencies as never[]);
      counts.dependencies = data.dependencies.length;
    }
    if (data.milestones?.length) {
      await db.milestones.bulkPut(data.milestones as never[]);
      counts.milestones = data.milestones.length;
    }
    if (data.people?.length) {
      await db.people.bulkPut(data.people as never[]);
      counts.people = data.people.length;
    }
  });

  return { counts };
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function wipeAllData(): Promise<void> {
  await db.delete();
  window.location.reload();
}
