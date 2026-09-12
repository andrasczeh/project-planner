import { db } from '../db';
import { generateId } from '../utils/id';
import type { ProviderAdapter, SyncContext, RemoteOp, ProviderConfig } from './types';
import { computeDiffs, applyResolutions, type RecordDiff } from './diff';
import type { Task, ID } from '../types';
import { githubAdapter } from './adapters/github';

const adapters: Record<string, ProviderAdapter> = {
  github: githubAdapter,
};

export function getAdapter(provider: string): ProviderAdapter | undefined {
  return adapters[provider];
}

export interface SyncPlan {
  diffs: RecordDiff[];
  provider: string;
  config: ProviderConfig;
}

export async function computeSyncPlan(config: ProviderConfig, projectId?: ID): Promise<SyncPlan> {
  const adapter = adapters[config.provider];
  if (!adapter) throw new Error(`Unknown provider: ${config.provider}`);

  const ctx: SyncContext = { provider: config.provider, config };

  const lastSync = await db.meta.get(`lastSync:${config.provider}`);
  const since = lastSync?.value as string | undefined;

  const remoteRecords = await adapter.pull(ctx, since);

  const mappedFields = ['title', 'body', 'status', 'labels'];

  const baseSnapshots = new Map<string, Record<string, unknown>>();
  const localRecords = new Map<string, Record<string, unknown>>();
  const remoteMap = new Map<string, Record<string, unknown>>();

  for (const rr of remoteRecords) {
    const canonical = adapter.toCanonical(rr);
    remoteMap.set(rr.remoteId, canonical as Record<string, unknown>);

    const ref = await db.providerRefs.get([config.provider, rr.kind, rr.remoteId]);
    if (ref) {
      const localTask = await db.tasks.get(ref.localId);
      if (localTask) {
        if (!projectId || localTask.projectId === projectId) {
          localRecords.set(rr.remoteId, localTask as unknown as Record<string, unknown>);
        }
      }

      const base = await db.syncBase.get(`${config.provider}:${rr.kind}:${rr.remoteId}`);
      if (base) {
        baseSnapshots.set(rr.remoteId, base.snapshot);
      }
    }
  }

  const diffs = computeDiffs(baseSnapshots, localRecords, remoteMap, mappedFields, 'issue');

  const linkedLocalIds = new Set<string>();
  const allRefs = await db.providerRefs.where('provider').equals(config.provider).toArray();
  for (const ref of allRefs) {
    linkedLocalIds.add(ref.localId);
  }

  const projectTasks = projectId
    ? await db.tasks.where('projectId').equals(projectId).toArray()
    : await db.tasks.toArray();

  for (const task of projectTasks) {
    if (linkedLocalIds.has(task.id)) continue;
    if (!task.title) continue;

    const canonical: Record<string, unknown> = {
      title: task.title,
      body: task.body ?? '',
      status: task.status ?? 'todo',
      labels: task.labels ?? [],
    };

    diffs.push({
      id: task.id,
      kind: 'issue',
      status: 'push',
      fields: mappedFields
        .filter(f => canonical[f] !== undefined)
        .map(f => ({
          field: f,
          base: undefined,
          local: canonical[f],
          remote: undefined,
          resolution: 'local' as const,
        })),
    });
  }

  return { diffs, provider: config.provider, config };
}

export async function executeSyncPlan(plan: SyncPlan, confirmedDiffs: RecordDiff[], projectId?: ID): Promise<{
  pulled: number;
  pushed: number;
  errors: string[];
}> {
  const adapter = adapters[plan.provider];
  if (!adapter) throw new Error(`Unknown provider: ${plan.provider}`);

  const ctx: SyncContext = { provider: plan.provider, config: plan.config };
  let pulled = 0;
  let pushed = 0;
  const errors: string[] = [];
  const pushOps: RemoteOp[] = [];

  for (const diff of confirmedDiffs) {
    if (diff.status === 'pull' || diff.fields.some(f => f.resolution === 'remote')) {
      const ref = await db.providerRefs.get([plan.provider, diff.kind, diff.id]);
      if (ref) {
        const localTask = await db.tasks.get(ref.localId);
        if (localTask) {
          const merged = applyResolutions(
            localTask as unknown as Record<string, unknown>,
            diff.fields,
          );
          await db.tasks.put({ ...localTask, ...merged, updatedAt: Date.now() } as Task);
          pulled++;
        }
      } else {
        const remoteData: Record<string, unknown> = {};
        for (const f of diff.fields) {
          remoteData[f.field] = f.remote;
        }
        const newTask: Task = {
          id: generateId(),
          projectId: projectId ?? '',
          title: (remoteData.title as string) ?? 'Untitled',
          body: (remoteData.body as string) ?? '',
          status: (remoteData.status as string) ?? 'todo',
          labels: (remoteData.labels as string[]) ?? [],
          assigneeIds: [],
          custom: {},
          updatedAt: Date.now(),
        };
        await db.tasks.add(newTask);
        await db.providerRefs.add({
          localId: newTask.id,
          provider: plan.provider,
          kind: diff.kind,
          remoteId: diff.id,
        });
        pulled++;
      }

      await db.syncBase.put({
        key: `${plan.provider}:${diff.kind}:${diff.id}`,
        snapshot: Object.fromEntries(diff.fields.map(f => [f.field, f.resolution === 'remote' ? f.remote : f.local])),
        syncedAt: Date.now(),
      });
    }

    if (diff.status === 'push' || diff.fields.some(f => f.resolution === 'local')) {
      const ref = await db.providerRefs.get([plan.provider, diff.kind, diff.id]);
      let localTask = ref ? await db.tasks.get(ref.localId) : null;
      if (!localTask) {
        localTask = await db.tasks.get(diff.id) ?? null;
      }
      if (localTask) {
        const patch = adapter.fromCanonical(localTask);
        pushOps.push({
          type: ref?.remoteId ? 'update' : 'create',
          kind: 'issue',
          localId: localTask.id,
          remoteId: ref?.remoteId,
          data: { ...patch.data, ...(ref?.remoteNumber ? { number: ref.remoteNumber } : {}) },
        });
      }
    }
  }

  if (pushOps.length > 0) {
    const results = await adapter.push(ctx, pushOps);
    for (const result of results) {
      if (result.success) {
        pushed++;
        await db.providerRefs.put({
          localId: result.localId,
          provider: plan.provider,
          kind: 'issue',
          remoteId: result.remoteId,
          remoteNumber: result.remoteNumber,
          url: result.url,
        });
      } else {
        errors.push(`Failed to push ${result.localId}: ${result.error}`);
      }
    }
  }

  await db.meta.put({ key: `lastSync:${plan.provider}`, value: new Date().toISOString() });

  return { pulled, pushed, errors };
}
