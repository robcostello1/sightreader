import { decompose, toNotated } from '../lib/duration';
import { spellInKey, type MusicalKey } from '../lib/key';
import type { Exercise, Midi, NoteValue, TupletMembership } from '../lib/types';

export interface NotatedNote {
  midi: Midi | null;
  /** VexFlow duration code. */
  code: string;
  dots: number;
  /** Membership of a tuplet group, when this note belongs to one. */
  tuplet?: TupletMembership;
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
 * VexFlow key string for a written pitch, spelled according to the key — B flat
 * in F major, A sharp in G. VexFlow places the accidentals itself from the key
 * signature, so none are named here.
 */
export function midiToVexKey(midi: Midi, key: MusicalKey): string {
  const { letter, alter, octave } = spellInKey(midi, key);
  const accidental = alter === 0 ? '' : alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
  return `${letter.toLowerCase()}${accidental}/${octave}`;
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
    // Tuplet members are drawn under a bracket at the symbol they would have
    // outside it, and are short enough that splitting across a bar line never
    // arises. A 3:2 triplet quaver is drawn as a quaver; 5:4 as a semiquaver.
    if (note.tuplet !== undefined) {
      const { num, inSpaceOf } = note.tuplet;
      const notated = toNotated((note.value * num) / inSpaceOf);
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
      if (parts.length === 0) {
        // Silently skipping would drop this note and every one after it, since
        // the cursor would stop advancing. Fail where the cause is visible.
        throw new Error(
          `cannot notate duration ${take} at bar offset ${cursor % barSize} ` +
            `(note ${sourceIndex}, value ${note.value})`,
        );
      }
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
