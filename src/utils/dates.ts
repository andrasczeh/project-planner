export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function daysBetween(start: string, end: string): number {
  return diffDays(parseDate(start), parseDate(end));
}

export function isWorkDay(d: Date, workDays: number[]): boolean {
  return workDays.includes(d.getDay());
}

export function workingDaysBetween(start: string, end: string, workDays: number[] = [1, 2, 3, 4, 5]): number {
  const s = parseDate(start);
  const e = parseDate(end);
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    if (isWorkDay(cur, workDays)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function weekLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
