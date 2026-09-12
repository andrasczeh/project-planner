import { useState } from 'react';
import { usePeople } from '../../hooks/usePeople';
import { useMilestones } from '../../hooks/useMilestones';
import type { Task, ID } from '../../types';

interface Props {
  projectId: ID;
  task?: Task;
  statuses: string[];
  parentId?: ID;
  onSave: (data: Omit<Task, 'id' | 'updatedAt'>) => void;
  onCancel: () => void;
}

export function TaskForm({ projectId, task, statuses, parentId, onSave, onCancel }: Props) {
  const people = usePeople();
  const milestones = useMilestones(projectId);

  const [title, setTitle] = useState(task?.title ?? '');
  const [body, setBody] = useState(task?.body ?? '');
  const [status, setStatus] = useState(task?.status ?? statuses[0] ?? 'backlog');
  const [priority, setPriority] = useState<string>(task?.priority?.toString() ?? '');
  const [labelsText, setLabelsText] = useState((task?.labels ?? []).join(', '));
  const [assigneeIds, setAssigneeIds] = useState<ID[]>(task?.assigneeIds ?? []);
  const [start, setStart] = useState(task?.start ?? '');
  const [end, setEnd] = useState(task?.end ?? '');
  const [estimateHours, setEstimateHours] = useState<string>(task?.estimateHours?.toString() ?? '');
  const [milestoneId, setMilestoneId] = useState(task?.milestoneId ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      projectId,
      parentId: parentId ?? task?.parentId,
      title: title.trim(),
      body,
      status,
      priority: priority ? Number(priority) : undefined,
      labels: labelsText.split(',').map(s => s.trim()).filter(Boolean),
      assigneeIds,
      start: start || undefined,
      end: end || undefined,
      estimateHours: estimateHours ? Number(estimateHours) : undefined,
      milestoneId: milestoneId || undefined,
      custom: task?.custom ?? {},
    });
  };

  const toggleAssignee = (personId: ID) => {
    setAssigneeIds(prev =>
      prev.includes(personId) ? prev.filter(id => id !== personId) : [...prev, personId]
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>{task ? 'Edit Task' : 'New Task'}</h2>

      <div className="form-group">
        <label>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      </div>

      <div className="form-group">
        <label>Description (Markdown)</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} />
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Priority (1=highest)</label>
          <input type="number" min="1" max="5" value={priority} onChange={e => setPriority(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Start date</label>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} />
        </div>

        <div className="form-group">
          <label>End date</label>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Estimate (hours)</label>
          <input type="number" min="0" step="0.5" value={estimateHours} onChange={e => setEstimateHours(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Milestone</label>
          <select value={milestoneId} onChange={e => setMilestoneId(e.target.value)}>
            <option value="">None</option>
            {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>Labels (comma-separated)</label>
        <input value={labelsText} onChange={e => setLabelsText(e.target.value)} />
      </div>

      <div className="form-group">
        <label>Assignees</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
          {people.map(p => (
            <button
              key={p.id}
              type="button"
              className={`chip ${assigneeIds.includes(p.id) ? 'chip-active' : ''}`}
              style={assigneeIds.includes(p.id) ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
              onClick={() => toggleAssignee(p.id)}
            >
              {p.name}
            </button>
          ))}
          {people.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No people added yet</span>}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">{task ? 'Save' : 'Create'}</button>
      </div>
    </form>
  );
}
