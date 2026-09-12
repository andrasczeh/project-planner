import { db } from '../db';
import type { RecordDiff, FieldChange } from './diff';

export interface DeviceSyncPayload {
  deviceId: string;
  tables: {
    projects: Record<string, unknown>[];
    tasks: Record<string, unknown>[];
    dependencies: Record<string, unknown>[];
    milestones: Record<string, unknown>[];
    people: Record<string, unknown>[];
  };
}

const SYNCED_TABLES = ['projects', 'tasks', 'dependencies', 'milestones', 'people'] as const;
type SyncTable = typeof SYNCED_TABLES[number];

const SKIP_FIELDS = new Set(['updatedAt']);

export async function exportForSync(): Promise<DeviceSyncPayload> {
  const deviceId = ((await db.meta.get('deviceId'))?.value as string) ?? 'unknown';
  const [projects, tasks, dependencies, milestones, people] = await Promise.all([
    db.projects.toArray(),
    db.tasks.toArray(),
    db.dependencies.toArray(),
    db.milestones.toArray(),
    db.people.toArray(),
  ]);
  return {
    deviceId,
    tables: {
      projects: projects as unknown as Record<string, unknown>[],
      tasks: tasks as unknown as Record<string, unknown>[],
      dependencies: dependencies as unknown as Record<string, unknown>[],
      milestones: milestones as unknown as Record<string, unknown>[],
      people: people as unknown as Record<string, unknown>[],
    },
  };
}

const KIND_MAP: Record<SyncTable, string> = {
  projects: 'project',
  tasks: 'task',
  dependencies: 'dependency',
  milestones: 'milestone',
  people: 'person',
};

function singularKind(table: SyncTable): string {
  return KIND_MAP[table];
}

function findTitle(record: Record<string, unknown>): string {
  return (record.title as string) ?? (record.name as string) ?? (record.id as string)?.slice(-8) ?? '?';
}

export function computeDeviceDiffs(
  local: DeviceSyncPayload,
  remote: DeviceSyncPayload,
): RecordDiff[] {
  const diffs: RecordDiff[] = [];

  for (const table of SYNCED_TABLES) {
    const localMap = new Map<string, Record<string, unknown>>();
    const remoteMap = new Map<string, Record<string, unknown>>();
    for (const r of local.tables[table]) localMap.set(r.id as string, r);
    for (const r of remote.tables[table]) remoteMap.set(r.id as string, r);

    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    const kind = singularKind(table);

    for (const id of allIds) {
      const l = localMap.get(id);
      const r = remoteMap.get(id);

      if (l && !r) {
        diffs.push({
          id,
          kind,
          status: 'push',
          fields: Object.keys(l)
            .filter(f => !SKIP_FIELDS.has(f) && f !== 'id')
            .map(f => ({ field: f, base: undefined, local: l[f], remote: undefined, resolution: 'local' as const })),
        });
        continue;
      }

      if (!l && r) {
        diffs.push({
          id,
          kind,
          status: 'pull',
          fields: Object.keys(r)
            .filter(f => !SKIP_FIELDS.has(f) && f !== 'id')
            .map(f => ({ field: f, base: undefined, local: undefined, remote: r[f], resolution: 'remote' as const })),
        });
        continue;
      }

      if (l && r) {
        const allFields = new Set([...Object.keys(l), ...Object.keys(r)]);
        const changes: FieldChange[] = [];
        for (const f of allFields) {
          if (SKIP_FIELDS.has(f) || f === 'id') continue;
          if (JSON.stringify(l[f]) === JSON.stringify(r[f])) continue;
          const localNewer = ((l.updatedAt as number) ?? 0) >= ((r.updatedAt as number) ?? 0);
          changes.push({
            field: f,
            base: undefined,
            local: l[f],
            remote: r[f],
            resolution: localNewer ? 'local' : 'remote',
          });
        }
        if (changes.length > 0) {
          const allLocal = changes.every(c => c.resolution === 'local');
          const allRemote = changes.every(c => c.resolution === 'remote');
          diffs.push({
            id,
            kind,
            status: allLocal ? 'push' : allRemote ? 'pull' : 'conflict',
            fields: changes,
          });
        }
      }
    }
  }

  return diffs;
}

export function diffSummary(diffs: RecordDiff[], local: DeviceSyncPayload, remote: DeviceSyncPayload): string {
  const lookup = new Map<string, Record<string, unknown>>();
  for (const table of SYNCED_TABLES) {
    for (const r of local.tables[table]) lookup.set(r.id as string, r);
    for (const r of remote.tables[table]) lookup.set(r.id as string, r);
  }
  const lines: string[] = [];
  for (const d of diffs) {
    const rec = lookup.get(d.id);
    const title = rec ? findTitle(rec) : d.id.slice(-8);
    lines.push(`${d.status === 'push' ? '↑' : d.status === 'pull' ? '↓' : '⇄'} ${d.kind}: ${title}`);
  }
  return lines.join('\n');
}

interface SyncOps {
  puts: { table: SyncTable; record: Record<string, unknown> }[];
}

export function resolveOps(
  diffs: RecordDiff[],
  local: DeviceSyncPayload,
  remote: DeviceSyncPayload,
): { localOps: SyncOps; remoteOps: SyncOps } {
  const localLookup = new Map<string, { table: SyncTable; record: Record<string, unknown> }>();
  const remoteLookup = new Map<string, { table: SyncTable; record: Record<string, unknown> }>();

  for (const table of SYNCED_TABLES) {
    for (const r of local.tables[table]) localLookup.set(r.id as string, { table, record: r });
    for (const r of remote.tables[table]) remoteLookup.set(r.id as string, { table, record: r });
  }

  const localOps: SyncOps = { puts: [] };
  const remoteOps: SyncOps = { puts: [] };

  for (const diff of diffs) {
    const lEntry = localLookup.get(diff.id);
    const rEntry = remoteLookup.get(diff.id);

    if (diff.status === 'push') {
      if (lEntry) remoteOps.puts.push({ table: lEntry.table, record: lEntry.record });
      continue;
    }

    if (diff.status === 'pull') {
      if (rEntry) localOps.puts.push({ table: rEntry.table, record: rEntry.record });
      continue;
    }

    const merged: Record<string, unknown> = { ...(lEntry?.record ?? rEntry?.record) };
    for (const f of diff.fields) {
      if (f.resolution === 'remote') merged[f.field] = f.remote;
      else merged[f.field] = f.local;
    }
    merged.updatedAt = Date.now();

    const table = lEntry?.table ?? rEntry?.table;
    if (table) {
      localOps.puts.push({ table, record: merged });
      remoteOps.puts.push({ table, record: merged });
    }
  }

  return { localOps, remoteOps };
}

const tableMap: Record<SyncTable, 'projects' | 'tasks' | 'dependencies' | 'milestones' | 'people'> = {
  projects: 'projects',
  tasks: 'tasks',
  dependencies: 'dependencies',
  milestones: 'milestones',
  people: 'people',
};

export async function applySyncOps(ops: SyncOps): Promise<number> {
  const byTable = new Map<SyncTable, Record<string, unknown>[]>();
  for (const op of ops.puts) {
    const arr = byTable.get(op.table) ?? [];
    arr.push(op.record);
    byTable.set(op.table, arr);
  }

  let count = 0;
  await db.transaction('rw', [db.projects, db.tasks, db.dependencies, db.milestones, db.people], async () => {
    for (const [table, records] of byTable) {
      const tbl = db[tableMap[table]];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tbl as any).bulkPut(records);
      count += records.length;
    }
  });
  return count;
}
