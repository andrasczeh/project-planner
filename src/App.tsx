import { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { ToastProvider } from './components/common/Toast';
import { Modal } from './components/common/Modal';
import { ProjectForm } from './components/common/ProjectForm';
import { InstallPrompt } from './components/common/InstallPrompt';
import { UpdatePrompt } from './components/common/UpdatePrompt';
import { ProjectView } from './views/ProjectView';
import { GanttView } from './views/GanttView';
import { PersonViewPage } from './components/person/PersonView';
import { SettingsView } from './views/SettingsView';
import { createProject } from './commands';
import { requestPersistentStorage } from './db';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useSyncStatus } from './hooks/useSyncStatus';
import { tryAutoReconnect } from './sync/session';
import { useProject } from './hooks/useProjects';
import type { ID } from './types';

function AppContent() {
  const [activeView, setActiveView] = useState('gantt');
  const [activeProjectId, setActiveProjectId] = useState<ID | undefined>();
  const [showNewProject, setShowNewProject] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeProject = useProject(activeProjectId);
  const { performUndo, performRedo, canUndo, canRedo } = useUndoRedo();
  const syncStatus = useSyncStatus();

  const mobileTitle = activeView === 'project' && activeProject
    ? activeProject.name
    : activeView === 'gantt' ? 'Gantt Chart'
    : activeView === 'people' ? 'People'
    : activeView === 'settings' ? 'Settings'
    : 'Project Planner';

  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch.clientX < 30 && !sidebarOpen) {
      touchStart.current = { x: touch.clientX, y: touch.clientY };
    }
  }, [sidebarOpen]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStart.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = Math.abs(touch.clientY - touchStart.current.y);
    touchStart.current = null;
    if (dx > 60 && dy < dx) {
      setSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchEnd]);

  useEffect(() => {
    requestPersistentStorage();
    tryAutoReconnect();
  }, []);

  const handleNavigate = (view: string, projectId?: ID) => {
    setActiveView(view);
    setActiveProjectId(projectId);
  };

  const handleNewProject = async (data: { name: string; description?: string; statuses: string[]; defaultStatus: string }) => {
    const project = await createProject({ ...data, customFieldDefs: [] });
    setShowNewProject(false);
    setActiveView('project');
    setActiveProjectId(project.id);
  };

  const renderView = () => {
    switch (activeView) {
      case 'project':
        if (!activeProjectId) return <div className="view-body"><p>Select a project</p></div>;
        return <ProjectView projectId={activeProjectId} onDeleted={() => handleNavigate('gantt')} />;
      case 'gantt':
        return (
          <div className="main-content">
            <GanttView projectId={activeProjectId} />
          </div>
        );
      case 'people':
        return <PersonViewPage />;
      case 'settings':
        return <SettingsView />;
      default:
        return <div className="view-body"><p>Select a view</p></div>;
    }
  };

  return (
    <div className="app-layout">
      <div className="mobile-header">
        <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <div className="hamburger-icon">
            <span /><span /><span />
          </div>
        </button>
        <h1>{mobileTitle}</h1>
        <div className="header-actions">
          <button className="btn-icon" onClick={performUndo} disabled={!canUndo} aria-label="Undo" title="Undo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button className="btn-icon" onClick={performRedo} disabled={!canRedo} aria-label="Redo" title="Redo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </button>
          {syncStatus !== 'disconnected' && (
            <span
              className={`sync-indicator${syncStatus === 'syncing' || syncStatus === 'searching' ? ' syncing' : ''}`}
              title={syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'searching' ? 'Searching for peer...' : 'Sync active'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6" />
                <path d="M2.5 11.5a10 10 0 0 1 17.3-6.4L21.5 8M21.5 12.5a10 10 0 0 1-17.3 6.4L2.5 16" />
              </svg>
            </span>
          )}
        </div>
      </div>

      <Sidebar
        activeView={activeView}
        activeProjectId={activeProjectId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNavigate={handleNavigate}
        onNewProject={() => setShowNewProject(true)}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {renderView()}
      </div>

      <Modal open={showNewProject} onClose={() => setShowNewProject(false)}>
        <ProjectForm
          onSave={handleNewProject}
          onCancel={() => setShowNewProject(false)}
        />
      </Modal>

      <InstallPrompt />
      <UpdatePrompt />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
