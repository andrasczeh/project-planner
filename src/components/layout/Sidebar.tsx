import { useProjects } from '../../hooks/useProjects';
import { SyncPanel } from '../sync/SyncPanel';
import { FolderSync } from '../sync/FolderSync';
import type { ID } from '../../types';

interface Props {
  activeView: string;
  activeProjectId?: ID;
  open: boolean;
  onClose: () => void;
  onNavigate: (view: string, projectId?: ID) => void;
  onNewProject: () => void;
}

export function Sidebar({ activeView, activeProjectId, open, onClose, onNavigate, onNewProject }: Props) {
  const projects = useProjects();

  const navigate = (view: string, projectId?: ID) => {
    onNavigate(view, projectId);
    onClose();
  };

  return (
    <div className={`sidebar-wrapper ${open ? 'open' : ''}`}>
      <div className="sidebar-overlay" onClick={onClose} />
      <nav className="sidebar">
        <div className="sidebar-header">
          <span>Project Planner</span>
          <button className="sidebar-close" onClick={onClose} aria-label="Close menu">
            &times;
          </button>
        </div>

        <div className="sidebar-section">
          <button
            className={`sidebar-item ${activeView === 'gantt' && !activeProjectId ? 'active' : ''}`}
            onClick={() => navigate('gantt')}
          >
            Gantt Chart
          </button>
          <button
            className={`sidebar-item ${activeView === 'people' ? 'active' : ''}`}
            onClick={() => navigate('people')}
          >
            People
          </button>
          <button
            className={`sidebar-item ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            Settings
          </button>
        </div>

        <div className="sidebar-section" style={{ flex: 1 }}>
          <div className="sidebar-section-title">Projects</div>
          {projects.map(p => (
            <button
              key={p.id}
              className={`sidebar-item ${activeProjectId === p.id ? 'active' : ''}`}
              onClick={() => navigate('project', p.id)}
            >
              {p.name}
            </button>
          ))}
          <button className="sidebar-item" onClick={() => { onNewProject(); onClose(); }}>
            + New Project
          </button>
        </div>

        <SyncPanel />
        {activeProjectId && (
          <div style={{ padding: '8px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Folder Sync</div>
            <FolderSync projectId={activeProjectId} />
          </div>
        )}
      </nav>
    </div>
  );
}
