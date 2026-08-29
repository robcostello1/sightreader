import { describe, expect, it } from 'vitest';
import { LEVELS, MAX_LEVEL, clampLevel, levelConfig, levelSummary } from './levels';

describe('level ramp', () => {
  it('clamps out-of-range levels', () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(99)).toBe(MAX_LEVEL);
    expect(clampLevel(3.4)).toBe(3);
  });

  it('never decreases the interval allowance', () => {
    const intervals = LEVELS.map((l) => l.maxLocalInterval);
    expect(intervals).toEqual([...intervals].sort((a, b) => a - b));
    expect(intervals[0]).toBeLessThan(intervals[MAX_LEVEL - 1]);
  });

  it.each([
    ['restChance', (l: (typeof LEVELS)[number]) => l.restChance],
    ['tupletChance', (l: (typeof LEVELS)[number]) => l.tupletChance],
    ['sequenceChance', (l: (typeof LEVELS)[number]) => l.sequenceChance],
    ['accidentalChance', (l: (typeof LEVELS)[number]) => l.accidentalChance],
    ['maxKeyAccidentals', (l: (typeof LEVELS)[number]) => l.maxKeyAccidentals],
  ])('never decreases %s', (_name, read) => {
    const values = LEVELS.map(read);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('introduces each device at its own level rather than all at once', () => {
    // The point of interpolating: no single level is a cliff.
    expect(levelConfig(1).restChance).toBe(0);
    expect(levelConfig(3).restChance).toBeGreaterThan(0);
    expect(levelConfig(3).tupletChance).toBe(0);
    expect(levelConfig(4).tupletChance).toBeGreaterThan(0);
    expect(levelConfig(5).accidentalChance).toBe(0);
    expect(levelConfig(6).accidentalChance).toBeGreaterThan(0);
  });

  it('keeps early exercises short so feedback comes quickly', () => {
    expect(levelConfig(1).targetBars).toBe(2);
    expect(levelConfig(5).targetBars).toBe(4);
  });

  it('makes shorter notes both available and more likely as levels rise', () => {
    const shortest = (level: number) => {
      const values = levelConfig(level).noteValues;
      return Math.min(...values.map((v) => v.value));
    };
    expect(shortest(1)).toBeGreaterThan(shortest(5));
    expect(shortest(5)).toBeGreaterThan(shortest(10));

    // And the long values give ground rather than staying dominant.
    const wholeWeight = (level: number) =>
      levelConfig(level).noteValues.find((v) => v.name === 'whole')?.weight ?? 0;
    expect(wholeWeight(1)).toBeGreaterThan(wholeWeight(10));
  });

  it('starts in C major and widens the key pool gradually', () => {
    expect(levelConfig(1).maxKeyAccidentals).toBe(0);
    expect(levelConfig(2).maxKeyAccidentals).toBe(0);
    expect(levelConfig(MAX_LEVEL).maxKeyAccidentals).toBeGreaterThanOrEqual(4);
  });

  it('adds triplets before other tuplets', () => {
    expect(levelConfig(4).tupletRatios).toEqual([{ num: 3, inSpaceOf: 2 }]);
    expect(levelConfig(MAX_LEVEL).tupletRatios.length).toBeGreaterThan(1);
  });

  it('widens the idiom vocabulary as levels rise', () => {
    expect(levelConfig(1).categories).not.toContain('arpeggio');
    expect(levelConfig(MAX_LEVEL).categories).toContain('arpeggio');
  });

  it('grows the exercise length gently', () => {
    // What changes with level is how many notes fit in a bar, not how long the
    // exercise runs — so bars grow slowly while note count grows fast.
    const bars = LEVELS.map((l) => l.targetBars);
    expect(bars).toEqual([...bars].sort((a, b) => a - b));
    expect(bars[0]).toBe(2);
    expect(bars[MAX_LEVEL - 1]).toBe(4);
  });

  it('holds the cadence back until note values are short enough to fit one', () => {
    expect(levelConfig(1).endOnCadence).toBe(false);
    expect(levelConfig(MAX_LEVEL).endOnCadence).toBe(true);
  });

  it('drops the click once the pulse should be internalised', () => {
    expect(levelConfig(1).clickThroughExercise).toBe(true);
    expect(levelConfig(MAX_LEVEL).clickThroughExercise).toBe(false);
  });

  it('summarises what each level involves', () => {
    expect(levelSummary(levelConfig(1)).join(' ')).toContain('C major only');
    const top = levelSummary(levelConfig(MAX_LEVEL)).join(' ');
    expect(top).toContain('rests');
    expect(top).toContain('accidentals');
  });
});
