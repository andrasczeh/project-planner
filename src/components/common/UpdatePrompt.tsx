import { useState, useEffect } from 'react';
import { checkForUpdate, applyUpdate, dismissVersion, type ReleaseInfo } from '../../utils/version';

export function UpdatePrompt() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    checkForUpdate().then(setRelease);
  }, []);

  if (!release) return null;

  const handleUpdate = () => {
    setUpdating(true);
    applyUpdate();
  };

  const handleDismiss = () => {
    dismissVersion(release.version);
    setRelease(null);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
      left: '16px',
      right: '16px',
      maxWidth: '420px',
      margin: '0 auto',
      background: 'var(--bg-surface)',
      border: '1px solid var(--accent)',
      borderRadius: 'var(--radius)',
      padding: '16px',
      zIndex: 1300,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      animation: 'toast-in 300ms ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
          <path d="M12 2v13" /><path d="m6 9 6 6 6-6" /><path d="M4 20h16" />
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>
            Version {release.version} available
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            Reload to update. Your local data is not affected.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
        {release.url && (
          <a
            className="btn btn-secondary btn-sm"
            href={release.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Release notes
          </a>
        )}
        <button className="btn btn-secondary btn-sm" onClick={handleDismiss} disabled={updating}>
          Later
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleUpdate} disabled={updating}>
          {updating ? 'Updating…' : 'Reload'}
        </button>
      </div>
    </div>
  );
}
