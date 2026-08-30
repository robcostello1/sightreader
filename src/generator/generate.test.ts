import { describe, expect, it } from 'vitest';
import { PADDING_IDIOM_ID, generateExercise } from './generate';
import { startPitchWeight, validPlacements } from './placement';
import { mulberry32 } from './rng';
import { OPEN_POSITION, POSITIONS, regionPool } from '../config/regions';
import { MAX_LEVEL, levelConfig } from '../config/levels';
import { DEFAULT_VIABILITY, isViable, type ViabilityConfig } from '../config/viability';
import { midiToHz, nameToMidi } from '../lib/pitch';
import { fastestViableBpmForPool } from '../config/viability';
import { INSTRUMENTS, instrumentById, positionById, soundingPool } from '../config/instruments';
import { shortestNoteValue } from '../config/levels';
import { MAX_BPM } from '../config/tempo';
import { maxScorableBpm } from '../scoring';
import { NOMINAL_HOP_MS } from '../audio/constants';
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
  const constraints = { keyCenter: 60, pool: POOL, low: LOW, high: HIGH, maxInterval: 12 };

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

describe('register window', () => {
  // A pool spanning the readable width of a piano, which is what exposed both
  // bugs this covers: unreachable heights and octave-hopping within one line.
  const WIDE = Array.from({ length: 108 - 40 + 1 }, (_, i) => 40 + i);
  const pitchesFor = (pool: readonly number[], seed: number) =>
    generateExercise({ level: 4, pool, rng: mulberry32(seed) })
      .notes.map((note) => note.midi)
      .filter((midi): midi is number => midi !== null);

  it('reaches the top of a wide pool, not just the bottom four octaves', () => {
    // The degree search used to be a fixed window anchored on a key centre at
    // the foot of the pool, which put everything above roughly D5 out of reach.
    const highest = Math.max(...SEEDS.flatMap((seed) => pitchesFor(WIDE, seed)));
    expect(highest).toBeGreaterThan(84); // above C6
  });

  it('keeps any one exercise inside a span a reader can hold', () => {
    for (const seed of SEEDS) {
      const pitches = pitchesFor(WIDE, seed);
      expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThanOrEqual(28);
    }
  });

  it('spreads those windows over the whole pool across exercises', () => {
    const medians = SEEDS.map((seed) => {
      const pitches = pitchesFor(WIDE, seed).sort((a, b) => a - b);
      return pitches[Math.floor(pitches.length / 2)];
    });
    // Both hands get used: some exercises sit under middle C, some over it.
    expect(medians.some((midi) => midi < 60)).toBe(true);
    expect(medians.some((midi) => midi >= 72)).toBe(true);
  });

  it('leaves a fretboard region whole', () => {
    // Every guitar position is narrower than the window, so none is narrowed —
    // the extremes stay reachable, which is what the extreme bias is for.
    for (const region of POSITIONS) {
      const pool = regionPool(region);
      const pitches = SEEDS.flatMap((seed) => pitchesFor(pool, seed));
      // Within a tone of each end: whether the very top note turns up at all
      // depends on the keys drawn, so demanding it exactly makes the test
      // flaky about something it is not testing.
      expect(Math.min(...pitches)).toBeLessThanOrEqual(pool[0] + 2);
      expect(Math.max(...pitches)).toBeGreaterThanOrEqual(pool[pool.length - 1] - 2);
    }
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

  it('makes sequences diatonic — the shape moves, the key does not', () => {
    // A real sequence would hold the intervals exact and leave the key; a
    // modulating one would change key. Neither is wanted here, so a repeated
    // idiom must land on scale degrees of the same key.
    let sequences = 0;
    for (const seed of SEEDS) {
      const exercise = generateExercise({ level: MAX_LEVEL, seed });
      const byInstance = new Map<number, typeof exercise.notes>();
      for (const note of exercise.notes) {
        byInstance.set(note.instance, [...(byInstance.get(note.instance) ?? []), note]);
      }
      const instances = [...byInstance.values()];
      for (let i = 1; i < instances.length; i++) {
        const [before, after] = [instances[i - 1], instances[i]];
        if (before[0].idiomId !== after[0].idiomId) continue;
        if (before[0].idiomId === PADDING_IDIOM_ID) continue;
        if (before[0].midi === after[0].midi) continue;
        sequences++;
        // At most one note may be chromatic, and only from the accidental
        // decoration — never from the sequence itself.
        const outside = after.filter((n) => n.midi !== null && !isInKey(n.midi, exercise.key));
        expect(outside.length).toBeLessThanOrEqual(1);
      }
    }
    expect(sequences).toBeGreaterThan(0);
  });

  it('repeats idioms on a new degree once sequences are unlocked', () => {
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
        const exercise = generateExercise({ level: 6, pool: regionPool(region), seed });
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
        generateExercise({ level: 6, pool: regionPool(region), seed }).notes.flatMap((n) =>
          n.midi === null ? [] : [n.midi],
        ),
      );
      return Math.min(...pitches);
    };
    // Moving up the neck moves the music, which is the point of the position axis.
    expect(lowestIn('pos-9')).toBeGreaterThan(lowestIn('open'));
  });
});

