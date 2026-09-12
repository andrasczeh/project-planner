import { db } from '../db';
import { generateId } from './id';
import type { Snapshot, ID } from '../types';

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

const SUPPORTS_GZIP = typeof CompressionStream !== 'undefined';
const MAX_AUTO_SNAPSHOTS = 10;

async function encodeSnapshot(data: BackupData): Promise<{ payload: Blob; compressed: boolean }> {
  const json = new Blob([JSON.stringify(data)], { type: 'application/json' });
  if (!SUPPORTS_GZIP) return { payload: json, compressed: false };
  const stream = json.stream().pipeThrough(new CompressionStream('gzip'));
  return { payload: await new Response(stream).blob(), compressed: true };
}

async function decodeSnapshot(snapshot: Snapshot): Promise<BackupData> {
  if (!snapshot.compressed) return JSON.parse(await snapshot.payload.text()) as BackupData;
  const stream = snapshot.payload.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as BackupData;
}

export async function createSnapshot(label: string, auto = false): Promise<Snapshot> {
  const data = await exportBackup();
  const { payload, compressed } = await encodeSnapshot(data);
  const snapshot: Snapshot = {
    id: generateId(),
    label,
    createdAt: Date.now(),
    auto,
    payload,
    compressed,
    bytes: payload.size,
  };
  await db.snapshots.add(snapshot);

  if (auto) {
    const autos = await db.snapshots.orderBy('createdAt').reverse().toArray();
    const stale = autos.filter(s => s.auto).slice(MAX_AUTO_SNAPSHOTS);
    if (stale.length) await db.snapshots.bulkDelete(stale.map(s => s.id));
  }

  return snapshot;
}

export async function restoreSnapshot(id: ID): Promise<{ counts: Record<string, number> }> {
  const snapshot = await db.snapshots.get(id);
  if (!snapshot) throw new Error('Snapshot not found');

  await createSnapshot(`Before restoring "${snapshot.label}"`, true);
  const data = await decodeSnapshot(snapshot);

  // Wipe first so records deleted since the snapshot do not survive the restore.
  await db.transaction('rw', [db.projects, db.tasks, db.dependencies, db.milestones, db.people, db.oplog], async () => {
    await Promise.all([
      db.projects.clear(),
      db.tasks.clear(),
      db.dependencies.clear(),
      db.milestones.clear(),
      db.people.clear(),
      db.oplog.clear(),
    ]);
  });

  return importBackup(data);
}

export async function deleteSnapshot(id: ID): Promise<void> {
  await db.snapshots.delete(id);
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
