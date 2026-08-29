import { describe, expect, it } from 'vitest';
import { OPEN_POSITION, regionPool } from './regions';
import { midiToName } from '../lib/pitch';

describe('open position region', () => {
  it('spans low E to G# above the staff', () => {
    const pool = regionPool(OPEN_POSITION);
    expect(midiToName(pool[0])).toBe('E2');
    expect(midiToName(pool[pool.length - 1])).toBe('G#4');
  });

  it('deduplicates pitches reachable on more than one string', () => {
    const pool = regionPool(OPEN_POSITION);
    expect(new Set(pool).size).toBe(pool.length);
  });
});
