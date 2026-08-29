import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRESSION, advanceLevel, progressionState } from './progression';
import { MAX_LEVEL } from './levels';

const fill = (n: number, value: number) => Array.from({ length: n }, () => value);

describe('progression', () => {
  it('needs a full window before deciding', () => {
    expect(advanceLevel(3, fill(4, 1))).toBe(3);
    expect(advanceLevel(3, fill(5, 1))).toBe(3.1);
  });

  it('advances a tenth of a level at a time', () => {
    // Ten advances to cross a level, so its new ideas arrive gradually.
    expect(advanceLevel(3, fill(5, 0.9))).toBe(3.1);
    expect(advanceLevel(3.9, fill(5, 0.9))).toBe(4);
  });

  it('does not demand a clean run', () => {
    expect(advanceLevel(3, fill(5, 0.8))).toBe(3.1);
    expect(advanceLevel(3, fill(5, 0.79))).toBe(3);
  });

  it('averages the window rather than requiring every exercise to clear it', () => {
    // 60, 90, 90, 90, 90 averages 84% — one bad reading should not stall you.
    expect(advanceLevel(3, [0.6, 0.9, 0.9, 0.9, 0.9])).toBe(3.1);
  });

  it('only considers the most recent exercises', () => {
    const early = fill(10, 0);
    expect(advanceLevel(3, [...early, ...fill(5, 1)])).toBe(3.1);
  });

  it('stops at the ceiling', () => {
    expect(advanceLevel(MAX_LEVEL, fill(5, 1))).toBe(MAX_LEVEL);
    expect(progressionState(MAX_LEVEL, fill(5, 1)).atCeiling).toBe(true);
    expect(progressionState(MAX_LEVEL, fill(5, 1)).ready).toBe(false);
  });

  it('reports progress towards the next decision', () => {
    expect(progressionState(3, [])).toMatchObject({ accuracy: null, completed: 0, needed: 5 });
    expect(progressionState(3, [0.5, 1])).toMatchObject({ accuracy: 0.75, completed: 2 });
  });

  it('uses the agreed thresholds by default', () => {
    expect(DEFAULT_PROGRESSION).toEqual({ windowSize: 5, threshold: 0.8, step: 0.1 });
  });
});
