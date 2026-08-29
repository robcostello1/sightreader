import { describe, expect, it } from 'vitest';
import { PADDING_IDIOM_ID, generateExercise } from './generate';
import { startPitchWeight, validPlacements } from './placement';
import { mulberry32 } from './rng';
import { OPEN_POSITION, regionPool } from '../config/regions';
import { TIERS } from '../config/tiers';
import { idiomById, isDiatonic, maxLocalInterval } from '../idioms';
import { NOTE_VALUES } from '../lib/types';
import { isNotatable } from '../lib/duration';

const POOL_LIST = regionPool(OPEN_POSITION);
const POOL = new Set(POOL_LIST);
const LOW = POOL_LIST[0];
const HIGH = POOL_LIST[POOL_LIST.length - 1];
const C4 = 60;

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe('startPitchWeight', () => {
  it('favours the extremes of the region over its middle', () => {
    const middle = startPitchWeight((LOW + HIGH) / 2, LOW, HIGH, 3);
    expect(startPitchWeight(LOW, LOW, HIGH, 3)).toBeGreaterThan(middle);
    expect(startPitchWeight(HIGH, LOW, HIGH, 3)).toBeGreaterThan(middle);
  });

  it('flattens to uniform when the bias is zero', () => {
    expect(startPitchWeight(LOW, LOW, HIGH, 0)).toBe(startPitchWeight((LOW + HIGH) / 2, LOW, HIGH, 0));
  });
});

describe('validPlacements', () => {
  const constraints = { keyCenter: C4, pool: POOL, maxInterval: 12 };

  it('only returns placements whose every pitch is in the pool', () => {
    const placements = validPlacements(idiomById('triad-up')!, NOTE_VALUES.quarter, constraints);
    expect(placements.length).toBeGreaterThan(0);
    for (const placement of placements) {
      expect(maxLocalInterval(placement)).toBeLessThanOrEqual(12);
    }
  });

  it('applies the local interval constraint independently of the pool', () => {
    const wide = validPlacements(idiomById('leap-fifth-step-back')!, NOTE_VALUES.quarter, constraints);
    const narrow = validPlacements(idiomById('leap-fifth-step-back')!, NOTE_VALUES.quarter, {
      ...constraints,
      maxInterval: 4, // the Simple tier's limit — a fifth cannot fit
    });
    expect(wide.length).toBeGreaterThan(0);
    expect(narrow).toHaveLength(0);
  });

  it('rejects an idiom too wide for the region entirely', () => {
    // I-V outline spans over an octave; a 3-semitone leap limit cannot hold it.
    expect(
      validPlacements(idiomById('i-v-outline')!, NOTE_VALUES.quarter, { ...constraints, maxInterval: 3 }),
    ).toHaveLength(0);
  });
});

