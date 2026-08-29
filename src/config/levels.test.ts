import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  MAX_LEVEL,
  clampLevel,
  conceptsIntroducedAt,
  levelBrief,
  levelConfig,
  levelSummary,
  shortestNoteValue,
} from './levels';

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

describe('shortestNoteValue', () => {
  it('is the shortest plain value when no tuplets are in play', () => {
    expect(shortestNoteValue(levelConfig(1))).toBe(0.5); // half notes
  });

  it('accounts for tuplets, which are shorter than they look', () => {
    // A triplet quaver is two thirds of a quaver, so the tempo ceiling is lower
    // than the plain note values suggest.
    const config = levelConfig(MAX_LEVEL);
    const plain = Math.min(...config.noteValues.map((v) => v.value));
    expect(shortestNoteValue(config)).toBeLessThan(plain);
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

  it('briefs in plain language rather than listing parameters', () => {
    const brief = levelBrief(1);
    expect(brief.reading).toContain('C major');
    expect(brief.reading.join(' ')).toMatch(/half notes/);
    // Nothing is arriving at level 1 — it is the baseline.
    expect(brief.introducing).toEqual([]);
  });

  it('lists only what is currently arriving, not what has settled', () => {
    // At 3.5 quarters are half in; by 5 they are simply part of the reading.
    const arriving = levelBrief(3.5).introducing.map((i) => i.label);
    expect(arriving).toContain('quarter notes');
    expect(levelBrief(5).introducing.map((i) => i.label)).not.toContain('quarter notes');
    expect(levelBrief(5).reading.join(' ')).toContain('quarter notes');
  });

  it('reports how far each arriving concept has come', () => {
    const item = levelBrief(3.5).introducing.find((i) => i.label === 'arpeggios');
    expect(item?.progress).toBeCloseTo(0.5, 5);
  });

  it('names what a whole level introduces, before any of it has arrived', () => {
    // At exactly 4.0 these all have adoption 0, so the live config cannot
    // describe them — the milestone panel needs them named.
    expect(levelConfig(4).tupletChance).toBe(0);
    expect(conceptsIntroducedAt(4)).toContain('triplets');
    expect(conceptsIntroducedAt(3)).toContain('quarter notes');
    expect(conceptsIntroducedAt(6)).toContain('accidentals');
  });

  it('falls back to a description when a level only widens what exists', () => {
    expect(conceptsIntroducedAt(2)).toEqual(['longer phrases and wider leaps']);
  });

  it('summarises a level, showing how far new ideas have come in', () => {
    expect(levelSummary(levelConfig(1)).join(' ')).toContain('C major only');
    const mid = levelSummary(levelConfig(3.5)).join(' ');
    expect(mid).toMatch(/rests \d+%/);
    expect(mid).toMatch(/arpeggios \d+%/);
  });
});
