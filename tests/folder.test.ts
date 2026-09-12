import { describe, it, expect } from 'vitest';
import { serializeTask, parseTaskFile, taskFilename } from '../src/sync/adapters/folder';
import type { Task, Person } from '../src/types';

const mockTask: Task = {
  id: '01J9Z3ABCDEF',
  projectId: 'proj1',
  title: 'Login page',
  body: 'Markdown body here.',
  status: 'in-progress',
  labels: ['frontend'],
  assigneeIds: ['person1'],
  start: '2026-10-01',
  end: '2026-10-08',
  estimateHours: 16,
  priority: 2,
  custom: {},
  updatedAt: 0,
};

const mockPeople: Person[] = [
  {
    id: 'person1',
    name: 'alice',
    hoursPerDay: 8,
    workDays: [1, 2, 3, 4, 5],
    providerLogins: { github: 'alice' },
    updatedAt: 0,
  },
];

describe('serializeTask', () => {
  it('produces valid frontmatter markdown', () => {
    const result = serializeTask(mockTask, mockPeople, []);
    expect(result).toContain('---');
    expect(result).toContain('title: Login page');
    expect(result).toContain('status: in-progress');
    expect(result).toContain('start: 2026-10-01');
    expect(result).toContain('end: 2026-10-08');
    expect(result).toContain('Markdown body here.');
  });

  it('includes assignee names', () => {
    const result = serializeTask(mockTask, mockPeople, []);
    expect(result).toContain('assignees: [alice]');
  });

  it('sorts keys deterministically', () => {
    const result = serializeTask(mockTask, mockPeople, []);
    const lines = result.split('\n');
    const fmLines = lines.slice(1, lines.indexOf('---', 1));
    const keys = fmLines.map(l => l.split(':')[0]);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});

describe('parseTaskFile', () => {
  it('round-trips serialized task', () => {
    const serialized = serializeTask(mockTask, mockPeople, []);
    const parsed = parseTaskFile(serialized);
    expect(parsed.frontmatter.title).toBe('Login page');
    expect(parsed.frontmatter.status).toBe('in-progress');
    expect(parsed.frontmatter.start).toBe('2026-10-01');
    expect(parsed.frontmatter.estimate).toBe(16);
    expect(parsed.body).toBe('Markdown body here.');
  });

  it('handles files without frontmatter', () => {
    const parsed = parseTaskFile('Just plain text');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe('Just plain text');
  });

  it('parses array values', () => {
    const content = '---\nlabels: [a, b, c]\n---\n';
    const parsed = parseTaskFile(content);
    expect(parsed.frontmatter.labels).toEqual(['a', 'b', 'c']);
  });

  it('parses boolean values', () => {
    const content = '---\nactive: true\narchived: false\n---\n';
    const parsed = parseTaskFile(content);
    expect(parsed.frontmatter.active).toBe(true);
    expect(parsed.frontmatter.archived).toBe(false);
  });
});

describe('taskFilename', () => {
  it('generates a slug-based filename', () => {
    const fn = taskFilename(mockTask);
    expect(fn).toMatch(/^T-.*-login-page\.md$/);
    expect(fn).toContain('BCDEF');
  });

  it('handles special characters', () => {
    const task = { ...mockTask, title: 'Fix bug #123 (urgent!)' };
    const fn = taskFilename(task);
    expect(fn).toMatch(/\.md$/);
    expect(fn).not.toMatch(/[#!()]/);
  });
});
