import { describe, expect, it } from 'vitest';
import { PADDING_IDIOM_ID, generateExercise } from './generate';
import { startPitchWeight, validPlacements } from './placement';
import { mulberry32 } from './rng';
import { OPEN_POSITION, POSITIONS, regionPool } from '../config/regions';
import { MAX_LEVEL, levelConfig } from '../config/levels';
import { idiomById } from '../idioms';
import { isInKey, keyByName } from '../lib/key';
import { NOTE_VALUES } from '../lib/types';

const POOL_LIST = regionPool(OPEN_POSITION);
const POOL = new Set(POOL_LIST);
const LOW = POOL_LIST[0];
const HIGH = POOL_LIST[POOL_LIST.length - 1];
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const ALL_LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

describe('startPitchWeight', () => {
  it('favours the extremes of the region over its middle', () => {
    const middle = startPitchWeight((LOW + HIGH) / 2, LOW, HIGH, 3);
    expect(startPitchWeight(LOW, LOW, HIGH, 3)).toBeGreaterThan(middle);
    expect(startPitchWeight(HIGH, LOW, HIGH, 3)).toBeGreaterThan(middle);
  });

  it('flattens to uniform when the bias is zero', () => {
    expect(startPitchWeight(LOW, LOW, HIGH, 0)).toBe(
      startPitchWeight((LOW + HIGH) / 2, LOW, HIGH, 0),
    );
  });
});

describe('validPlacements', () => {
  const constraints = { keyCenter: 60, pool: POOL, maxInterval: 12 };

  it('applies the local interval constraint independently of the pool', () => {
    const wide = validPlacements(idiomById('leap-fifth-step-back')!, NOTE_VALUES.quarter, constraints);
    const narrow = validPlacements(idiomById('leap-fifth-step-back')!, NOTE_VALUES.quarter, {
      ...constraints,
      maxInterval: 4, // a fifth cannot fit
    });
    expect(wide.length).toBeGreaterThan(0);
    expect(narrow).toHaveLength(0);
  });

  it('rejects an idiom too wide for the constraint entirely', () => {
    expect(
      validPlacements(idiomById('i-v-outline')!, NOTE_VALUES.quarter, { ...constraints, maxInterval: 3 }),
    ).toHaveLength(0);
  });
});