describe('generateExercise', () => {
  it('is reproducible from a seed', () => {
    const a = generateExercise({ tier: TIERS.medium, seed: 42 });
    const b = generateExercise({ tier: TIERS.medium, seed: 42 });
    expect(a).toEqual(b);
    expect(generateExercise({ tier: TIERS.medium, seed: 43 })).not.toEqual(a);
  });

  describe.each([
    ['simple', TIERS.simple],
    ['medium', TIERS.medium],
  ])('%s tier', (_name, tier) => {
    const exercises = SEEDS.map((seed) => generateExercise({ tier, seed }));

    it('never produces an empty exercise', () => {
      expect(exercises.every((e) => e.notes.length > 0)).toBe(true);
    });

    it('keeps every pitch inside the region pool', () => {
      for (const exercise of exercises) {
        for (const note of exercise.notes) {
          if (note.midi !== null) expect(POOL.has(note.midi)).toBe(true);
        }
      }
    });

    it('respects the local movement constraint between consecutive notes', () => {
      for (const exercise of exercises) {
        let previous: (typeof exercise.notes)[number] | null = null;
        for (const note of exercise.notes) {
          if (note.midi === null) continue; // a rest does not break the line
          // Only enforced within an instance; joins between them may be wider.
          if (previous?.midi != null && previous.instance === note.instance) {
            expect(Math.abs(note.midi - previous.midi)).toBeLessThanOrEqual(
              tier.idioms.maxLocalInterval + 1, // +1 allows for a chromatic alteration
            );
          }
          previous = note;
        }
      }
    });

    it('only uses idioms from the tier categories', () => {
      for (const exercise of exercises) {
        for (const note of exercise.notes) {
          if (note.idiomId === PADDING_IDIOM_ID) continue;
          expect(tier.idioms.categories).toContain(idiomById(note.idiomId)!.category);
        }
      }
    });

    it('gives every note a positive duration', () => {
      expect(exercises.every((e) => e.notes.every((n) => n.value > 0))).toBe(true);
    });
  });

  it('renders the simple tier as a single idiom of whole notes', () => {
    for (const seed of SEEDS) {
      const exercise = generateExercise({ tier: TIERS.simple, seed });
      expect(new Set(exercise.notes.map((n) => n.idiomId)).size).toBe(1);
      // "1 idiom, single breve/whole note" per spec §2: an idiom event worth
      // two beats renders as a breve at whole-note density.
      expect(
        exercise.notes.every((n) => n.value === NOTE_VALUES.whole || n.value === NOTE_VALUES.breve),
      ).toBe(true);
    }
  });

  it('keeps the simple tier free of accidentals and rests', () => {
    for (const seed of SEEDS) {
      const exercise = generateExercise({ tier: TIERS.simple, seed });
      expect(exercise.notes.every((n) => n.midi !== null)).toBe(true);
      for (const note of exercise.notes) {
        expect(isDiatonic(exercise.keyCenter, note.midi!)).toBe(true);
      }
    }
  });

  it('fills exactly the medium tier’s two bars', () => {
    for (const seed of SEEDS) {
      const exercise = generateExercise({ tier: TIERS.medium, seed });
      const total = exercise.notes.reduce((sum, n) => sum + n.value, 0);
      expect(total).toBeCloseTo(2, 9); // two 4/4 bars = two whole notes
    }
  });

  it('emits only durations that can actually be drawn', () => {
    for (const seed of SEEDS) {
      for (const note of generateExercise({ tier: TIERS.medium, seed }).notes) {
        // Triplet members are drawn under a bracket, so they carry 2/3 of a
        // standard value; everything else must stand alone as a symbol.
        const value = note.tuplet === undefined ? note.value : (note.value * 3) / 2;
        expect(isNotatable(value)).toBe(true);
      }
    }
  });

  it('groups triplets in threes so the bar arithmetic stays exact', () => {
    for (const seed of SEEDS) {
      const { notes } = generateExercise({ tier: TIERS.medium, seed });
      const groups = new Map<number, number>();
      for (const note of notes) {
        if (note.tuplet !== undefined) groups.set(note.tuplet, (groups.get(note.tuplet) ?? 0) + 1);
      }
      for (const count of groups.values()) expect(count).toBe(3);
    }
  });

  it('lands the medium tier on a cadential idiom', () => {
    for (const seed of SEEDS) {
      const exercise = generateExercise({ tier: TIERS.medium, seed });
      const last = exercise.notes[exercise.notes.length - 1];
      expect(idiomById(last.idiomId)!.category).toBe('cadential');
      // Cadential idioms resolve to the tonic.
      expect(last.midi === null || (last.midi - exercise.keyCenter) % 12 === 0).toBe(true);
    }
  });

  it('mixes multiple idioms across a medium exercise', () => {
    const counts = SEEDS.map(
      (seed) => new Set(generateExercise({ tier: TIERS.medium, seed }).notes.map((n) => n.idiomId)).size,
    );
    expect(Math.max(...counts)).toBeGreaterThan(1);
  });

  it('spreads starting pitches across the region rather than clustering', () => {
    const firsts = SEEDS.map((seed) => generateExercise({ tier: TIERS.medium, seed }).notes[0].midi!);
    const span = Math.max(...firsts) - Math.min(...firsts);
    expect(span).toBeGreaterThan((HIGH - LOW) / 2);
  });

  it('over-samples the extremes of the region, as the weighting intends', () => {
    // Sampled across many exercises, the outer thirds should see more starts
    // than the middle third despite being no larger.
    const firsts = Array.from({ length: 400 }, (_, i) =>
      generateExercise({ tier: TIERS.medium, seed: i + 1 }).notes[0].midi!,
    );
    const third = (HIGH - LOW) / 3;
    const middle = firsts.filter((m) => m > LOW + third && m < HIGH - third).length;
    expect(firsts.length - middle).toBeGreaterThan(middle);
  });

  it('produces rests and accidentals only where the tier permits', () => {
    const medium = SEEDS.map((seed) => generateExercise({ tier: TIERS.medium, seed }));
    expect(medium.some((e) => e.notes.some((n) => n.midi === null))).toBe(true);
    expect(
      medium.some((e) => e.notes.some((n) => n.midi !== null && !isDiatonic(e.keyCenter, n.midi))),
    ).toBe(true);
  });

  it('never opens on a rest or ends on one', () => {
    for (const seed of SEEDS) {
      const { notes } = generateExercise({ tier: TIERS.medium, seed });
      expect(notes[0].midi).not.toBeNull();
      expect(notes[notes.length - 1].midi).not.toBeNull();
    }
  });

  it('accepts an injected rng as well as a seed', () => {
    const exercise = generateExercise({ tier: TIERS.medium, rng: mulberry32(7) });
    expect(exercise).toEqual(generateExercise({ tier: TIERS.medium, seed: 7 }));
  });
});
