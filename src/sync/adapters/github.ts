import type {
  ProviderAdapter,
  SyncContext,
  RemoteRecord,
  RemotePatch,
  RemoteOp,
  PushResult,
} from '../types';
import type { Task } from '../../types';

const GITHUB_API = 'https://api.github.com';

async function ghFetch(ctx: SyncContext, path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${ctx.config.token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init?.headers as Record<string, string> ?? {}),
  };
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers,
    signal: ctx.signal,
  });
}

interface GitHubIssue {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: { name: string }[];
  assignees: { login: string }[];
  milestone: { number: number; title: string } | null;
  html_url: string;
  updated_at: string;
}

export const githubAdapter: ProviderAdapter = {
  id: 'github',
  name: 'GitHub',
  capabilities: {
    dates: 'custom-field',
    dependencies: true,
    subtasks: true,
    customFields: true,
    milestones: true,
  },

  async pull(ctx: SyncContext, since?: string): Promise<RemoteRecord[]> {
    const { owner, repo } = parseRepo(ctx.config.repo ?? '');
    const records: RemoteRecord[] = [];

    let page = 1;
    let hasMore = true;
    while (hasMore) {
      let url = `/repos/${owner}/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100&page=${page}`;
      if (since) url += `&since=${since}`;

      const resp = await ghFetch(ctx, url);
      if (!resp.ok) throw new Error(`GitHub API error: ${resp.status} ${await resp.text()}`);

      const issues: GitHubIssue[] = await resp.json();
      if (issues.length === 0) {
        hasMore = false;
        break;
      }

      for (const issue of issues) {
        if (issue.html_url.includes('/pull/')) continue;
        records.push({
          kind: 'issue',
          remoteId: issue.node_id,
          remoteNumber: issue.number,
          url: issue.html_url,
          data: issue as unknown as Record<string, unknown>,
        });
      }

      if (issues.length < 100) hasMore = false;
      page++;
    }

    return records;
  },

  toCanonical(r: RemoteRecord): Partial<Task> {
    const issue = r.data as unknown as GitHubIssue;
    return {
      title: issue.title,
      body: issue.body ?? '',
      status: issue.state === 'open' ? 'todo' : 'done',
      labels: issue.labels.map(l => l.name),
      assigneeIds: [],
    };
  },

  fromCanonical(t: Task, prev?: RemoteRecord): RemotePatch {
    return {
      kind: 'issue',
      remoteId: prev?.remoteId,
      data: {
        title: t.title,
        body: t.body,
        state: t.status === 'done' ? 'closed' : 'open',
        labels: t.labels,
      },
    };
  },

  async push(ctx: SyncContext, ops: RemoteOp[]): Promise<PushResult[]> {
    const { owner, repo } = parseRepo(ctx.config.repo ?? '');
    const results: PushResult[] = [];

    for (const op of ops) {
      try {
        if (op.type === 'create') {
          const resp = await ghFetch(ctx, `/repos/${owner}/${repo}/issues`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op.data),
          });
          if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
          const created: GitHubIssue = await resp.json();
          results.push({
            localId: op.localId,
            remoteId: created.node_id,
            remoteNumber: created.number,
            url: created.html_url,
            success: true,
          });
        } else if (op.type === 'update' || op.type === 'close' || op.type === 'reopen') {
          const number = op.data.number as number;
          const body: Record<string, unknown> = { ...op.data };
          delete body.number;
          if (op.type === 'close') body.state = 'closed';
          if (op.type === 'reopen') body.state = 'open';

          const resp = await ghFetch(ctx, `/repos/${owner}/${repo}/issues/${number}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
          const updated: GitHubIssue = await resp.json();
          results.push({
            localId: op.localId,
            remoteId: updated.node_id,
            remoteNumber: updated.number,
            url: updated.html_url,
            success: true,
          });
        }
      } catch (err) {
        results.push({
          localId: op.localId,
          remoteId: op.remoteId ?? '',
          success: false,
          error: (err as Error).message,
        });
      }
    }

    return results;
  },
};

function parseRepo(repo: string): { owner: string; repo: string } {
  const parts = repo.split('/');
  if (parts.length !== 2) throw new Error(`Invalid repo format: "${repo}". Use "owner/repo".`);
  return { owner: parts[0], repo: parts[1] };
}
