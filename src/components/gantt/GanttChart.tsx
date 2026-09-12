import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { Task, Dependency, ID } from '../../types';
import { parseDate, addDays, formatDate, diffDays, monthLabel, weekLabel } from '../../utils/dates';
import { updateTask } from '../../commands';

type ZoomLevel = 'day' | 'week' | 'month';

interface Props {
  tasks: Task[];
  dependencies: Dependency[];
  onEditTask: (task: Task) => void;
}

const ROW_HEIGHT = 36;
const BAR_HEIGHT = 22;
const BAR_Y_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const HEADER_HEIGHT = 50;
const MIN_BAR_WIDTH = 8;

const ZOOM_CONFIG: Record<ZoomLevel, { dayWidth: number; headerFormat: (d: Date) => string }> = {
  day:   { dayWidth: 30, headerFormat: (d: Date) => d.getDate().toString() },
  week:  { dayWidth: 12, headerFormat: weekLabel },
  month: { dayWidth: 4,  headerFormat: monthLabel },
};

function getDateRange(tasks: Task[]): { start: Date; end: Date } {
  const today = new Date();
  let min = new Date(today.getFullYear(), today.getMonth(), 1);
  let max = addDays(min, 90);

  for (const t of tasks) {
    if (t.start) {
      const s = parseDate(t.start);
      if (s < min) min = s;
    }
    if (t.end) {
      const e = parseDate(t.end);
      if (e > max) max = e;
    }
  }

  min = addDays(min, -7);
  max = addDays(max, 14);
  return { start: min, end: max };
}

