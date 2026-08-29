import { decompose, toNotated } from '../lib/duration';
import { midiToName } from '../lib/pitch';
import type { Exercise, Midi, NoteValue } from '../lib/types';

export interface NotatedNote {
  midi: Midi | null;
  /** VexFlow duration code. */
  code: string;
  dots: number;
  /** Shared id for notes drawn under one tuplet bracket. */
  tuplet?: number;
  /** True when this is a fragment tied to the next, from crossing a bar line. */
  tiedToNext: boolean;
  /** Index in the source exercise, so results can colour the right note. */
  sourceIndex: number;
}

export interface NotatedBar {
  index: number;
  notes: NotatedNote[];
}

/**
 * Guitar is a transposing instrument: it is written an octave above where it
 * sounds, on a treble clef marked with an 8 below (the "treble-8" clef). The low
 * E string sounds E2 but is written E3.
 *
 * Everything else in the app — pitch detection, scoring, the region pool — works
 * in sounding pitch. This offset is applied only when spelling a note for the
 * page, so the two never get confused.
 */
export const GUITAR_WRITTEN_OFFSET = 12;

export function soundingToWritten(midi: Midi): Midi {
  return midi + GUITAR_WRITTEN_OFFSET;
}

/** VexFlow key string plus the accidental it needs spelled out. Takes written pitch. */
export function midiToVexKey(midi: Midi): { key: string; accidental: string | null } {
  const parsed = /^([A-G])(#?)(-?\d+)$/.exec(midiToName(midi));
  if (!parsed) throw new Error(`unrenderable pitch: ${midi}`);
  const [, letter, sharp, octave] = parsed;
  return {
    key: `${letter.toLowerCase()}${sharp}/${octave}`,
    // Everything is generated in C major, so any sharp is an accidental.
    accidental: sharp ? '#' : null,
  };
}

/** Whole-note units in one bar. */
export function barDuration([beatsPerBar, beatUnit]: [number, number]): NoteValue {
  return beatsPerBar / beatUnit;
}

/**
 * Splits an exercise into bars, breaking any note that crosses a bar line into
 * tied fragments. A duration is only a symbol once it fits inside a bar, so this
 * has to happen before anything can be drawn.
 */
export function layoutExercise(exercise: Exercise): NotatedBar[] {
  const barSize = barDuration(exercise.timeSignature);
  const bars: NotatedBar[] = [];
  let cursor = 0;

  const currentBar = (): NotatedBar => {
    const index = Math.floor(cursor / barSize + 1e-9);
    let bar = bars.find((b) => b.index === index);
    if (!bar) {
      bar = { index, notes: [] };
      bars.push(bar);
    }
    return bar;
  };

  exercise.notes.forEach((note, sourceIndex) => {
    // Tuplet members are drawn under a bracket at their undotted symbol, and are
    // short enough that splitting them across a bar line never arises.
    if (note.tuplet !== undefined) {
      const notated = toNotated((note.value * 3) / 2);
      if (notated) {
        currentBar().notes.push({
          midi: note.midi,
          code: notated.code,
          dots: notated.dots,
          tuplet: note.tuplet,
          tiedToNext: false,
          sourceIndex,
        });
        cursor += note.value;
        return;
      }
    }

    let remaining = note.value;
    const fragments: NotatedNote[] = [];
    while (remaining > 1e-9) {
      const spaceInBar = barSize - (cursor % barSize);
      const take = Math.min(remaining, spaceInBar - 1e-9 > 0 ? spaceInBar : barSize);
      // A dotted value is one symbol, so only fall back to splitting when the
      // whole span cannot be drawn on its own.
      const parts = toNotated(take) ? [take] : decompose(take);
      for (const part of parts) {
        const notated = toNotated(part);
        if (!notated) continue;
        const fragment: NotatedNote = {
          midi: note.midi,
          code: notated.code,
          dots: notated.dots,
          tiedToNext: false,
          sourceIndex,
        };
        currentBar().notes.push(fragment);
        fragments.push(fragment);
        cursor += part;
      }
      remaining -= take;
    }
    // Only pitched notes are tied; consecutive rests are simply separate rests.
    if (note.midi !== null) {
      for (let i = 0; i < fragments.length - 1; i++) fragments[i].tiedToNext = true;
    }
  });

  return bars.sort((a, b) => a.index - b.index);
}
