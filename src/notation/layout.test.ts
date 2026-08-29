import { describe, expect, it } from 'vitest';
import { GUITAR_WRITTEN_OFFSET, barDuration, layoutExercise, midiToVexKey, soundingToWritten } from './layout';
import { generateExercise } from '../generator';
import { TIERS } from '../config/tiers';
import { NOTE_VALUES } from '../lib/types';
import type { Exercise, ExerciseNote } from '../lib/types';

const note = (value: number, midi: number | null = 60, extra: Partial<ExerciseNote> = {}): ExerciseNote => ({
  midi,
  value,
  idiomId: 'test',
  instance: 0,
  ...extra,
});

const exercise = (notes: ExerciseNote[]): Exercise => ({
  notes,
  keyCenter: 60,
  timeSignature: [4, 4],
  bpm: 60,
});

describe('midiToVexKey', () => {
  it('formats naturals and sharps for VexFlow', () => {
    expect(midiToVexKey(60)).toEqual({ key: 'c/4', accidental: null });
    expect(midiToVexKey(61)).toEqual({ key: 'c#/4', accidental: '#' });
    expect(midiToVexKey(40)).toEqual({ key: 'e/2', accidental: null });
  });
});

describe('guitar octave transposition', () => {
  it('writes an octave above sounding pitch', () => {
    expect(GUITAR_WRITTEN_OFFSET).toBe(12);
    expect(soundingToWritten(40)).toBe(52); // low E sounds E2, written E3
    expect(soundingToWritten(64)).toBe(76); // high E sounds E4, written E5
  });

  it('puts the open strings where a guitarist expects to read them', () => {
    const written = [40, 45, 50, 55, 59, 64].map((m) => midiToVexKey(soundingToWritten(m)).key);
    expect(written).toEqual(['e/3', 'a/3', 'd/4', 'g/4', 'b/4', 'e/5']);
  });
});

describe('barDuration', () => {
  it('measures a bar in whole-note units', () => {
    expect(barDuration([4, 4])).toBe(1);
    expect(barDuration([3, 4])).toBe(0.75);
    expect(barDuration([6, 8])).toBe(0.75);
  });
});

describe('layoutExercise', () => {
  it('groups notes into bars', () => {
    const bars = layoutExercise(
      exercise([note(NOTE_VALUES.half), note(NOTE_VALUES.half), note(NOTE_VALUES.whole)]),
    );
    expect(bars).toHaveLength(2);
    expect(bars[0].notes).toHaveLength(2);
    expect(bars[1].notes).toHaveLength(1);
  });

  it('maps durations to VexFlow codes', () => {
    const bars = layoutExercise(exercise([note(NOTE_VALUES.quarter), note(NOTE_VALUES.eighth)]));
    expect(bars[0].notes.map((n) => n.code)).toEqual(['q', '8']);
  });

  it('splits a note crossing a bar line into tied fragments', () => {
    // Half note starting three quarters into the bar: a quarter, tied to a quarter.
    const bars = layoutExercise(
      exercise([note(0.75), note(NOTE_VALUES.half)]),
    );
    expect(bars).toHaveLength(2);
    const [first] = bars[0].notes.filter((n) => n.sourceIndex === 1);
    const [second] = bars[1].notes.filter((n) => n.sourceIndex === 1);
    expect(first.tiedToNext).toBe(true);
    expect(second.tiedToNext).toBe(false);
    expect(first.code).toBe('q');
    expect(second.code).toBe('q');
  });

  it('does not tie split rests together', () => {
    const bars = layoutExercise(exercise([note(0.75, null), note(NOTE_VALUES.half, null)]));
    expect(bars.flatMap((b) => b.notes).every((n) => !n.tiedToNext)).toBe(true);
  });

  it('keeps a dotted value as one symbol rather than splitting it', () => {
    const bars = layoutExercise(exercise([note(0.75)]));
    expect(bars[0].notes).toHaveLength(1);
    expect(bars[0].notes[0]).toMatchObject({ code: 'h', dots: 1 });
  });

  it('draws tuplet members at their bracketed symbol', () => {
    const triplet = Array.from({ length: 3 }, () =>
      note((NOTE_VALUES.quarter * 2) / 3, 60, { tuplet: 0 }),
    );
    const bars = layoutExercise(exercise([...triplet, note(NOTE_VALUES.half)]));
    const members = bars[0].notes.filter((n) => n.tuplet === 0);
    expect(members).toHaveLength(3);
    // Three crotchet-triplets occupy two crotchets, each drawn as a crotchet.
    expect(members.every((n) => n.code === 'q')).toBe(true);
  });

  it('tracks the source index so results can colour the right note', () => {
    const bars = layoutExercise(exercise([note(NOTE_VALUES.half), note(NOTE_VALUES.half)]));
    expect(bars[0].notes.map((n) => n.sourceIndex)).toEqual([0, 1]);
  });

  it('lays out every generated exercise without dropping duration', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const generated = generateExercise({ tier: TIERS.medium, seed });
      const bars = layoutExercise(generated);
      expect(bars.length).toBeGreaterThan(0);
      // Every source note reaches the page.
      const rendered = new Set(bars.flatMap((b) => b.notes.map((n) => n.sourceIndex)));
      expect(rendered.size).toBe(generated.notes.length);
      expect(bars.flatMap((b) => b.notes).every((n) => n.code.length > 0)).toBe(true);
    }
  });

  it('fills exactly two bars for a medium exercise', () => {
    for (let seed = 1; seed <= 60; seed++) {
      expect(layoutExercise(generateExercise({ tier: TIERS.medium, seed }))).toHaveLength(2);
    }
  });
});
