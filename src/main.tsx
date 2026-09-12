import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { initCommands } from './commands';

const root = createRoot(document.getElementById('root')!);

function renderFatal(err: unknown) {
  root.render(
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', color: '#e1e4ed' }}>
      <h1 style={{ fontSize: '17px', marginBottom: '12px' }}>Project Planner failed to start</h1>
      <p style={{ fontSize: '13px', color: '#8b91a5', marginBottom: '16px' }}>
        Your data is still on this device. Reload to try again; if this keeps happening, the message below says why.
      </p>
      <pre style={{
        fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: '#1a1d27', border: '1px solid #333847', borderRadius: '6px', padding: '12px',
      }}>{String(err instanceof Error ? err.stack ?? err.message : err)}</pre>
    </div>,
  );
}

// Startup must never leave a blank page: a failure here still renders a diagnosable message.
initCommands()
  .catch(err => console.error('initCommands failed; continuing in degraded mode', err))
  .then(() => {
    try {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    } catch (err) {
      renderFatal(err);
    }
  });

window.addEventListener('unhandledrejection', e => {
  if (document.getElementById('root')?.childElementCount === 0) renderFatal(e.reason);
});
