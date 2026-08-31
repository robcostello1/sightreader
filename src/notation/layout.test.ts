import { describe, expect, it } from 'vitest';
import { barDuration, explicitAccidental, layoutExercise, midiToVexKey } from './layout';
import { instrumentById, soundingToWritten } from '../config/instruments';
import { generateExercise } from '../generator';
import { keyByName } from '../lib/key';
import { NOTE_VALUES } from '../lib/types';
import type { Exercise, ExerciseNote } from '../lib/types';

const note = (value: number, midi: number | null = 60, extra: Partial<ExerciseNote> = {}): ExerciseNote => ({
  midi,
  value,
  idiomId: 'test',
  instance: 0,
  ...extra,
});

const C_MAJOR = keyByName('C');

const exercise = (notes: ExerciseNote[]): Exercise => ({
  notes,
  keyCenter: 60,
  key: C_MAJOR,
  timeSignature: [4, 4],
  bpm: 60,
});

describe('midiToVexKey', () => {
  it('formats pitches for VexFlow', () => {
    expect(midiToVexKey(60, C_MAJOR)).toBe('c/4');
    expect(midiToVexKey(61, C_MAJOR)).toBe('c#/4');
    expect(midiToVexKey(40, C_MAJOR)).toBe('e/2');
  });

  it('spells according to the key, not the MIDI number', () => {
    expect(midiToVexKey(70, keyByName('F'))).toBe('bb/4');
    expect(midiToVexKey(70, keyByName('G'))).toBe('a#/4');
  });
});

describe('guitar octave transposition', () => {
  it('writes an octave above sounding pitch', () => {
    const guitar = instrumentById('guitar');
    expect(soundingToWritten(40, guitar)).toBe(52); // low E sounds E2, written E3
    expect(soundingToWritten(64, guitar)).toBe(76); // high E sounds E4, written E5
  });

  it('puts the open strings where a guitarist expects to read them', () => {
    const guitar = instrumentById('guitar');
    const written = [40, 45, 50, 55, 59, 64].map((m) =>
      midiToVexKey(soundingToWritten(m, guitar), C_MAJOR),
    );
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
      note((NOTE_VALUES.quarter * 2) / 3, 60, { tuplet: { group: 0, num: 3, inSpaceOf: 2 } }),
    );
    const bars = layoutExercise(exercise([...triplet, note(NOTE_VALUES.half)]));
    const members = bars[0].notes.filter((n) => n.tuplet?.group === 0);
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
      const generated = generateExercise({ level: 6, seed });
      const bars = layoutExercise(generated);
      expect(bars.length).toBeGreaterThan(0);
      // Every source note reaches the page.
      const rendered = new Set(bars.flatMap((b) => b.notes.map((n) => n.sourceIndex)));
      expect(rendered.size).toBe(generated.notes.length);
      expect(bars.flatMap((b) => b.notes).every((n) => n.code.length > 0)).toBe(true);
    }
  });

  it('lays every level out into whole bars', () => {
    for (let level = 1; level <= 10; level++) {
      for (let seed = 1; seed <= 20; seed++) {
        const bars = layoutExercise(generateExercise({ level, seed }));
        expect(bars.length).toBeGreaterThan(0);
        // Bar indices are contiguous from the first — no gaps in the page.
        expect(bars.map((b) => b.index)).toEqual(
          bars.map((_, i) => bars[0].index + i),
        );
      }
    }
  });
});


describe('explicitAccidental', () => {
  // What a note drawn on its own needs to read correctly. VexFlow works this
  // out for notes inside a voice; the heard-note ghost belongs to none.
  const G = keyByName('G');
  const F = keyByName('F');
  const C = keyByName('C');

  it('asks for nothing when the signature already says it', () => {
    expect(explicitAccidental(66, G)).toBeNull(); // F# in G major
    expect(explicitAccidental(70, F)).toBeNull(); // Bb in F major
    expect(explicitAccidental(60, C)).toBeNull(); // C in C major
  });

  it('gives a chromatic note the accidental its spelling needs', () => {
    // spellInKey borrows the neighbouring letter — sharpened from below in a
    // sharp key, flattened from above in a flat one — so a note outside the
    // scale is never a bare natural. The heard F in G major is written E sharp,
    // and the sign has to agree with the letter the notehead sits on.
    expect(explicitAccidental(65, G)).toBe('#'); // E# on the E line
    expect(explicitAccidental(71, F)).toBe('b'); // Cb on the C line
  });

  it('names an alteration the signature does not carry', () => {
    expect(explicitAccidental(61, C)).toBe('#'); // C# in C major
    expect(explicitAccidental(61, F)).toBe('b'); // Db in F major, a flat key
  });

  it('agrees with the spelling the same note is drawn with', () => {
    // The glyph and the notehead have to come from one decision about the
    // spelling, or a Db would arrive with a sharp in front of it.
    for (const key of [C, G, F, keyByName('Eb'), keyByName('B')]) {
      for (let midi = 55; midi < 79; midi++) {
        const written = midiToVexKey(midi, key);
        const accidental = explicitAccidental(midi, key);
        if (accidental === '#') expect(written).toContain('#');
        if (accidental === 'b') expect(written).toContain('b/');
        if (accidental === 'n') expect(written).not.toMatch(/[#]|b\//);
      }
    }
  });
});
