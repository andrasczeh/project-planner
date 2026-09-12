import { useState } from 'react';
import type { Project } from '../../types';

const DEFAULT_STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done'];

interface Props {
  project?: Project;
  onSave: (data: { name: string; description?: string; statuses: string[]; defaultStatus: string }) => void;
  onCancel: () => void;
}

export function ProjectForm({ project, onSave, onCancel }: Props) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [statusesText, setStatusesText] = useState(
    (project?.statuses ?? DEFAULT_STATUSES).join(', ')
  );
  const [defaultStatus, setDefaultStatus] = useState(project?.defaultStatus ?? 'backlog');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const statuses = statusesText.split(',').map(s => s.trim()).filter(Boolean);
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      statuses: statuses.length > 0 ? statuses : DEFAULT_STATUSES,
      defaultStatus: statuses.includes(defaultStatus) ? defaultStatus : statuses[0] ?? 'backlog',
    });
  };

  const statuses = statusesText.split(',').map(s => s.trim()).filter(Boolean);

  return (
    <form onSubmit={handleSubmit}>
      <h2>{project ? 'Edit Project' : 'New Project'}</h2>

      <div className="form-group">
        <label>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus />
      </div>

      <div className="form-group">
        <label>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
      </div>

      <div className="form-group">
        <label>Statuses (comma-separated)</label>
        <input value={statusesText} onChange={e => setStatusesText(e.target.value)} />
      </div>

      <div className="form-group">
        <label>Default status</label>
        <select value={defaultStatus} onChange={e => setDefaultStatus(e.target.value)}>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">{project ? 'Save' : 'Create'}</button>
      </div>
    </form>
  );
}
