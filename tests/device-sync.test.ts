import { describe, it, expect } from 'vitest';
import {
  computeDeviceDiffs,
  resolveOps,
  type DeviceSyncPayload,
} from '../src/sync/device-sync';

function makePayload(overrides: Partial<DeviceSyncPayload['tables']> = {}): DeviceSyncPayload {
  return {
    deviceId: 'test-device',
    tables: {
      projects: [],
      tasks: [],
      dependencies: [],
      milestones: [],
      people: [],
      ...overrides,
    },
  };
}

describe('computeDeviceDiffs', () => {
  it('detects records only on local side as push', () => {
    const local = makePayload({
      tasks: [{ id: 't1', title: 'Local only', status: 'todo', updatedAt: 100 }],
    });
    const remote = makePayload();
    const diffs = computeDeviceDiffs(local, remote);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('push');
    expect(diffs[0].kind).toBe('task');
  });

  it('detects records only on remote side as pull', () => {
    const local = makePayload();
    const remote = makePayload({
      tasks: [{ id: 't1', title: 'Remote only', status: 'todo', updatedAt: 100 }],
    });
    const diffs = computeDeviceDiffs(local, remote);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('pull');
  });

  it('shows no diff when records match', () => {
    const record = { id: 't1', title: 'Same', status: 'todo', updatedAt: 100 };
    const local = makePayload({ tasks: [{ ...record }] });
    const remote = makePayload({ tasks: [{ ...record }] });
    const diffs = computeDeviceDiffs(local, remote);
    expect(diffs).toHaveLength(0);
  });

  it('auto-resolves by updatedAt — newer local wins', () => {
    const local = makePayload({
      tasks: [{ id: 't1', title: 'New title', status: 'todo', updatedAt: 200 }],
    });
    const remote = makePayload({
      tasks: [{ id: 't1', title: 'Old title', status: 'todo', updatedAt: 100 }],
    });
    const diffs = computeDeviceDiffs(local, remote);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('push');
    expect(diffs[0].fields[0].resolution).toBe('local');
  });

  it('auto-resolves by updatedAt — newer remote wins', () => {
    const local = makePayload({
      tasks: [{ id: 't1', title: 'Old title', status: 'todo', updatedAt: 100 }],
    });
    const remote = makePayload({
      tasks: [{ id: 't1', title: 'New title', status: 'todo', updatedAt: 200 }],
    });
    const diffs = computeDeviceDiffs(local, remote);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('pull');
    expect(diffs[0].fields[0].resolution).toBe('remote');
  });

  it('handles multiple tables', () => {
    const local = makePayload({
      projects: [{ id: 'p1', name: 'Proj', updatedAt: 100 }],
      people: [{ id: 'u1', name: 'Alice', updatedAt: 100 }],
    });
    const remote = makePayload({
      tasks: [{ id: 't1', title: 'Task', updatedAt: 100 }],
    });
    const diffs = computeDeviceDiffs(local, remote);
    expect(diffs).toHaveLength(3);
    const kinds = diffs.map(d => d.kind).sort();
    expect(kinds).toEqual(['person', 'project', 'task']);
  });
});

describe('resolveOps', () => {
  it('puts push records into remoteOps', () => {
    const local = makePayload({
      tasks: [{ id: 't1', title: 'Mine', status: 'todo', updatedAt: 100 }],
    });
    const remote = makePayload();
    const diffs = computeDeviceDiffs(local, remote);
    const { localOps, remoteOps } = resolveOps(diffs, local, remote);
    expect(localOps.puts).toHaveLength(0);
    expect(remoteOps.puts).toHaveLength(1);
    expect(remoteOps.puts[0].table).toBe('tasks');
  });

  it('puts pull records into localOps', () => {
    const local = makePayload();
    const remote = makePayload({
      tasks: [{ id: 't1', title: 'Theirs', status: 'todo', updatedAt: 100 }],
    });
    const diffs = computeDeviceDiffs(local, remote);
    const { localOps, remoteOps } = resolveOps(diffs, local, remote);
    expect(localOps.puts).toHaveLength(1);
    expect(remoteOps.puts).toHaveLength(0);
  });

  it('merges conflict resolution into both sides', () => {
    const local = makePayload({
      tasks: [{ id: 't1', title: 'A', body: 'local body', updatedAt: 200 }],
    });
    const remote = makePayload({
      tasks: [{ id: 't1', title: 'B', body: 'remote body', updatedAt: 100 }],
    });
    const diffs = computeDeviceDiffs(local, remote);
    // Auto-resolved as push (local newer). Override to mix resolutions:
    expect(diffs).toHaveLength(1);
    diffs[0].status = 'conflict';
    diffs[0].fields.find(f => f.field === 'title')!.resolution = 'remote';
    diffs[0].fields.find(f => f.field === 'body')!.resolution = 'local';

    const { localOps, remoteOps } = resolveOps(diffs, local, remote);
    expect(localOps.puts).toHaveLength(1);
    expect(remoteOps.puts).toHaveLength(1);
    expect(localOps.puts[0].record.title).toBe('B');
    expect(localOps.puts[0].record.body).toBe('local body');
    expect(remoteOps.puts[0].record.title).toBe('B');
    expect(remoteOps.puts[0].record.body).toBe('local body');
  });
});
