import { useState } from 'react';
import { useProject } from '../hooks/useProjects';
import { useTasks, useDependencies } from '../hooks/useTasks';
import { useMilestones } from '../hooks/useMilestones';
import { usePeople } from '../hooks/usePeople';
import { Modal } from '../components/common/Modal';
import { TaskForm } from '../components/common/TaskForm';
import { MilestoneForm } from '../components/common/MilestoneForm';
import { useToast } from '../components/common/Toast';
import {
  createTask,
  updateTask,
  deleteTask,
  createMilestone,
  updateMilestone,
  createDependency,
  deleteDependency,
  updateProject,
  deleteProject,
} from '../commands';
import { ProjectForm } from '../components/common/ProjectForm';
import { SyncPanel } from '../components/sync/SyncPanel';
import type { Task, Milestone as MilestoneType, ID } from '../types';

interface Props {
  projectId: ID;
  onDeleted: () => void;
}

export function ProjectView({ projectId, onDeleted }: Props) {
  const project = useProject(projectId);
  const tasks = useTasks(projectId);
  const milestones = useMilestones(projectId);
  const people = usePeople();
  const deps = useDependencies(projectId);
  const { showToast } = useToast();

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<MilestoneType | undefined>();
  const [showProjectEdit, setShowProjectEdit] = useState(false);
  const [showDepForm, setShowDepForm] = useState(false);
  const [depFrom, setDepFrom] = useState('');
  const [depTo, setDepTo] = useState('');
  const [parentId, setParentId] = useState<ID | undefined>();

  if (!project) return <div className="view-body"><p>Project not found</p></div>;

  const rootTasks = tasks.filter(t => !t.parentId);
  const childTasks = (pid: ID) => tasks.filter(t => t.parentId === pid);
  const personName = (id: ID) => people.find(p => p.id === id)?.name ?? 'Unknown';

  const statusColor = (status: string) => {
    if (status === 'done') return 'var(--success)';
    if (status === 'in-progress') return 'var(--accent)';
    if (status === 'review') return 'var(--warning)';
    return 'var(--text-muted)';
  };

  const handleSaveTask = async (data: Omit<Task, 'id' | 'updatedAt'>) => {
    if (editingTask) {
      await updateTask(editingTask.id, data);
      showToast('Task updated', 'success');
    } else {
      await createTask(data);
      showToast('Task created', 'success');
    }
    setShowTaskForm(false);
    setEditingTask(undefined);
    setParentId(undefined);
  };

  const handleDeleteTask = async (id: ID) => {
    await deleteTask(id);
    showToast('Task deleted');
  };

  const handleSaveMilestone = async (data: { projectId: ID; title: string; due?: string }) => {
    if (editingMilestone) {
      await updateMilestone(editingMilestone.id, data);
      showToast('Milestone updated', 'success');
    } else {
      await createMilestone(data);
      showToast('Milestone created', 'success');
    }
    setShowMilestoneForm(false);
    setEditingMilestone(undefined);
  };

  const handleAddDep = async () => {
    if (!depFrom || !depTo || depFrom === depTo) return;
    await createDependency({ fromId: depFrom, toId: depTo, type: 'FS', lagDays: 0 });
    showToast('Dependency added', 'success');
    setShowDepForm(false);
    setDepFrom('');
    setDepTo('');
  };

  const handleDeleteProject = async () => {
    if (!confirm('Delete this project and all its data?')) return;
    await deleteProject(projectId);
    onDeleted();
  };

  const renderTaskRows = (taskList: Task[], depth: number): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    for (const task of taskList) {
      const children = childTasks(task.id);
      const taskDeps = deps.filter(d => d.toId === task.id);
      rows.push(
        <tr
          key={task.id}
          style={{ cursor: 'pointer' }}
          onClick={() => { setEditingTask(task); setShowTaskForm(true); }}
        >
          <td style={{ paddingLeft: `${12 + depth * 20}px`, whiteSpace: 'normal' }}>
            <span className="status-dot" style={{ background: statusColor(task.status), marginRight: '8px' }} />
            {task.title}
            {children.length > 0 && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>({children.length})</span>}
          </td>
          <td>
            <span className="badge">{task.status}</span>
          </td>
          <td className="hide-mobile">{task.assigneeIds.map(personName).join(', ') || '-'}</td>
          <td className="hide-mobile">{task.start ?? '-'}</td>
          <td className="hide-mobile">{task.end ?? '-'}</td>
          <td className="hide-mobile">{task.priority ?? '-'}</td>
          <td className="hide-mobile">
            {taskDeps.map(d => {
              const fromTask = tasks.find(t => t.id === d.fromId);
              return <span key={d.id} className="chip" style={{ marginRight: '4px' }}>{fromTask?.title ?? d.fromId}</span>;
            })}
          </td>
          <td className="hide-mobile">
            <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
              <button className="btn btn-sm btn-secondary" onClick={e => { e.stopPropagation(); setParentId(task.id); setEditingTask(undefined); setShowTaskForm(true); }}>
                + Sub
              </button>
              <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); handleDeleteTask(task.id); }}>
                Del
              </button>
            </div>
          </td>
        </tr>
      );
      if (children.length > 0) {
        rows.push(...renderTaskRows(children, depth + 1));
      }
    }
    return rows;
  };

  return (
    <div className="main-content">
      <div className="view-header">
        <div style={{ minWidth: 0 }}>
          <h1>{project.name}</h1>
          {project.description && <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{project.description}</span>}
        </div>
        <div className="toolbar">
          <button className="btn btn-sm btn-secondary" onClick={() => setShowProjectEdit(true)}>Edit</button>
          <button className="btn btn-sm btn-danger" onClick={handleDeleteProject}>Delete</button>
        </div>
      </div>

      <div className="view-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <div className="toolbar">
            <button className="btn btn-sm btn-primary" onClick={() => { setEditingTask(undefined); setParentId(undefined); setShowTaskForm(true); }}>
              + Task
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => { setEditingMilestone(undefined); setShowMilestoneForm(true); }}>
              + Milestone
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowDepForm(true)}>
              + Dep
            </button>
          </div>
          <div className="toolbar">
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{tasks.length} tasks</span>
            <SyncPanel projectId={projectId} />
          </div>
        </div>

        {milestones.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Milestones</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {milestones.map(m => (
                <span
                  key={m.id}
                  className="badge"
                  style={{ cursor: 'pointer' }}
                  onClick={() => { setEditingMilestone(m); setShowMilestoneForm(true); }}
                >
                  {m.title}{m.due ? ` (${m.due})` : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="empty-state">
            <h3>No tasks yet</h3>
            <p>Create your first task to get started.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th className="hide-mobile">Assignees</th>
                  <th className="hide-mobile">Start</th>
                  <th className="hide-mobile">End</th>
                  <th className="hide-mobile">Priority</th>
                  <th className="hide-mobile">Depends on</th>
                  <th className="hide-mobile"></th>
                </tr>
              </thead>
              <tbody>
                {renderTaskRows(rootTasks, 0)}
              </tbody>
            </table>
          </div>
        )}

        {deps.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Dependencies</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>From</th><th>To</th><th>Type</th><th>Lag</th><th></th></tr>
                </thead>
                <tbody>
                  {deps.map(d => (
                    <tr key={d.id}>
                      <td>{tasks.find(t => t.id === d.fromId)?.title ?? d.fromId}</td>
                      <td>{tasks.find(t => t.id === d.toId)?.title ?? d.toId}</td>
                      <td>{d.type}</td>
                      <td>{d.lagDays}d</td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={() => deleteDependency(d.id)}>Del</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal open={showTaskForm} onClose={() => { setShowTaskForm(false); setEditingTask(undefined); setParentId(undefined); }}>
        <TaskForm
          projectId={projectId}
          task={editingTask}
          statuses={project.statuses}
          parentId={parentId}
          onSave={handleSaveTask}
          onCancel={() => { setShowTaskForm(false); setEditingTask(undefined); setParentId(undefined); }}
        />
      </Modal>

      <Modal open={showMilestoneForm} onClose={() => { setShowMilestoneForm(false); setEditingMilestone(undefined); }}>
        <MilestoneForm
          projectId={projectId}
          milestone={editingMilestone}
          onSave={handleSaveMilestone}
          onCancel={() => { setShowMilestoneForm(false); setEditingMilestone(undefined); }}
        />
      </Modal>

      <Modal open={showProjectEdit} onClose={() => setShowProjectEdit(false)}>
        <ProjectForm
          project={project}
          onSave={async data => {
            await updateProject(projectId, { ...data, customFieldDefs: project.customFieldDefs });
            setShowProjectEdit(false);
            showToast('Project updated', 'success');
          }}
          onCancel={() => setShowProjectEdit(false)}
        />
      </Modal>

      <Modal open={showDepForm} onClose={() => setShowDepForm(false)}>
        <h2>Add Dependency</h2>
        <div className="form-group">
          <label>From (must finish first)</label>
          <select value={depFrom} onChange={e => setDepFrom(e.target.value)}>
            <option value="">Select task...</option>
            {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>To (starts after)</label>
          <select value={depTo} onChange={e => setDepTo(e.target.value)}>
            <option value="">Select task...</option>
            {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={() => setShowDepForm(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAddDep}>Add</button>
        </div>
      </Modal>
    </div>
  );
}
