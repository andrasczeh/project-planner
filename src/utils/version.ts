import { version } from '../../package.json';

export const APP_VERSION = version;

const RELEASES_URL = 'https://api.github.com/repos/andrasczeh/project-planner/releases/latest';
const CHECK_TTL_MS = 60 * 60 * 1000;
const CACHE_KEY = 'version-check';
const DISMISSED_KEY = 'version-dismissed';

export interface ReleaseInfo {
  version: string;
  url: string;
}

interface ParsedVersion {
  core: [number, number, number];
  pre: string;
}

export function parseVersion(raw: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(raw.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? '' };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

interface CacheEntry {
  at: number;
  release: ReleaseInfo | null;
}

// localStorage throws rather than no-ops in some privacy modes, so every access is guarded.
function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    return null;
  }
}

function writeCache(release: ReleaseInfo | null): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }));
  } catch { /* storage unavailable */ }
}

function dismissedVersion(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) ?? '';
  } catch {
    return '';
  }
}

export function dismissVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch { /* storage unavailable */ }
}

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
  // 404 until the first release is published, 403 when the anonymous rate limit is hit.
  if (!res.ok) return null;
  const data = await res.json();
  const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
  if (!parseVersion(tag)) return null;
  return {
    version: tag.trim().replace(/^v/, ''),
    url: typeof data.html_url === 'string' ? data.html_url : '',
  };
}

export async function checkForUpdate(): Promise<ReleaseInfo | null> {
  const cached = readCache();
  let release: ReleaseInfo | null;

  if (cached && Date.now() - cached.at < CHECK_TTL_MS) {
    release = cached.release;
  } else {
    try {
      release = await fetchLatestRelease();
    } catch {
      return null;
    }
    writeCache(release);
  }

  if (!release || release.version === dismissedVersion()) return null;
  return isNewerVersion(release.version, APP_VERSION) ? release : null;
}

export async function applyUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    // Asset caches only. Project data lives in IndexedDB and is never touched here.
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (err) {
    console.error('Failed to clear caches before update', err);
  }
  location.reload();
}
