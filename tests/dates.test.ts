import { describe, it, expect } from 'vitest';
import { parseDate, formatDate, addDays, diffDays, daysBetween, workingDaysBetween } from '../src/utils/dates';

describe('date utilities', () => {
  it('parseDate and formatDate round-trip', () => {
    expect(formatDate(parseDate('2026-03-15'))).toBe('2026-03-15');
    expect(formatDate(parseDate('2026-12-31'))).toBe('2026-12-31');
    expect(formatDate(parseDate('2026-01-01'))).toBe('2026-01-01');
  });

  it('addDays works correctly', () => {
    expect(formatDate(addDays(parseDate('2026-01-30'), 3))).toBe('2026-02-02');
    expect(formatDate(addDays(parseDate('2026-03-01'), -1))).toBe('2026-02-28');
  });

  it('diffDays calculates day difference', () => {
    expect(diffDays(parseDate('2026-01-01'), parseDate('2026-01-10'))).toBe(9);
    expect(diffDays(parseDate('2026-01-10'), parseDate('2026-01-01'))).toBe(-9);
  });

  it('daysBetween uses ISO strings', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
  });

  it('workingDaysBetween counts only work days', () => {
    // 2026-01-05 is a Monday, 2026-01-09 is a Friday
    const count = workingDaysBetween('2026-01-05', '2026-01-09');
    expect(count).toBe(5);

    // Including a weekend
    const countWithWeekend = workingDaysBetween('2026-01-05', '2026-01-12');
    expect(countWithWeekend).toBe(6);
  });

  it('workingDaysBetween respects custom work days', () => {
    // Only Mon-Thu
    const count = workingDaysBetween('2026-01-05', '2026-01-09', [1, 2, 3, 4]);
    expect(count).toBe(4);
  });
});