describe('viability gating', () => {
  const ON: ViabilityConfig = { ...DEFAULT_VIABILITY, enabled: true };
  // A bass register, where long cycles make the gate bite at all.
  const BASS = Array.from({ length: 25 }, (_, i) => nameToMidi('E1') + i);

  it('changes nothing while it is switched off', () => {
    // The default has to be inert: the constants are still placeholders.
    const before = generateExercise({ level: 9, pool: BASS, bpm: 240, rng: mulberry32(7) });
    const after = generateExercise({
      level: 9,
      pool: BASS,
      bpm: 240,
      viability: DEFAULT_VIABILITY,
      rng: mulberry32(7),
    });
    expect(after.notes).toEqual(before.notes);
  });

  it('keeps every note it does generate scoreable', () => {
    for (const bpm of [60, 120, 200]) {
      for (const seed of SEEDS) {
        const exercise = generateExercise({ level: 9, pool: BASS, bpm, viability: ON, rng: mulberry32(seed) });
        const beatUnit = exercise.timeSignature[1];
        for (const note of exercise.notes) {
          if (note.midi === null) continue;
          expect(
            isViable(midiToHz(note.midi), note.value, beatUnit, bpm, ON),
          ).toBe(true);
        }
      }
    }
  });

  it('catches the tuplet, which is shorter than the value it is drawn at', () => {
    // Triplet quavers are drawn as quavers but last two thirds as long, so a
    // group can pass at placement and fail once it is squeezed. Checking the
    // notes as generated covers the squeezed value, since that is what they
    // carry.
    const BPM = 160;
    let seen = 0;
    for (const seed of SEEDS) {
      const exercise = generateExercise({
        level: 9,
        pool: BASS,
        bpm: BPM,
        viability: ON,
        rng: mulberry32(seed),
      });
      const beatUnit = exercise.timeSignature[1];
      for (const note of exercise.notes) {
        if (!note.tuplet || note.midi === null) continue;
        seen++;
        expect(isViable(midiToHz(note.midi), note.value, beatUnit, BPM, ON)).toBe(true);
      }
    }
    // A guard on the guard: level 9 in this register must actually produce
    // some, or the assertion above never runs.
    expect(seen).toBeGreaterThan(0);
  });

  it('rejects the phrase rather than patching a note out of it', () => {
    // Every note of an idiom instance shares its fate: an instance is never
    // returned with one pitch quietly swapped, which would leave a run that no
    // longer says anything. Instances are whole or absent.
    const exercise = generateExercise({ level: 8, pool: BASS, bpm: 150, viability: ON, rng: mulberry32(3) });
    const byInstance = new Map<string, number>();
    for (const note of exercise.notes) {
      const key = `${note.idiomId}:${note.instance}`;
      byInstance.set(key, (byInstance.get(key) ?? 0) + 1);
    }
    for (const [key, count] of byInstance) {
      if (key.startsWith(PADDING_IDIOM_ID)) continue;
      const idiom = idiomById(key.split(':')[0]);
      if (idiom) expect(count).toBe(idiom.events.length);
    }
  });

  it('leaves the treble alone, where the gate never bites', () => {
    // Same seeds, same everything, in a register whose cycles are short enough
    // that nothing is ever rejected.
    const treble = Array.from({ length: 25 }, (_, i) => nameToMidi('A4') + i);
    for (const seed of SEEDS) {
      const off = generateExercise({ level: 6, pool: treble, bpm: 120, rng: mulberry32(seed) });
      const on = generateExercise({ level: 6, pool: treble, bpm: 120, viability: ON, rng: mulberry32(seed) });
      expect(on.notes).toEqual(off.notes);
    }
  });

  it('still produces an exercise where it bites hardest', () => {
    // The fallback has to land somewhere: a longer note, a higher pitch, or a
    // different idiom. Emitting nothing at all would be a worse answer.
    for (const seed of SEEDS) {
      const exercise = generateExercise({ level: 10, pool: BASS, bpm: 200, viability: ON, rng: mulberry32(seed) });
      expect(exercise.notes.length).toBeGreaterThan(0);
    }
  });
});

describe('switching the gate on', () => {
  const ON: ViabilityConfig = { ...DEFAULT_VIABILITY, enabled: true };
  const instruments = INSTRUMENTS.filter((instrument) => instrument.status === 'available');

  /** What the tempo control would allow for this instrument at this level. */
  function ceilingFor(pool: readonly number[], level: number) {
    const config = levelConfig(level);
    const beatUnit = Math.min(...config.timeSignatures.map((entry) => entry.value[1]));
    const shortest = shortestNoteValue(config);
    return Math.min(
      MAX_BPM,
      maxScorableBpm(shortest, beatUnit, config.scoring, NOMINAL_HOP_MS),
      fastestViableBpmForPool(pool, shortest, beatUnit, ON),
    );
  }

  it.each(instruments.map((instrument) => [instrument.name, instrument.id] as const))(
    'still produces exercises for %s at the tempo the control would allow',
    (_name, id) => {
      // The flip is one flag, so what happens on the other side of it is worth
      // knowing before anyone throws it. The generator fails loudly when a
      // constraint combination leaves it nothing — this is the check that the
      // clamped tempo never puts it there.
      const instrument = instrumentById(id);
      const pool = soundingPool(instrument, positionById(instrument, null));
      for (const level of [1, 5, 10]) {
        const bpm = ceilingFor(pool, level);
        for (const seed of SEEDS.slice(0, 8)) {
          const exercise = generateExercise({
            level,
            pool,
            bpm,
            viability: ON,
            rng: mulberry32(seed),
          });
          expect(exercise.notes.length).toBeGreaterThan(0);
        }
      }
    },
  );
});
