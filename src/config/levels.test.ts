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
  it('brings a level’s ideas in at once when it is reached', () => {
    // Reaching 3.0 is a real step: quarters, rests and arpeggios start showing
    // up straight away, in a minority of exercises rather than none.
    const at3 = levelConfig(3);
    expect(at3.restChance).toBeGreaterThan(0);
    expect(at3.categoryChance.arpeggio).toBeCloseTo(0.2, 5);
    expect(at3.noteValues.some((v) => v.name === 'quarter')).toBe(true);
    // But nothing before the level itself.
    expect(levelConfig(2.9).categoryChance.arpeggio).toBe(0);
  });

  it('climbs from that first share to every exercise by the next level', () => {
    const chances = [3.0, 3.3, 3.6, 3.9, 4.0].map((l) => levelConfig(l).categoryChance.arpeggio);
    expect(chances).toEqual([...chances].sort((a, b) => a - b));
    expect(chances[0]).toBeCloseTo(0.2, 5);
    expect(chances[chances.length - 1]).toBe(1);
    expect(levelConfig(3.5).categoryChance.arpeggio).toBeCloseTo(0.6, 5);
  });

  it.each([
    ['rests', 3, (l: number) => levelConfig(l).restChance],
    ['triplets', 4, (l: number) => levelConfig(l).tupletChance],
    ['sequences', 4, (l: number) => levelConfig(l).sequenceChance],
    ['accidentals', 6, (l: number) => levelConfig(l).accidentalChance],
  ])('introduces %s from level %i and grows across it', (_name, from, read) => {
    expect(read(from - 0.1)).toBe(0);
    expect(read(from)).toBeGreaterThan(0);
    expect(read(from)).toBeLessThan(read(from + 0.5));
    expect(read(from + 0.5)).toBeLessThan(read(from + 1));
  });

  it('admits a new note value in a minority of exercises before all of them', () => {
    const chanceAt = (level: number) =>
      levelConfig(level).noteValues.find((v) => v.name === 'quarter')?.chance ?? 0;
    expect(chanceAt(2.9)).toBe(0);
    expect(chanceAt(3)).toBeCloseTo(0.2, 5);
    expect(chanceAt(3.5)).toBeCloseTo(0.6, 5);
    expect(chanceAt(4)).toBe(1);
  });

  it('admits a new key signature occasionally before always', () => {
    // Nothing but C until level 3, then a minority share of one accidental —
    // the fraction is the chance of one more than the whole part.
    expect(levelConfig(2.9).maxKeyAccidentals).toBe(0);
    expect(levelConfig(3).maxKeyAccidentals).toBeCloseTo(0.2, 5);
    const mid = levelConfig(5).maxKeyAccidentals;
    expect(mid).toBeGreaterThan(levelConfig(3).maxKeyAccidentals);
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

  it('briefs as labelled facts rather than dense shorthand', () => {
    const facts = Object.fromEntries(levelBrief(1).facts.map((f) => [f.label, f.value]));
    expect(facts.Keys).toBe('C');
    expect(facts.Motion).toBe('steps only');
    expect(facts.Time).toBe('4/4');
    // Named as a range, so it does not read as "down to half notes" from what?
    expect(facts.Notes).toMatch(/half/);
    // Nothing is arriving at level 1 — it is the baseline.
    expect(levelBrief(1).introducing).toEqual([]);
  });

  it('names the keys you might meet rather than counting accidentals', () => {
    // The whole part is always in the pool and the fraction is the chance of one
    // more, so the list rounds up to what can actually turn up.
    const keysAt = (level: number) =>
      levelBrief(level).facts.find((f) => f.label === 'Keys')!.value;
    expect(keysAt(1)).toBe('C');
    expect(keysAt(3.5)).toContain('G');
  });

  it('treats a level boundary as a step, not a fresh start from nothing', () => {
    // Arriving at 3.0 you should be able to see what changed.
    const introducing = levelBrief(3).introducing.map((i) => i.label);
    expect(introducing).toContain('arpeggios');
    expect(introducing).toContain('rests');
  });

  it('lists only what is currently arriving, not what has settled', () => {
    // At 3.5 quarters are half in; by 5 they are simply part of the reading.
    const arriving = levelBrief(3.5).introducing.map((i) => i.label);
    expect(arriving).toContain('quarter notes');
    expect(levelBrief(5).introducing.map((i) => i.label)).not.toContain('quarter notes');
    // Settled, so it belongs to the note range rather than the arriving list.
    const notes = levelBrief(5).facts.find((f) => f.label === 'Notes')!.value;
    expect(notes).toContain('quarter');
  });

  it('reports how far each arriving concept has come', () => {
    const item = levelBrief(3.5).introducing.find((i) => i.label === 'arpeggios');
    expect(item?.progress).toBeCloseTo(0.6, 5);
  });

  it('names what a whole level introduces, for the milestone panel', () => {
    // The milestone announces what is arriving; the config only says how often.
    expect(levelConfig(4).tupletChance).toBeGreaterThan(0);
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
