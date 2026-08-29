import { describe, expect, it } from 'vitest';
import { LEVELS, MAX_LEVEL, clampLevel, levelConfig, levelSummary } from './levels';

describe('level ramp', () => {
  it('clamps to range and quantises to tenths', () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(99)).toBe(MAX_LEVEL);
    expect(clampLevel(3.44)).toBe(3.4);
    expect(clampLevel(3.46)).toBe(3.5);
  });

  it('never decreases the interval allowance', () => {
    const intervals = LEVELS.map((l) => l.maxLocalInterval);
    expect(intervals).toEqual([...intervals].sort((a, b) => a - b));
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

  it('grows the exercise length gently', () => {
    const bars = LEVELS.map((l) => l.targetBars);
    expect(bars).toEqual([...bars].sort((a, b) => a - b));
    expect(bars[0]).toBe(2);
    expect(bars[MAX_LEVEL - 1]).toBe(4);
  });
});

describe('adoption within a level', () => {
  it('leaves a whole level playing like the one below it', () => {
    // 3.0 introduces nothing new yet — quarters, rests and arpeggios all arrive
    // across level 3, not at its start.
    const at3 = levelConfig(3);
    expect(at3.restChance).toBe(0);
    expect(at3.categoryChance.arpeggio).toBe(0);
    expect(at3.noteValues.some((v) => v.name === 'quarter')).toBe(false);
  });

  it('phases new ideas in across the level that introduces them', () => {
    const chances = [3.0, 3.3, 3.6, 3.9, 4.0].map((l) => levelConfig(l).categoryChance.arpeggio);
    expect(chances).toEqual([...chances].sort((a, b) => a - b));
    expect(chances[0]).toBe(0);
    expect(chances[chances.length - 1]).toBe(1);
    // By 3.9 the new idea is in nearly every exercise.
    expect(levelConfig(3.9).categoryChance.arpeggio).toBeCloseTo(0.9, 5);
  });

  it.each([
    ['rests', 3, (l: number) => levelConfig(l).restChance],
    ['triplets', 4, (l: number) => levelConfig(l).tupletChance],
    ['sequences', 4, (l: number) => levelConfig(l).sequenceChance],
    ['accidentals', 6, (l: number) => levelConfig(l).accidentalChance],
  ])('introduces %s gradually from level %i', (_name, from, read) => {
    expect(read(from)).toBe(0);
    expect(read(from + 0.5)).toBeGreaterThan(0);
    expect(read(from + 0.5)).toBeLessThan(read(from + 1));
  });

  it('fades a new note value in rather than switching it on', () => {
    const weightAt = (level: number) =>
      levelConfig(level).noteValues.find((v) => v.name === 'quarter')?.weight ?? 0;
    expect(weightAt(3)).toBe(0);
    expect(weightAt(3.5)).toBeGreaterThan(0);
    expect(weightAt(3.5)).toBeLessThan(weightAt(4));
  });

  it('admits a new key signature occasionally before always', () => {
    expect(levelConfig(3).maxKeyAccidentals).toBe(0);
    // The fraction is the chance of one more accidental than the whole part.
    const mid = levelConfig(5).maxKeyAccidentals;
    expect(mid).toBeGreaterThan(0);
    expect(Math.floor(mid)).toBeLessThan(Math.floor(levelConfig(MAX_LEVEL).maxKeyAccidentals));
  });

  it('holds quintuplets back until well after triplets', () => {
    const ratiosAt = (level: number) => levelConfig(level).tupletRatios;
    expect(ratiosAt(5).map((r) => r.num)).toEqual([3]);
    expect(ratiosAt(MAX_LEVEL).map((r) => r.num)).toEqual([3, 5]);
    // And they stay rare while arriving.
    const nine = ratiosAt(9.5).find((r) => r.num === 5)!;
    expect(nine.weight).toBeLessThan(1);
  });

  it('thins the click out rather than switching it off', () => {
    expect(levelConfig(5).clickThroughChance).toBe(1);
    expect(levelConfig(6).clickThroughChance).toBeCloseTo(0.5, 5);
    expect(levelConfig(7).clickThroughChance).toBe(0);
  });

  it('summarises a level, showing how far new ideas have come in', () => {
    expect(levelSummary(levelConfig(1)).join(' ')).toContain('C major only');
    const mid = levelSummary(levelConfig(3.5)).join(' ');
    expect(mid).toMatch(/rests \d+%/);
    expect(mid).toMatch(/arpeggios \d+%/);
  });
});
