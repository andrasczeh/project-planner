import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  APP_VERSION,
  parseVersion,
  compareVersions,
  isNewerVersion,
  checkForUpdate,
  dismissVersion,
} from '../src/utils/version';

describe('parseVersion', () => {
  it('parses a plain semver', () => {
    expect(parseVersion('1.2.3')).toEqual({ core: [1, 2, 3], pre: '' });
  });

  it('accepts a v prefix', () => {
    expect(parseVersion('v1.0.0')).toEqual({ core: [1, 0, 0], pre: '' });
  });

  it('parses a prerelease suffix', () => {
    expect(parseVersion('v2.0.0-beta.1')).toEqual({ core: [2, 0, 0], pre: 'beta.1' });
  });

  it('rejects non-semver tags', () => {
    expect(parseVersion('release-2024')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.1.2', '1.1.3')).toBe(-1);
  });

  it('treats equal versions as equal regardless of v prefix', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });

  it('ranks a release above its prerelease', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
  });

  it('compares prereleases of the same core version', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1);
  });

  it('treats unparseable input as equal so no update is offered', () => {
    expect(compareVersions('garbage', '1.0.0')).toBe(0);
  });

  it('does not compare numbers as strings', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
  });
});

describe('isNewerVersion', () => {
  it('is true only for a strictly greater version', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false);
  });
});

describe('APP_VERSION', () => {
  it('is injected at build time as a semver string', () => {
    expect(parseVersion(APP_VERSION)).not.toBeNull();
  });
});

describe('checkForUpdate', () => {
  function mockRelease(body: unknown, ok = true) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok,
      json: async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('offers a release newer than the running version', async () => {
    mockRelease({ tag_name: 'v1.1.0', html_url: 'https://example.test/r' });
    const release = await checkForUpdate();
    expect(release).toEqual({ version: '1.1.0', url: 'https://example.test/r' });
  });

  it('returns null when the latest release is the running version', async () => {
    mockRelease({ tag_name: `v${APP_VERSION}` });
    expect(await checkForUpdate()).toBeNull();
  });

  it('returns null when the latest release is older', async () => {
    mockRelease({ tag_name: 'v0.1.0' });
    expect(await checkForUpdate()).toBeNull();
  });

  it('returns null once that version has been dismissed', async () => {
    mockRelease({ tag_name: 'v1.1.0' });
    expect(await checkForUpdate()).not.toBeNull();
    dismissVersion('1.1.0');
    expect(await checkForUpdate()).toBeNull();
  });

  it('still offers a newer release after dismissing an older one', async () => {
    dismissVersion('1.1.0');
    mockRelease({ tag_name: 'v1.2.0' });
    expect(await checkForUpdate()).not.toBeNull();
  });

  it('serves a cached result instead of refetching inside the TTL', async () => {
    const fetchMock = mockRelease({ tag_name: 'v1.1.0' });
    await checkForUpdate();
    await checkForUpdate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null without caching when the request fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkForUpdate()).toBeNull();
    expect(localStorage.getItem('version-check')).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    mockRelease({}, false);
    expect(await checkForUpdate()).toBeNull();
  });

  it('ignores a release whose tag is not semver', async () => {
    mockRelease({ tag_name: 'nightly' });
    expect(await checkForUpdate()).toBeNull();
  });
});
