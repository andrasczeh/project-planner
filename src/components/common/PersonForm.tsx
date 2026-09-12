import { useState } from 'react';
import type { Person } from '../../types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  person?: Person;
  onSave: (data: { name: string; hoursPerDay: number; workDays: number[]; providerLogins: Record<string, string> }) => void;
  onCancel: () => void;
}

export function PersonForm({ person, onSave, onCancel }: Props) {
  const [name, setName] = useState(person?.name ?? '');
  const [hoursPerDay, setHoursPerDay] = useState(person?.hoursPerDay?.toString() ?? '8');
  const [workDays, setWorkDays] = useState<number[]>(person?.workDays ?? [1, 2, 3, 4, 5]);
  const [githubLogin, setGithubLogin] = useState(person?.providerLogins?.github ?? '');

  const toggleDay = (day: number) => {
    setWorkDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const providerLogins: Record<string, string> = {};
    if (githubLogin.trim()) providerLogins.github = githubLogin.trim();
    onSave({
      name: name.trim(),
      hoursPerDay: Number(hoursPerDay) || 8,
      workDays,
      providerLogins,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>{person ? 'Edit Person' : 'New Person'}</h2>

      <div className="form-group">
        <label>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus />
      </div>

      <div className="form-group">
        <label>Hours per day</label>
        <input type="number" min="1" max="24" value={hoursPerDay} onChange={e => setHoursPerDay(e.target.value)} />
      </div>

      <div className="form-group">
        <label>Work days</label>
        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
          {DAY_NAMES.map((d, i) => (
            <button
              key={i}
              type="button"
              className="chip"
              style={workDays.includes(i) ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
              onClick={() => toggleDay(i)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label>GitHub username</label>
        <input value={githubLogin} onChange={e => setGithubLogin(e.target.value)} placeholder="username" />
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">{person ? 'Save' : 'Add'}</button>
      </div>
    </form>
  );
}