describe('generateExercise', () => {
  it('is reproducible from a seed', () => {
    const a = generateExercise({ level: 6, seed: 42 });
    expect(generateExercise({ level: 6, seed: 42 })).toEqual(a);
    expect(generateExercise({ level: 6, seed: 43 })).not.toEqual(a);
    expect(generateExercise({ level: 6, rng: mulberry32(42) })).toEqual(a);
  });

  describe.each(ALL_LEVELS)('level %i', (level) => {
    const config = levelConfig(level);
    const exercises = SEEDS.map((seed) => generateExercise({ level, seed }));

    it('produces a non-empty exercise with positive durations', () => {
      expect(exercises.every((e) => e.notes.length > 0)).toBe(true);
      expect(exercises.every((e) => e.notes.every((n) => n.value > 0))).toBe(true);
    });

    it('keeps every pitch inside the region pool', () => {
      for (const exercise of exercises) {
        for (const note of exercise.notes) {
          if (note.midi !== null) expect(POOL.has(note.midi)).toBe(true);
        }
      }
    });

    it('respects the level’s interval allowance within an idiom instance', () => {
      for (const exercise of exercises) {
        let previous: (typeof exercise.notes)[number] | null = null;
        for (const note of exercise.notes) {
          // A rest breaks the line: the constraint is about consecutive sounding
          // notes, and the reader re-orients across a gap anyway.
          if (note.midi === null) {
            previous = null;
            continue;
          }
          if (previous?.midi != null && previous.instance === note.instance) {
            expect(Math.abs(note.midi - previous.midi)).toBeLessThanOrEqual(
              config.maxLocalInterval + 1, // +1 allows a chromatic alteration
            );
          }
          previous = note;
        }
      }
    });

    it('only draws on idiom categories the level admits', () => {
      for (const exercise of exercises) {
        for (const note of exercise.notes) {
          if (note.idiomId === PADDING_IDIOM_ID) continue;
          const category = idiomById(note.idiomId)!.category;
          expect(config.categoryChance[category]).toBeGreaterThan(0);
        }
      }
    });

    it('only uses keys the level admits', () => {
      for (const exercise of exercises) {
        // The fractional part allows one more accidental than the whole part.
        expect(Math.abs(exercise.key.accidentals)).toBeLessThanOrEqual(
          Math.ceil(config.maxKeyAccidentals),
        );
      }
    });

    it('ends on a bar line without padding out dead time', () => {
      for (const exercise of exercises) {
        const barSize = exercise.timeSignature[0] / exercise.timeSignature[1];
        const total = exercise.notes.reduce((sum, n) => sum + n.value, 0);
        // A whole number of bars, in whatever signature was drawn.
        const bars = total / barSize;
        expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-9);
        // Rounding up to a bar line can never add a whole bar of its own.
        expect(bars).toBeLessThanOrEqual(config.targetBars + 1);
        expect(bars).toBeGreaterThan(0);
      }
    });

    it('draws only signatures the level admits', () => {
      const allowed = config.timeSignatures.map((entry) => entry.value.join('/'));
      for (const exercise of exercises) {
        expect(allowed).toContain(exercise.timeSignature.join('/'));
      }
    });

    it('never holds a note for more than a bar', () => {
      // A note tied across two whole bars is dead time — the reader is just
      // waiting. Padding rounds to the bar line and turns to rests rather than
      // inflating a note past one bar.
      for (const exercise of exercises) {
        const barSize = exercise.timeSignature[0] / exercise.timeSignature[1];
        for (const note of exercise.notes) {
          expect(note.value).toBeLessThanOrEqual(barSize + 1e-9);
        }
      }
    });

    it('never opens or ends on a rest', () => {
      for (const exercise of exercises) {
        expect(exercise.notes[0].midi).not.toBeNull();
        expect(exercise.notes[exercise.notes.length - 1].midi).not.toBeNull();
      }
    });

    it('keeps each tuplet group inside one bar', () => {
      // Split across a bar line, neither bar holds the whole group, so the
      // bracket cannot be drawn over it.

      for (const exercise of exercises) {
        const barSize = exercise.timeSignature[0] / exercise.timeSignature[1];
        let position = 0;
        const spans = new Map<number, { start: number; end: number }>();
        for (const note of exercise.notes) {
          if (note.tuplet) {
            const span = spans.get(note.tuplet.group) ?? { start: position, end: position };
            span.end = position + note.value;
            spans.set(note.tuplet.group, span);
          }
          position += note.value;
        }
        for (const { start, end } of spans.values()) {
          expect(Math.floor(start / barSize + 1e-9)).toBe(Math.floor((end - 1e-9) / barSize));
        }
      }
    });

    it('groups tuplets completely', () => {
      for (const exercise of exercises) {
        const groups = new Map<number, { count: number; num: number }>();
        for (const note of exercise.notes) {
          if (!note.tuplet) continue;
          const entry = groups.get(note.tuplet.group) ?? { count: 0, num: note.tuplet.num };
          entry.count++;
          groups.set(note.tuplet.group, entry);
        }
        for (const { count, num } of groups.values()) expect(count).toBe(num);
      }
    });
  });

  it('keeps level 1 to one short idiom of long notes in C major', () => {
    for (const seed of SEEDS) {
      const exercise = generateExercise({ level: 1, seed });
      expect(new Set(exercise.notes.map((n) => n.idiomId)).size).toBe(1);
      // Halves and wholes only — nothing shorter than a minim at level 1.
      expect(exercise.notes.every((n) => n.value >= NOTE_VALUES.half)).toBe(true);
      expect(exercise.key.name).toBe('C');
      expect(exercise.notes.every((n) => n.midi !== null && isInKey(n.midi, exercise.key))).toBe(true);
      // Two bars, so a mistake is found out quickly.
      expect(exercise.notes.reduce((sum, n) => sum + n.value, 0)).toBeCloseTo(2, 9);
      // And no single note swallows a whole bar on its own.
      expect(exercise.notes.every((n) => n.value <= 1 + 1e-9)).toBe(true);
    }
  });

  it('brings a level’s ideas into a minority of exercises as soon as it is reached', () => {
    const withArpeggios = (level: number) =>
      SEEDS.filter((seed) =>
        generateExercise({ level, seed }).notes.some(
          (n) => n.idiomId !== PADDING_IDIOM_ID && idiomById(n.idiomId)!.category === 'arpeggio',
        ),
      ).length;

    // None before the level, some at it, most by the end of it.
    expect(withArpeggios(2.9)).toBe(0);
    expect(withArpeggios(3)).toBeGreaterThan(0);
    expect(withArpeggios(3)).toBeLessThan(SEEDS.length);
    expect(withArpeggios(3.9)).toBeGreaterThan(withArpeggios(3));
  });

  it('phases a level’s new ideas in across its tenths', () => {
    const restsAt = (level: number) =>
      SEEDS.filter((seed) =>
        generateExercise({ level, seed }).notes.some((n) => n.midi === null),
      ).length;
    // Nothing before the level, then a rising share across it.
    expect(restsAt(2.9)).toBe(0);
    expect(restsAt(3.9)).toBeGreaterThan(restsAt(3));
  });

  it('introduces devices only once their level is reached', () => {
    const has = (level: number, predicate: (e: ReturnType<typeof generateExercise>) => boolean) =>
      SEEDS.some((seed) => predicate(generateExercise({ level, seed })));

    const hasRest = (e: ReturnType<typeof generateExercise>) => e.notes.some((n) => n.midi === null);
    const hasTuplet = (e: ReturnType<typeof generateExercise>) => e.notes.some((n) => n.tuplet);
    const hasAccidental = (e: ReturnType<typeof generateExercise>) =>
      e.notes.some((n) => n.midi !== null && !isInKey(n.midi, e.key));

    expect(has(1, hasRest)).toBe(false);
    expect(has(1, hasTuplet)).toBe(false);
    expect(has(1, hasAccidental)).toBe(false);
    expect(has(2, hasTuplet)).toBe(false);
    expect(has(MAX_LEVEL, hasRest)).toBe(true);
    expect(has(MAX_LEVEL, hasTuplet)).toBe(true);
  });

  it('shortens notes as the level rises', () => {
    const meanValue = (level: number) => {
      const notes = SEEDS.flatMap((seed) => generateExercise({ level, seed }).notes);
      return notes.reduce((sum, n) => sum + n.value, 0) / notes.length;
    };
    expect(meanValue(1)).toBeGreaterThan(meanValue(5));
    expect(meanValue(5)).toBeGreaterThan(meanValue(MAX_LEVEL));
  });

  it('widens the keys used as the level rises', () => {
    const keysAt = (level: number) =>
      new Set(SEEDS.map((seed) => generateExercise({ level, seed }).key.name));
    expect(keysAt(1)).toEqual(new Set(['C']));
    expect(keysAt(MAX_LEVEL).size).toBeGreaterThan(3);
  });

  it('repeats idioms transposed once sequences are unlocked', () => {
    // A sequence is the same idiom at a new degree — two instances sharing an
    // idiomId but starting on different pitches.
    const sequenced = SEEDS.some((seed) => {
      const { notes } = generateExercise({ level: MAX_LEVEL, seed });
      const firsts = new Map<number, { id: string; midi: number | null }>();
      for (const note of notes) {
        if (!firsts.has(note.instance)) firsts.set(note.instance, { id: note.idiomId, midi: note.midi });
      }
      const byIdiom = new Map<string, (number | null)[]>();
      for (const { id, midi } of firsts.values()) {
        byIdiom.set(id, [...(byIdiom.get(id) ?? []), midi]);
      }
      return [...byIdiom.values()].some(
        (starts) => starts.length > 1 && new Set(starts).size > 1,
      );
    });
    expect(sequenced).toBe(true);
  });

  it('honours an explicitly requested key', () => {
    const exercise = generateExercise({ level: MAX_LEVEL, seed: 5, key: keyByName('Eb') });
    expect(exercise.key.name).toBe('Eb');
  });

  describe.each(POSITIONS.map((p) => [p.name, p] as const))('in %s', (_name, region) => {
    it('stays within that position’s pool', () => {
      const pool = new Set(regionPool(region));
      for (const seed of SEEDS.slice(0, 15)) {
        const exercise = generateExercise({ level: 6, region, seed });
        expect(exercise.notes.length).toBeGreaterThan(0);
        for (const note of exercise.notes) {
          if (note.midi !== null) expect(pool.has(note.midi)).toBe(true);
        }
      }
    });
  });

  it('produces different pitch ranges in different positions', () => {
    const lowestIn = (regionId: string) => {
      const region = POSITIONS.find((p) => p.id === regionId)!;
      const pitches = SEEDS.slice(0, 15).flatMap((seed) =>
        generateExercise({ level: 6, region, seed }).notes.flatMap((n) => (n.midi === null ? [] : [n.midi])),
      );
      return Math.min(...pitches);
    };
    // Moving up the neck moves the music, which is the point of the position axis.
    expect(lowestIn('pos-9')).toBeGreaterThan(lowestIn('open'));
  });
});
