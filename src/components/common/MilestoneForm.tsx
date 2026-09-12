import { useState } from 'react';
import type { Milestone, ID } from '../../types';

interface Props {
  projectId: ID;
  milestone?: Milestone;
  onSave: (data: { projectId: ID; title: string; due?: string }) => void;
  onCancel: () => void;
}

export function MilestoneForm({ projectId, milestone, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [due, setDue] = useState(milestone?.due ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      projectId,
      title: title.trim(),
      due: due || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>{milestone ? 'Edit Milestone' : 'New Milestone'}</h2>

      <div className="form-group">
        <label>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      </div>

      <div className="form-group">
        <label>Due date</label>
        <input type="date" value={due} onChange={e => setDue(e.target.value)} />
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">{milestone ? 'Save' : 'Create'}</button>
      </div>
    </form>
  );
}
