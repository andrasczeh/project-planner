import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  exportBackup,
  importBackup,
  downloadJson,
  wipeAllData,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  type BackupData,
} from '../utils/backup';
import { requestPersistentStorage, getStorageEstimate, db } from '../db';
import { useToast } from '../components/common/Toast';

export function SettingsView() {
  const { showToast } = useToast();
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersistent);
    getStorageEstimate().then(setStorage);
  }, []);

  const handleExport = async () => {
    const data = await exportBackup();
    downloadJson(data, `project-planner-backup-${new Date().toISOString().slice(0, 10)}.json`);
    showToast('Backup exported', 'success');
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as BackupData;
        const { counts } = await importBackup(data);
        const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
        showToast(`Imported: ${summary}`, 'success');
      } catch (err) {
        showToast(`Import failed: ${(err as Error).message}`, 'error');
      }
    };
    input.click();
  };

  const handlePersist = async () => {
    const granted = await requestPersistentStorage();
    setPersistent(granted);
    showToast(granted ? 'Persistent storage granted' : 'Persistent storage denied', granted ? 'success' : 'error');
  };

  const handleWipe = async () => {
    if (!confirm('This will delete ALL local data. Are you sure?')) return;
    if (!confirm('This action cannot be undone. Continue?')) return;
    await wipeAllData();
  };

  const handleCreateSnapshot = async () => {
    const label = prompt('Snapshot name?', `Manual — ${new Date().toLocaleString()}`);
    if (!label) return;
    const snapshot = await createSnapshot(label, false);
    showToast(`Snapshot saved (${formatBytes(snapshot.bytes)})`, 'success');
  };

  const handleRestoreSnapshot = async (id: string, label: string) => {
    if (!confirm(`Restore "${label}"? Current data is snapshotted first, then replaced.`)) return;
    try {
      const { counts } = await restoreSnapshot(id);
      const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
      showToast(`Restored: ${summary}`, 'success');
    } catch (err) {
      showToast(`Restore failed: ${(err as Error).message}`, 'error');
    }
  };

  const snapshots = useLiveQuery(() => db.snapshots.orderBy('createdAt').reverse().toArray(), [], []);

  return (
    <div className="main-content">
      <div className="view-header">
        <h1>Settings</h1>
      </div>
      <div className="view-body" style={{ maxWidth: '600px' }}>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Storage</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Persistent storage</span>
              {persistent === null ? (
                <span className="badge">Unknown</span>
              ) : persistent ? (
                <span className="badge" style={{ borderColor: 'var(--success)' }}>Granted</span>
              ) : (
                <button className="btn btn-sm btn-secondary" onClick={handlePersist}>Request</button>
              )}
            </div>
            {storage && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Usage</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
                </span>
              </div>
            )}
          </div>
        </section>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Backup & Restore</h2>
          <div className="toolbar">
            <button className="btn btn-secondary" onClick={handleExport}>Export JSON Backup</button>
            <button className="btn btn-secondary" onClick={handleImport}>Import Backup</button>
          </div>
        </section>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Snapshots</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '12px' }}>
            Point-in-time copies of all local data. One is taken automatically before any restore.
          </p>
          <div className="toolbar" style={{ marginBottom: '12px' }}>
            <button className="btn btn-secondary" onClick={handleCreateSnapshot}>Take Snapshot</button>
          </div>
          {snapshots.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No snapshots yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Name</th><th className="hide-mobile">Created</th><th className="hide-mobile">Size</th><th></th></tr>
                </thead>
                <tbody>
                  {snapshots.map(s => (
                    <tr key={s.id}>
                      <td style={{ whiteSpace: 'normal' }}>
                        {s.label}
                        {s.auto && <span className="badge" style={{ marginLeft: '6px' }}>auto</span>}
                      </td>
                      <td className="hide-mobile">{new Date(s.createdAt).toLocaleString()}</td>
                      <td className="hide-mobile">{formatBytes(s.bytes)}</td>
                      <td>
                        <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleRestoreSnapshot(s.id, s.label)}>
                            Restore
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => deleteSnapshot(s.id)}>Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Danger Zone</h2>
          <button className="btn btn-danger" onClick={handleWipe}>Wipe All Local Data</button>
        </section>

        <section>
          <h2 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>About</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
            Project Planner — a browser-only, local-first project management tool.
            All data is stored in IndexedDB on your device.
            No server, no tracking, no third-party scripts.
          </p>
        </section>
      </div>
    </div>
  );
}