export function GanttChart({ tasks, dependencies, onEditTask }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<ZoomLevel>(window.innerWidth <= 768 ? 'month' : 'week');
  const [dragging, setDragging] = useState<{ taskId: ID; mode: 'move' | 'resize-end'; startX: number; origStart: string; origEnd: string } | null>(null);
  const [dragDates, setDragDates] = useState<{ start: string; end: string; x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDrag = useRef<{ taskId: ID; mode: 'move' | 'resize-end'; startX: number; startY: number; origStart: string; origEnd: string; pointerId: number; target: Element } | null>(null);

  const config = ZOOM_CONFIG[zoom];
  const { start: rangeStart, end: rangeEnd } = useMemo(() => getDateRange(tasks), [tasks]);
  const totalDays = diffDays(rangeStart, rangeEnd);
  const chartWidth = totalDays * config.dayWidth;

  const sortedTasks = useMemo(() => {
    const roots = tasks.filter(t => !t.parentId);
    const result: { task: Task; depth: number }[] = [];
    const addChildren = (parent: ID, depth: number) => {
      const children = tasks.filter(t => t.parentId === parent);
      for (const child of children) {
        result.push({ task: child, depth });
        addChildren(child.id, depth + 1);
      }
    };
    for (const root of roots) {
      result.push({ task: root, depth: 0 });
      addChildren(root.id, 1);
    }
    return result;
  }, [tasks]);

  const today = new Date();
  const todayOffset = diffDays(rangeStart, today) * config.dayWidth;

  const getBarX = (dateStr: string) => diffDays(rangeStart, parseDate(dateStr)) * config.dayWidth;

  const isTouch = useCallback((e: React.PointerEvent) => e.pointerType === 'touch', []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pendingDrag.current = null;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, task: Task, mode: 'move' | 'resize-end') => {
    if (!task.start || !task.end) return;
    e.stopPropagation();
    e.preventDefault();

    (e.target as Element).setPointerCapture(e.pointerId);

    if (isTouch(e)) {
      pendingDrag.current = { taskId: task.id, mode, startX: e.clientX, startY: e.clientY, origStart: task.start, origEnd: task.end, pointerId: e.pointerId, target: e.target as Element };
      longPressTimer.current = setTimeout(() => {
        if (!pendingDrag.current) return;
        const pd = pendingDrag.current;
        setDragging({ taskId: pd.taskId, mode: pd.mode, startX: pd.startX, origStart: pd.origStart, origEnd: pd.origEnd });
        setDragDates({ start: pd.origStart, end: pd.origEnd, x: pd.startX, y: 0 });
        if (navigator.vibrate) navigator.vibrate(30);
        pendingDrag.current = null;
      }, 400);
    } else {
      setDragging({ taskId: task.id, mode, startX: e.clientX, origStart: task.start, origEnd: task.end });
      setDragDates({ start: task.start, end: task.end, x: e.clientX, y: e.clientY });
    }
  }, [isTouch]);

  const handlePendingPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pendingDrag.current) return;
    const dx = Math.abs(e.clientX - pendingDrag.current.startX);
    const dy = Math.abs(e.clientY - pendingDrag.current.startY);
    if (dx > 10 || dy > 10) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  useEffect(() => {
    if (!dragging) return;

    // The drag only previews; nothing is written until the pointer is released,
    // so a whole drag is one database write and one undo step.
    const datesAt = (clientX: number) => {
      const daysDelta = Math.round((clientX - dragging.startX) / config.dayWidth);
      if (dragging.mode === 'move') {
        return {
          start: formatDate(addDays(parseDate(dragging.origStart), daysDelta)),
          end: formatDate(addDays(parseDate(dragging.origEnd), daysDelta)),
        };
      }
      const end = formatDate(addDays(parseDate(dragging.origEnd), daysDelta));
      return {
        start: dragging.origStart,
        end: parseDate(end) < parseDate(dragging.origStart) ? dragging.origStart : end,
      };
    };

    const handlePointerMove = (e: PointerEvent) => {
      const { start, end } = datesAt(e.clientX);
      setDragDates({ start, end, x: e.clientX, y: e.clientY });
    };

    const handlePointerUp = (e: PointerEvent) => {
      const { start, end } = datesAt(e.clientX);
      if (start !== dragging.origStart || end !== dragging.origEnd) {
        updateTask(dragging.taskId, { start, end });
      }
      setDragging(null);
      setDragDates(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragging, config.dayWidth]);

  const renderHeader = () => {
    const headers: { x: number; width: number; label: string }[] = [];
    const subHeaders: { x: number; label: string }[] = [];
    const cur = new Date(rangeStart);

    if (zoom === 'month') {
      while (cur <= rangeEnd) {
        const monthStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
        const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
        const x = diffDays(rangeStart, monthStart) * config.dayWidth;
        const w = diffDays(monthStart, monthEnd) * config.dayWidth;
        headers.push({ x, width: w, label: monthLabel(monthStart) });
        cur.setMonth(cur.getMonth() + 1);
      }
    } else if (zoom === 'week') {
      let lastMonth = '';
      while (cur <= rangeEnd) {
        const ml = monthLabel(cur);
        if (ml !== lastMonth) {
          const x = diffDays(rangeStart, cur) * config.dayWidth;
          headers.push({ x, width: 0, label: ml });
          lastMonth = ml;
        }
        if (cur.getDay() === 1 || cur.getTime() === rangeStart.getTime()) {
          const x = diffDays(rangeStart, cur) * config.dayWidth;
          subHeaders.push({ x, label: cur.getDate().toString() });
        }
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      let lastMonth = '';
      while (cur <= rangeEnd) {
        const ml = monthLabel(cur);
        if (ml !== lastMonth) {
          const x = diffDays(rangeStart, cur) * config.dayWidth;
          headers.push({ x, width: 0, label: ml });
          lastMonth = ml;
        }
        const x = diffDays(rangeStart, cur) * config.dayWidth;
        subHeaders.push({ x, label: cur.getDate().toString() });
        cur.setDate(cur.getDate() + 1);
      }
    }

    return (
      <g>
        {headers.map((h, i) => (
          <text key={`h-${i}`} x={h.x + 4} y={16} fill="var(--text-secondary)" fontSize="11" fontWeight="600">
            {h.label}
          </text>
        ))}
        {subHeaders.map((s, i) => (
          <text key={`s-${i}`} x={s.x + 2} y={36} fill="var(--text-muted)" fontSize="10">
            {s.label}
          </text>
        ))}
        <line x1={0} y1={HEADER_HEIGHT} x2={chartWidth} y2={HEADER_HEIGHT} stroke="var(--border)" />
      </g>
    );
  };

  const renderGrid = () => {
    const lines: React.ReactElement[] = [];
    const cur = new Date(rangeStart);
    let i = 0;
    while (cur <= rangeEnd) {
      const x = i * config.dayWidth;
      const isWeekend = cur.getDay() === 0 || cur.getDay() === 6;
      if (isWeekend && zoom !== 'month') {
        lines.push(
          <rect key={`we-${i}`} x={x} y={HEADER_HEIGHT} width={config.dayWidth} height={sortedTasks.length * ROW_HEIGHT}
                fill="var(--gantt-grid)" opacity={0.5} />
        );
      }
      if (zoom === 'day' || (zoom === 'week' && cur.getDay() === 1)) {
        lines.push(
          <line key={`gl-${i}`} x1={x} y1={HEADER_HEIGHT} x2={x} y2={HEADER_HEIGHT + sortedTasks.length * ROW_HEIGHT}
                stroke="var(--border)" opacity={0.3} />
        );
      }
      cur.setDate(cur.getDate() + 1);
      i++;
    }
    return <g>{lines}</g>;
  };

  const renderToday = () => {
    if (todayOffset < 0 || todayOffset > chartWidth) return null;
    return (
      <g>
        <rect x={todayOffset} y={HEADER_HEIGHT} width={config.dayWidth}
              height={sortedTasks.length * ROW_HEIGHT} fill="var(--gantt-today)" />
        <line x1={todayOffset} y1={0} x2={todayOffset}
              y2={HEADER_HEIGHT + sortedTasks.length * ROW_HEIGHT} stroke="var(--accent)" strokeWidth={1.5} opacity={0.6} />
      </g>
    );
  };

  const renderDependencyLines = () => {
    return dependencies.map(dep => {
      const fromIdx = sortedTasks.findIndex(s => s.task.id === dep.fromId);
      const toIdx = sortedTasks.findIndex(s => s.task.id === dep.toId);
      if (fromIdx === -1 || toIdx === -1) return null;

      const fromTask = sortedTasks[fromIdx].task;
      const toTask = sortedTasks[toIdx].task;
      if (!fromTask.end || !toTask.start) return null;

      const fromX = getBarX(fromTask.end) + (diffDays(parseDate(fromTask.start ?? fromTask.end), parseDate(fromTask.end)) + 1) * config.dayWidth;
      const fromY = HEADER_HEIGHT + fromIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
      const toX = getBarX(toTask.start);
      const toY = HEADER_HEIGHT + toIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

      const midX = fromX + 10;
      return (
        <g key={dep.id}>
          <path
            d={`M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`}
            fill="none" stroke="var(--gantt-dep-line)" strokeWidth={1.5}
            markerEnd="url(#arrowhead)"
          />
        </g>
      );
    });
  };

  const renderBars = () => {
    return sortedTasks.map(({ task }, idx) => {
      if (!task.start || !task.end) return null;

      // While dragging, the bar follows the pointer from local state; the task
      // record itself is untouched until release.
      const isDragging = dragging?.taskId === task.id;
      const start = isDragging && dragDates ? dragDates.start : task.start;
      const end = isDragging && dragDates ? dragDates.end : task.end;

      const x = getBarX(start);
      const days = diffDays(parseDate(start), parseDate(end)) + 1;
      const width = Math.max(days * config.dayWidth, MIN_BAR_WIDTH);
      const y = HEADER_HEIGHT + idx * ROW_HEIGHT + BAR_Y_OFFSET;

      const isMilestone = task.estimateHours === 0 && task.start === task.end;

      if (isMilestone) {
        const cx = x + config.dayWidth / 2;
        const cy = y + BAR_HEIGHT / 2;
        return (
          <g key={task.id} style={{ cursor: 'pointer' }} onClick={() => onEditTask(task)}>
            <polygon
              points={`${cx},${cy - 8} ${cx + 8},${cy} ${cx},${cy + 8} ${cx - 8},${cy}`}
              fill="var(--gantt-milestone)"
            />
          </g>
        );
      }

      const progress = task.status === 'done' ? 1 : task.status === 'in-progress' ? 0.5 : 0;

      return (
        <g key={task.id} style={isDragging ? { filter: 'drop-shadow(0 2px 8px rgba(91,141,239,0.5))' } : undefined}>
          {isDragging && (
            <rect x={x - 2} y={y - 2} width={width + 4} height={BAR_HEIGHT + 4} rx={5}
              fill="none" stroke="var(--accent)" strokeWidth={2} opacity={0.7} />
          )}
          <rect
            x={x} y={y} width={width} height={BAR_HEIGHT} rx={3}
            fill="var(--gantt-bar)" opacity={isDragging ? 0.6 : 0.3}
            style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
            onPointerDown={e => handlePointerDown(e, task, 'move')}
            onPointerMove={handlePendingPointerMove}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onContextMenu={e => e.preventDefault()}
            onDoubleClick={() => onEditTask(task)}
          />
          {progress > 0 && (
            <rect x={x} y={y} width={width * progress} height={BAR_HEIGHT} rx={3} fill="var(--gantt-bar)" />
          )}
          <text x={x + 4} y={y + BAR_HEIGHT / 2 + 4} fill="#fff" fontSize="11" pointerEvents="none">
            {width > 60 ? task.title : ''}
          </text>
          <rect
            x={x + width - 6} y={y} width={6} height={BAR_HEIGHT}
            fill="transparent" style={{ cursor: 'ew-resize', touchAction: 'none' }}
            onPointerDown={e => handlePointerDown(e, task, 'resize-end')}
            onPointerMove={handlePendingPointerMove}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onContextMenu={e => e.preventDefault()}
          />
        </g>
      );
    });
  };

  const svgHeight = HEADER_HEIGHT + sortedTasks.length * ROW_HEIGHT + 20;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="view-header">
        <h1>Gantt Chart</h1>
        <div className="toolbar">
          <button className={`btn btn-sm ${zoom === 'day' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setZoom('day')}>Day</button>
          <button className={`btn btn-sm ${zoom === 'week' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setZoom('week')}>Week</button>
          <button className={`btn btn-sm ${zoom === 'month' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setZoom('month')}>Month</button>
        </div>
      </div>

      {sortedTasks.length === 0 ? (
        <div className="empty-state">
          <h3>No tasks with dates</h3>
          <p>Add start and end dates to your tasks to see them on the Gantt chart.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div className="chart-labels">
            <div style={{ height: HEADER_HEIGHT, borderBottom: '1px solid var(--border)', padding: '0 12px', display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Task</span>
            </div>
            {sortedTasks.map(({ task, depth }) => (
              <div
                key={task.id}
                style={{
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  padding: `0 12px 0 ${12 + depth * 16}px`,
                  borderBottom: '1px solid var(--border)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
                onClick={() => onEditTask(task)}
              >
                <span className="status-dot" style={{ background: task.status === 'done' ? 'var(--success)' : task.status === 'in-progress' ? 'var(--accent)' : 'var(--text-muted)', marginRight: '6px', flexShrink: 0 }} />
                {task.title}
              </div>
            ))}
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflow: 'auto' }}>
            <svg ref={svgRef} width={chartWidth} height={svgHeight} style={{ display: 'block', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}>
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="var(--gantt-dep-line)" />
                </marker>
              </defs>
              {renderGrid()}
              {renderToday()}
              {renderHeader()}
              {renderDependencyLines()}
              {renderBars()}
            </svg>
          </div>
        </div>
      )}
      {dragDates && (
        <div style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--accent)',
          borderRadius: '20px',
          padding: '8px 18px',
          fontSize: '14px',
          fontWeight: 600,
          color: '#fff',
          zIndex: 1100,
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(91,141,239,0.5)',
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
        }}>
          {dragDates.start} → {dragDates.end}
        </div>
      )}
    </div>
  );
}
