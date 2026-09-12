export interface FieldChange {
  field: string;
  base: unknown;
  local: unknown;
  remote: unknown;
  resolution?: 'local' | 'remote' | 'manual';
  manualValue?: unknown;
}

export interface RecordDiff {
  id: string;
  kind: string;
  status: 'push' | 'pull' | 'conflict' | 'noop' | 'deleted-local' | 'deleted-remote';
  fields: FieldChange[];
}

export function diffFields(
  base: Record<string, unknown> | undefined,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  mappedFields: string[],
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const field of mappedFields) {
    const bVal = base?.[field];
    const lVal = local[field];
    const rVal = remote[field];

    const bStr = JSON.stringify(bVal);
    const lStr = JSON.stringify(lVal);
    const rStr = JSON.stringify(rVal);

    const localChanged = bStr !== lStr;
    const remoteChanged = bStr !== rStr;

    if (!localChanged && !remoteChanged) continue;
    if (lStr === rStr) continue;

    if (localChanged && !remoteChanged) {
      changes.push({ field, base: bVal, local: lVal, remote: rVal, resolution: 'local' });
    } else if (!localChanged && remoteChanged) {
      changes.push({ field, base: bVal, local: lVal, remote: rVal, resolution: 'remote' });
    } else {
      changes.push({ field, base: bVal, local: lVal, remote: rVal });
    }
  }

  return changes;
}

export function classifyDiff(changes: FieldChange[]): RecordDiff['status'] {
  if (changes.length === 0) return 'noop';

  const hasConflict = changes.some(c => !c.resolution);
  if (hasConflict) return 'conflict';

  const allLocal = changes.every(c => c.resolution === 'local');
  if (allLocal) return 'push';

  const allRemote = changes.every(c => c.resolution === 'remote');
  if (allRemote) return 'pull';

  return 'conflict';
}

export function computeDiffs(
  baseSnapshots: Map<string, Record<string, unknown>>,
  localRecords: Map<string, Record<string, unknown>>,
  remoteRecords: Map<string, Record<string, unknown>>,
  mappedFields: string[],
  kind: string,
): RecordDiff[] {
  const allIds = new Set([...localRecords.keys(), ...remoteRecords.keys()]);
  const diffs: RecordDiff[] = [];

  for (const id of allIds) {
    const base = baseSnapshots.get(id);
    const local = localRecords.get(id);
    const remote = remoteRecords.get(id);

    if (local && !remote && base) {
      diffs.push({ id, kind, status: 'deleted-remote', fields: [] });
      continue;
    }

    if (!local && remote) {
      diffs.push({ id, kind, status: 'pull', fields: Object.keys(remote).filter(f => mappedFields.includes(f)).map(f => ({
        field: f, base: undefined, local: undefined, remote: remote[f], resolution: 'remote' as const,
      }))});
      continue;
    }

    if (local && remote) {
      const fields = diffFields(base, local, remote, mappedFields);
      const status = classifyDiff(fields);
      if (status !== 'noop') {
        diffs.push({ id, kind, status, fields });
      }
    }
  }

  return diffs;
}

export function applyResolutions(
  local: Record<string, unknown>,
  changes: FieldChange[],
): Record<string, unknown> {
  const result = { ...local };
  for (const c of changes) {
    if (c.resolution === 'remote') {
      result[c.field] = c.remote;
    } else if (c.resolution === 'manual' && c.manualValue !== undefined) {
      result[c.field] = c.manualValue;
    }
  }
  return result;
}
