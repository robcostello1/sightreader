// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPermissionDenial,
  loadMicPermission,
  queryMicPermission,
  saveMicPermission,
} from './permission';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('stored permission', () => {
  it('starts out not knowing', () => {
    expect(loadMicPermission()).toBe('unknown');
  });

  it('remembers a grant across sessions', () => {
    saveMicPermission('granted');
    expect(loadMicPermission()).toBe('granted');
  });

  it('remembers a refusal too, so a returning player is not asked again', () => {
    saveMicPermission('denied');
    expect(loadMicPermission()).toBe('denied');
  });

  it('treats anything unrecognised as not knowing', () => {
    localStorage.setItem('sightreader.micPermission', JSON.stringify('yes please'));
    expect(loadMicPermission()).toBe('unknown');
  });
});

describe('queryMicPermission', () => {
  const withPermissions = (query: () => Promise<{ state: string }>) =>
    vi.stubGlobal('navigator', { permissions: { query } });

  it('reports what the browser says', async () => {
    withPermissions(async () => ({ state: 'granted' }));
    await expect(queryMicPermission()).resolves.toBe('granted');
  });

  it('reads a pending prompt as not knowing, since the browser will still ask', async () => {
    withPermissions(async () => ({ state: 'prompt' }));
    await expect(queryMicPermission()).resolves.toBe('unknown');
  });

  it('returns null when the browser cannot answer', async () => {
    // Safari has no microphone descriptor and throws rather than rejecting;
    // null leaves the stored value standing rather than wiping it.
    withPermissions(() => {
      throw new TypeError('unsupported');
    });
    await expect(queryMicPermission()).resolves.toBeNull();

    vi.stubGlobal('navigator', {});
    await expect(queryMicPermission()).resolves.toBeNull();
  });
});

describe('isPermissionDenial', () => {
  it('recognises a refusal', () => {
    expect(isPermissionDenial(new DOMException('no', 'NotAllowedError'))).toBe(true);
  });

  it('does not mistake a missing device for one', () => {
    // Worth retrying: plugging an interface in should not need a reset.
    expect(isPermissionDenial(new DOMException('none', 'NotFoundError'))).toBe(false);
    expect(isPermissionDenial(new Error('boom'))).toBe(false);
  });
});
