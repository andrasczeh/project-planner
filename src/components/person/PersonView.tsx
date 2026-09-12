import React, { useState, useMemo } from 'react';
import { usePeople } from '../../hooks/usePeople';
import { useTasks } from '../../hooks/useTasks';
import { Modal } from '../common/Modal';
import { PersonForm } from '../common/PersonForm';
import { useToast } from '../common/Toast';
import { createPerson, updatePerson, deletePerson } from '../../commands';
import { parseDate, addDays, formatDate, diffDays, workingDaysBetween, monthLabel } from '../../utils/dates';
import type { Task, Person, ID } from '../../types';

const ROW_HEIGHT = 64;
const DAY_WIDTH = 14;
const HEADER_HEIGHT = 50;

interface PersonLoad {
  person: Person | null;
  tasks: Task[];
  dailyLoad: Map<string, number>;
}

function computeLoads(people: Person[], tasks: Task[]): PersonLoad[] {
  const scheduledTasks = tasks.filter(t => t.start && t.end);

  const loads: PersonLoad[] = people.map(person => {
    const myTasks = scheduledTasks.filter(t => t.assigneeIds.includes(person.id));
    const dailyLoad = new Map<string, number>();

    for (const task of myTasks) {
      if (!task.start || !task.end) continue;
      const wdays = workingDaysBetween(task.start, task.end, person.workDays);
      if (wdays === 0) continue;
      const hoursPerDay = (task.estimateHours ?? wdays * person.hoursPerDay) / wdays / task.assigneeIds.length;
      const cur = parseDate(task.start);
      const end = parseDate(task.end);
      while (cur <= end) {
        if (person.workDays.includes(cur.getDay())) {
          const key = formatDate(cur);
          dailyLoad.set(key, (dailyLoad.get(key) ?? 0) + hoursPerDay);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    return { person, tasks: myTasks, dailyLoad };
  });

  const unassigned = scheduledTasks.filter(t => t.assigneeIds.length === 0);
  if (unassigned.length > 0) {
    loads.push({
      person: null,
      tasks: unassigned,
      dailyLoad: new Map(),
    });
  }

  return loads;
}

export function PersonViewPage() {
  const people = usePeople();
  const allTasks = useTasks();
  const { showToast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | undefined>();
  const loads = useMemo(() => computeLoads(people, allTasks), [people, allTasks]);

  const scheduledTasks = allTasks.filter(t => t.start && t.end);
  const dateRange = useMemo(() => {
    if (scheduledTasks.length === 0) {
      const today = new Date();
      return { start: addDays(today, -7), end: addDays(today, 60) };
    }
    let min = parseDate(scheduledTasks[0].start!);
    let max = parseDate(scheduledTasks[0].end!);
    for (const t of scheduledTasks) {
      const s = parseDate(t.start!);
      const e = parseDate(t.end!);
      if (s < min) min = s;
      if (e > max) max = e;
    }
    return { start: addDays(min, -7), end: addDays(max, 14) };
  }, [scheduledTasks]);

  const totalDays = diffDays(dateRange.start, dateRange.end);
  const chartWidth = totalDays * DAY_WIDTH;
  const today = new Date();

  const handleSavePerson = async (data: { name: string; hoursPerDay: number; workDays: number[]; providerLogins: Record<string, string> }) => {
    if (editingPerson) {
      await updatePerson(editingPerson.id, data);
      showToast('Person updated', 'success');
    } else {
      await createPerson(data);
      showToast('Person added', 'success');
    }
    setShowForm(false);
    setEditingPerson(undefined);
  };

  const handleDeletePerson = async (id: ID) => {
    if (!confirm('Remove this person?')) return;
    await deletePerson(id);
    showToast('Person removed');
  };

  const loadColor = (hours: number, capacity: number) => {
    const ratio = hours / capacity;
    if (ratio <= 0.8) return 'var(--capacity-ok)';
    if (ratio <= 1.0) return 'var(--capacity-warn)';
    return 'var(--overload)';
  };

  const renderTimeline = () => {
    const headers: React.ReactElement[] = [];
    const cur = new Date(dateRange.start);
    let lastMonth = '';
    let i = 0;
    while (i < totalDays) {
      const ml = monthLabel(cur);
      if (ml !== lastMonth) {
        headers.push(
          <text key={`m-${i}`} x={i * DAY_WIDTH + 4} y={16} fill="var(--text-secondary)" fontSize="11" fontWeight="600">
            {ml}
          </text>
        );
        lastMonth = ml;
      }
      if (cur.getDay() === 1) {
        headers.push(
          <text key={`d-${i}`} x={i * DAY_WIDTH + 2} y={36} fill="var(--text-muted)" fontSize="9">
            {cur.getDate()}
          </text>
        );
      }
      cur.setDate(cur.getDate() + 1);
      i++;
    }
    return headers;
  };

  const renderLoadRow = (load: PersonLoad, rowIdx: number) => {
    const y = HEADER_HEIGHT + rowIdx * ROW_HEIGHT;
    const person = load.person;
    const capacity = person?.hoursPerDay ?? 8;

    const bars: React.ReactElement[] = [];
    for (const task of load.tasks) {
      if (!task.start || !task.end) continue;
      const x = diffDays(dateRange.start, parseDate(task.start)) * DAY_WIDTH;
      const w = Math.max((diffDays(parseDate(task.start), parseDate(task.end)) + 1) * DAY_WIDTH, 4);
      bars.push(
        <rect
          key={task.id}
          x={x} y={y + 8} width={w} height={20} rx={3}
          fill="var(--gantt-bar)" opacity={0.7}
          style={{ cursor: 'pointer' }}
          onClick={() => {}}
        >
          <title>{task.title}</title>
        </rect>
      );
      if (w > 50) {
        bars.push(
          <text key={`t-${task.id}`} x={x + 4} y={y + 22} fill="#fff" fontSize="10" pointerEvents="none">
            {task.title}
          </text>
        );
      }
    }

    if (person) {
      const loadIndicators: React.ReactElement[] = [];
      const cur = new Date(dateRange.start);
      for (let d = 0; d < totalDays; d++) {
        const key = formatDate(cur);
        const hours = load.dailyLoad.get(key);
        if (hours && hours > 0) {
          const ratio = Math.min(hours / capacity, 2);
          loadIndicators.push(
            <rect
              key={`load-${d}`}
              x={d * DAY_WIDTH} y={y + 32} width={DAY_WIDTH - 1} height={Math.min(ratio * 14, 28)}
              fill={loadColor(hours, capacity)} opacity={0.4} rx={1}
            >
              <title>{`${hours.toFixed(1)}h / ${capacity}h`}</title>
            </rect>
          );
        }
        cur.setDate(cur.getDate() + 1);
      }
      return <g key={person.id}>{bars}{loadIndicators}</g>;
    }

    return <g key="unassigned">{bars}</g>;
  };

  const svgHeight = HEADER_HEIGHT + loads.length * ROW_HEIGHT + 20;

  return (
    <div className="main-content">
      <div className="view-header">
        <h1>People</h1>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => { setEditingPerson(undefined); setShowForm(true); }}>
            + Person
          </button>
        </div>
      </div>

      {people.length === 0 ? (
        <div className="view-body">
          <div className="empty-state">
            <h3>No people yet</h3>
            <p>Add team members to see workload and allocation.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div className="chart-labels" style={{ overflow: 'auto' }}>
            <div style={{ height: HEADER_HEIGHT, borderBottom: '1px solid var(--border)', padding: '0 12px', display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Person</span>
            </div>
            {loads.map((load) => (
              <div
                key={load.person?.id ?? 'unassigned'}
                style={{
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 12px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
                onClick={() => load.person && (setEditingPerson(load.person), setShowForm(true))}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{load.person?.name ?? 'Unassigned'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {load.tasks.length} tasks
                    {load.person && ` · ${load.person.hoursPerDay}h/day`}
                  </div>
                </div>
                {load.person && (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={e => { e.stopPropagation(); handleDeletePerson(load.person!.id); }}
                  >
                    Del
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            <svg width={chartWidth} height={svgHeight} style={{ display: 'block' }}>
              {renderTimeline()}
              <line x1={0} y1={HEADER_HEIGHT} x2={chartWidth} y2={HEADER_HEIGHT} stroke="var(--border)" />
              {(() => {
                const todayX = diffDays(dateRange.start, today) * DAY_WIDTH;
                return todayX >= 0 && todayX <= chartWidth ? (
                  <line x1={todayX} y1={0} x2={todayX} y2={svgHeight} stroke="var(--accent)" strokeWidth={1.5} opacity={0.6} />
                ) : null;
              })()}
              {loads.map((load, i) => renderLoadRow(load, i))}
              {loads.map((_, i) => (
                <line key={`row-${i}`} x1={0} y1={HEADER_HEIGHT + (i + 1) * ROW_HEIGHT} x2={chartWidth} y2={HEADER_HEIGHT + (i + 1) * ROW_HEIGHT} stroke="var(--border)" opacity={0.3} />
              ))}
            </svg>
          </div>
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingPerson(undefined); }}>
        <PersonForm
          person={editingPerson}
          onSave={handleSavePerson}
          onCancel={() => { setShowForm(false); setEditingPerson(undefined); }}
        />
      </Modal>
    </div>
  );
}
