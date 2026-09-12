import { describe, it, expect } from 'vitest';
import { diffFields, classifyDiff, computeDiffs, applyResolutions } from '../src/sync/diff';

describe('diffFields', () => {
  it('detects no changes when base, local and remote are equal', () => {
    const base = { title: 'foo', status: 'open' };
    const local = { title: 'foo', status: 'open' };
    const remote = { title: 'foo', status: 'open' };
    const changes = diffFields(base, local, remote, ['title', 'status']);
    expect(changes).toEqual([]);
  });

  it('detects local-only change', () => {
    const base = { title: 'foo' };
    const local = { title: 'bar' };
    const remote = { title: 'foo' };
    const changes = diffFields(base, local, remote, ['title']);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('title');
    expect(changes[0].resolution).toBe('local');
  });

  it('detects remote-only change', () => {
    const base = { title: 'foo' };
    const local = { title: 'foo' };
    const remote = { title: 'baz' };
    const changes = diffFields(base, local, remote, ['title']);
    expect(changes).toHaveLength(1);
    expect(changes[0].resolution).toBe('remote');
  });

  it('detects conflict when both sides changed differently', () => {
    const base = { title: 'foo' };
    const local = { title: 'bar' };
    const remote = { title: 'baz' };
    const changes = diffFields(base, local, remote, ['title']);
    expect(changes).toHaveLength(1);
    expect(changes[0].resolution).toBeUndefined();
  });

  it('treats same change on both sides as no-op', () => {
    const base = { title: 'foo' };
    const local = { title: 'bar' };
    const remote = { title: 'bar' };
    const changes = diffFields(base, local, remote, ['title']);
    expect(changes).toEqual([]);
  });

  it('handles no base (first sync)', () => {
    const local = { title: 'foo' };
    const remote = { title: 'bar' };
    const changes = diffFields(undefined, local, remote, ['title']);
    expect(changes).toHaveLength(1);
    expect(changes[0].resolution).toBeUndefined();
  });

  it('handles array fields', () => {
    const base = { labels: ['a', 'b'] };
    const local = { labels: ['a', 'b', 'c'] };
    const remote = { labels: ['a', 'b'] };
    const changes = diffFields(base, local, remote, ['labels']);
    expect(changes).toHaveLength(1);
    expect(changes[0].resolution).toBe('local');
  });
});

describe('classifyDiff', () => {
  it('returns noop for empty changes', () => {
    expect(classifyDiff([])).toBe('noop');
  });

  it('returns push when all local', () => {
    expect(classifyDiff([
      { field: 'title', base: 'a', local: 'b', remote: 'a', resolution: 'local' },
    ])).toBe('push');
  });

  it('returns pull when all remote', () => {
    expect(classifyDiff([
      { field: 'title', base: 'a', local: 'a', remote: 'b', resolution: 'remote' },
    ])).toBe('pull');
  });

  it('returns conflict when unresolved', () => {
    expect(classifyDiff([
      { field: 'title', base: 'a', local: 'b', remote: 'c' },
    ])).toBe('conflict');
  });
});

describe('computeDiffs', () => {
  it('detects new remote records as pull', () => {
    const base = new Map<string, Record<string, unknown>>();
    const local = new Map<string, Record<string, unknown>>();
    const remote = new Map([['r1', { title: 'new', status: 'open' }]]);
    const diffs = computeDiffs(base, local, remote, ['title', 'status'], 'issue');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('pull');
  });

  it('detects deleted remote records', () => {
    const base = new Map([['r1', { title: 'old' }]]);
    const local = new Map([['r1', { title: 'old' }]]);
    const remote = new Map<string, Record<string, unknown>>();
    const diffs = computeDiffs(base, local, remote, ['title'], 'issue');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('deleted-remote');
  });

  it('returns empty for no changes', () => {
    const base = new Map([['r1', { title: 'same' }]]);
    const local = new Map([['r1', { title: 'same' }]]);
    const remote = new Map([['r1', { title: 'same' }]]);
    const diffs = computeDiffs(base, local, remote, ['title'], 'issue');
    expect(diffs).toHaveLength(0);
  });
});

describe('applyResolutions', () => {
  it('applies remote resolutions', () => {
    const local = { title: 'mine', status: 'open' };
    const changes = [
      { field: 'title', base: 'old', local: 'mine', remote: 'theirs', resolution: 'remote' as const },
    ];
    const result = applyResolutions(local, changes);
    expect(result.title).toBe('theirs');
    expect(result.status).toBe('open');
  });

  it('keeps local for local resolutions', () => {
    const local = { title: 'mine' };
    const changes = [
      { field: 'title', base: 'old', local: 'mine', remote: 'theirs', resolution: 'local' as const },
    ];
    const result = applyResolutions(local, changes);
    expect(result.title).toBe('mine');
  });

  it('applies manual value', () => {
    const local = { title: 'mine' };
    const changes = [
      { field: 'title', base: 'old', local: 'mine', remote: 'theirs', resolution: 'manual' as const, manualValue: 'custom' },
    ];
    const result = applyResolutions(local, changes);
    expect(result.title).toBe('custom');
  });
});

describe('sync properties', () => {
  it('no-op: syncing with no changes produces no operations', () => {
    const data = { title: 'same', status: 'open' };
    const base = new Map([['r1', { ...data }]]);
    const local = new Map([['r1', { ...data }]]);
    const remote = new Map([['r1', { ...data }]]);
    const diffs = computeDiffs(base, local, remote, ['title', 'status'], 'issue');
    expect(diffs).toHaveLength(0);
  });

  it('no data loss: field changed on only one side always survives', () => {
    const base = new Map([['r1', { title: 'old', status: 'open' }]]);
    const local = new Map([['r1', { title: 'new-local', status: 'open' }]]);
    const remote = new Map([['r1', { title: 'old', status: 'closed' }]]);
    const diffs = computeDiffs(base, local, remote, ['title', 'status'], 'issue');
    expect(diffs).toHaveLength(1);
    const d = diffs[0];
    const titleChange = d.fields.find(f => f.field === 'title');
    const statusChange = d.fields.find(f => f.field === 'status');
    expect(titleChange?.resolution).toBe('local');
    expect(statusChange?.resolution).toBe('remote');
    expect(titleChange?.local).toBe('new-local');
    expect(statusChange?.remote).toBe('closed');
  });

  it('convergence: after resolving conflicts, merged values agree', () => {
    const base = new Map([['r1', { title: 'old' }]]);
    const local = new Map([['r1', { title: 'mine' }]]);
    const remote = new Map([['r1', { title: 'theirs' }]]);
    const diffs = computeDiffs(base, local, remote, ['title'], 'issue');
    expect(diffs).toHaveLength(1);
    diffs[0].fields[0].resolution = 'remote';
    const merged = applyResolutions(
      { title: 'mine' },
      diffs[0].fields,
    );
    expect(merged.title).toBe('theirs');
  });
});
