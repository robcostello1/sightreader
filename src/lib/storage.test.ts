// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSetting, saveSetting } from './storage';

const asNumber = (v: unknown) => (typeof v === 'number' ? v : null);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('settings storage', () => {
  it('round-trips a value', () => {
    saveSetting('level', 7);
    expect(loadSetting('level', asNumber, 1)).toBe(7);
  });

  it('falls back when nothing is stored', () => {
    expect(loadSetting('level', asNumber, 3)).toBe(3);
  });

  it('falls back when the stored value no longer validates', () => {
    // Data outlives the code that wrote it — a level from before the range
    // changed, or a position id since renamed.
    saveSetting('level', 'eleven');
    expect(loadSetting('level', asNumber, 1)).toBe(1);
  });

  it('falls back on corrupt json rather than throwing', () => {
    localStorage.setItem('sightreader.level', '{not json');
    expect(loadSetting('level', asNumber, 2)).toBe(2);
  });

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => saveSetting('level', 4)).not.toThrow();
    expect(loadSetting('level', asNumber, 1)).toBe(1);
  });

  it('namespaces its keys', () => {
    saveSetting('level', 5);
    expect(localStorage.getItem('sightreader.level')).toBe('5');
  });
});
