import type { RecordDiff, FieldChange } from '../../sync/diff';

interface Props {
  diffs: RecordDiff[];
  onResolve: (diffIdx: number, fieldIdx: number, resolution: 'local' | 'remote') => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DiffPreview({ diffs, onResolve, onConfirm, onCancel }: Props) {
  const hasConflicts = diffs.some(d => d.status === 'conflict');

  const statusLabel = (status: RecordDiff['status']) => {
    switch (status) {
      case 'push': return 'Push to remote';
      case 'pull': return 'Pull from remote';
      case 'conflict': return 'Conflict';
      case 'deleted-remote': return 'Deleted remotely';
      case 'deleted-local': return 'Deleted locally';
      default: return 'No change';
    }
  };

  const statusColor = (status: RecordDiff['status']) => {
    switch (status) {
      case 'push': return 'var(--accent)';
      case 'pull': return 'var(--success)';
      case 'conflict': return 'var(--warning)';
      case 'deleted-remote': return 'var(--danger)';
      case 'deleted-local': return 'var(--danger)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div style={{ maxWidth: '800px' }}>
      <h2>Sync Preview</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '13px' }}>
        {diffs.length} changes found. Review before applying.
      </p>

      {diffs.length === 0 ? (
        <div className="empty-state" style={{ padding: '20px' }}>
          <p>Everything is in sync.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '60vh', overflow: 'auto' }}>
          {diffs.map((diff, di) => (
            <div key={diff.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px',
              background: 'var(--bg)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontWeight: 500 }}>{diff.kind} #{diff.id.slice(-8)}</span>
                <span className="badge" style={{ borderColor: statusColor(diff.status) }}>
                  {statusLabel(diff.status)}
                </span>
              </div>

              {diff.fields.length > 0 && (
                <table style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Local</th>
                      <th>Remote</th>
                      <th>Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.fields.map((field, fi) => (
                      <FieldRow
                        key={field.field}
                        field={field}
                        onResolve={resolution => onResolve(di, fi, resolution)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="form-actions" style={{ marginTop: '16px' }}>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={onConfirm}
          disabled={hasConflicts}
        >
          {hasConflicts ? 'Resolve all conflicts first' : `Apply ${diffs.length} changes`}
        </button>
      </div>
    </div>
  );
}

function FieldRow({ field, onResolve }: { field: FieldChange; onResolve: (r: 'local' | 'remote') => void }) {
  const formatValue = (v: unknown) => {
    if (v === undefined || v === null) return '-';
    if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '...' : v;
    return JSON.stringify(v);
  };

  const isConflict = !field.resolution;

  return (
    <tr style={{ background: isConflict ? 'rgba(245, 158, 11, 0.1)' : 'transparent' }}>
      <td style={{ fontWeight: 500 }}>{field.field}</td>
      <td style={{
        color: field.resolution === 'local' ? 'var(--success)' : 'var(--text-secondary)',
        textDecoration: field.resolution === 'remote' ? 'line-through' : 'none',
      }}>
        {formatValue(field.local)}
      </td>
      <td style={{
        color: field.resolution === 'remote' ? 'var(--success)' : 'var(--text-secondary)',
        textDecoration: field.resolution === 'local' ? 'line-through' : 'none',
      }}>
        {formatValue(field.remote)}
      </td>
      <td>
        {isConflict ? (
          <div className="toolbar">
            <button className="btn btn-sm btn-secondary" onClick={() => onResolve('local')}>Keep mine</button>
            <button className="btn btn-sm btn-secondary" onClick={() => onResolve('remote')}>Take theirs</button>
          </div>
        ) : (
          <span className="badge">{field.resolution === 'local' ? 'Keep mine' : 'Take theirs'}</span>
        )}
      </td>
    </tr>
  );
}
