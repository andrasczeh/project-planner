import { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { DiffPreview } from './DiffPreview';
import { useToast } from '../common/Toast';
import { db } from '../../db';
import { computeSyncPlan, executeSyncPlan, type SyncPlan } from '../../sync/engine';
import { storeSecret, getSecret, deleteSecret } from '../../sync/secrets';
import type { RecordDiff } from '../../sync/diff';
import type { ProviderConfig } from '../../sync/types';

export function SyncPanel() {
  const { showToast } = useToast();
  const [configOpen, setConfigOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [diffs, setDiffs] = useState<RecordDiff[]>([]);

  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    getSecret('github:token').then(t => setHasToken(!!t));
  }, []);

  const handleSaveConfig = async () => {
    if (token) {
      await storeSecret('github:token', token);
      setHasToken(true);
      setToken('');
    }
    await db.meta.put({ key: 'github:repo', value: repo });
    setConfigOpen(false);
    showToast('GitHub config saved', 'success');
  };

  const handleRemoveToken = async () => {
    await deleteSecret('github:token');
    setHasToken(false);
    showToast('Token removed');
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const storedToken = await getSecret('github:token');
      if (!storedToken) {
        showToast('No GitHub token configured', 'error');
        return;
      }
      const repoMeta = await db.meta.get('github:repo');
      const repoName = (repoMeta?.value as string) ?? '';
      if (!repoName) {
        showToast('No repository configured', 'error');
        return;
      }

      const config: ProviderConfig = {
        provider: 'github',
        token: storedToken,
        repo: repoName,
      };

      const syncPlan = await computeSyncPlan(config);
      setPlan(syncPlan);
      setDiffs([...syncPlan.diffs]);

      if (syncPlan.diffs.length === 0) {
        showToast('Everything is in sync', 'success');
      } else {
        setPreviewOpen(true);
      }
    } catch (err) {
      showToast(`Sync error: ${(err as Error).message}`, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleResolve = (diffIdx: number, fieldIdx: number, resolution: 'local' | 'remote') => {
    setDiffs(prev => {
      const updated = [...prev];
      const diff = { ...updated[diffIdx] };
      diff.fields = [...diff.fields];
      diff.fields[fieldIdx] = { ...diff.fields[fieldIdx], resolution };
      const hasConflict = diff.fields.some(f => !f.resolution);
      diff.status = hasConflict ? 'conflict' : diff.fields.every(f => f.resolution === 'local') ? 'push' : 'pull';
      updated[diffIdx] = diff;
      return updated;
    });
  };

  const handleConfirm = async () => {
    if (!plan) return;
    setSyncing(true);
    try {
      const { pulled, pushed, errors } = await executeSyncPlan(plan, diffs);
      setPreviewOpen(false);
      if (errors.length > 0) {
        showToast(`Sync partial: ${pulled} pulled, ${pushed} pushed, ${errors.length} errors`, 'error');
      } else {
        showToast(`Sync complete: ${pulled} pulled, ${pushed} pushed`, 'success');
      }
    } catch (err) {
      showToast(`Sync failed: ${(err as Error).message}`, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div style={{
        padding: '8px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        gap: '6px',
        flexWrap: 'wrap',
      }}>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => setConfigOpen(true)}
        >
          GitHub {hasToken ? '(configured)' : '(setup)'}
        </button>
        {hasToken && (
          <button
            className="btn btn-sm btn-primary"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        )}
      </div>

      <Modal open={configOpen} onClose={() => setConfigOpen(false)}>
        <h2>GitHub Configuration</h2>
        <div className="form-group">
          <label>Repository (owner/repo)</label>
          <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/repo" />
        </div>
        <div className="form-group">
          <label>Personal Access Token</label>
          {hasToken ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge" style={{ borderColor: 'var(--success)' }}>Token stored</span>
              <button className="btn btn-sm btn-danger" onClick={handleRemoveToken}>Remove</button>
            </div>
          ) : (
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="ghp_..."
            />
          )}
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
          Fine-grained PAT with Issues (read/write) and Metadata (read) permissions.
          Tokens are encrypted in IndexedDB. This protects against casual disk inspection, not script injection.
        </p>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={() => setConfigOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSaveConfig}>Save</button>
        </div>
      </Modal>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)}>
        <DiffPreview
          diffs={diffs}
          onResolve={handleResolve}
          onConfirm={handleConfirm}
          onCancel={() => setPreviewOpen(false)}
        />
      </Modal>
    </>
  );
}
