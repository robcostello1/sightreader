import { STANDARD_VALUES, notatedValue, toNotated } from '../lib/duration';
import type { NoteValue } from '../lib/types';
import type { NotatedNote } from './layout';

/**
 * sourceIndex of a symbol that answers to no note in the exercise: the other
 * hand's notes standing in as rests, and the extra symbols a long silence needs.
 * Nothing scores or highlights it, since there is nothing there to play.
 */
export const NO_SOURCE = -1;

const EPSILON = 1e-9;

/** Whole-note length of a drawn note, tuplet scaling included. */
export function drawnValue(note: NotatedNote): NoteValue {
  const value = notatedValue(note);
  return note.tuplet ? (value * note.tuplet.inSpaceOf) / note.tuplet.num : value;
}

/**
 * Values a rest may take at a given position in the bar, longest first.
 *
 * Two rules, both about reading rather than arithmetic. A rest sits on a
 * boundary its own length divides, so a half rest falls on a half of the bar
 * and not across one. And in common time nothing but a whole bar's rest may
 * cross the middle: the eye finds beat three by looking for it, and a dotted
 * half rest over beats one to three hides it.
 */
function candidates(position: NoteValue, barSize: NoteValue, common: boolean): NoteValue[] {
  const dotted = STANDARD_VALUES.flatMap((base) => [base * 1.75, base * 1.5, base]);
  const middle = barSize / 2;
  return dotted.filter((value) => {
    if (Math.abs(position % value) > EPSILON && Math.abs((position % value) - value) > EPSILON) {
      return false;
    }
    if (!common) return true;
    const wholeBar = position < EPSILON && Math.abs(value - barSize) < EPSILON;
    return wholeBar || position >= middle - EPSILON || position + value <= middle + EPSILON;
  });
}

/**
 * Rewrites runs of consecutive rests as the fewest symbols that cover them.
 *
 * On a grand staff every note in one hand leaves a rest in the other, so a bar
 * of quavers in the left hand becomes eight quaver rests in the right — noise
 * standing in for silence. One rest per span of silence is what a printed score
 * shows, and it takes the odd fragments out of the formatter's way.
 *
 * A run is left alone when it cannot be covered exactly, which happens when it
 * ends part way through a tuplet: two thirds of a crotchet is not a rest.
 */
export function mergeRests(
  notes: readonly NotatedNote[],
  timeSignature: [number, number],
): NotatedNote[] {
  const barSize = timeSignature[0] / timeSignature[1];
  const common = timeSignature[0] === 4 && timeSignature[1] === 4;
  const merged: NotatedNote[] = [];
  let position = 0;
  let index = 0;

  while (index < notes.length) {
    if (notes[index].midi !== null) {
      merged.push(notes[index]);
      position += drawnValue(notes[index]);
      index++;
      continue;
    }

    const start = index;
    let total = 0;
    while (index < notes.length && notes[index].midi === null) {
      total += drawnValue(notes[index]);
      index++;
    }

    // The cursor still has to land on a rest the player is counting, so the
    // merged symbol inherits the first real rest in the run. A run of nothing
    // but the other hand's notes has no index to inherit.
    const inherited =
      notes.slice(start, index).find((note) => note.sourceIndex !== NO_SOURCE)?.sourceIndex ??
      NO_SOURCE;
    const run = fill(position, total, barSize, common, inherited);
    if (run === null) {
      // Not coverable — a part-tuplet run. Better the original fragments than
      // silence drawn at the wrong length.
      merged.push(...notes.slice(start, index));
    } else {
      merged.push(...run);
    }
    position += total;
  }

  return merged;
}

/** Rests covering `total` from `position`, or null if no exact cover exists. */
function fill(
  position: NoteValue,
  total: NoteValue,
  barSize: NoteValue,
  common: boolean,
  sourceIndex: number,
): NotatedNote[] | null {
  const rests: NotatedNote[] = [];
  let at = position;
  let remaining = total;

  while (remaining > EPSILON) {
    const value = candidates(at, barSize, common).find((v) => v <= remaining + EPSILON);
    const notated = value === undefined ? null : toNotated(value);
    if (value === undefined || notated === null) return null;
    rests.push({
      midi: null,
      code: notated.code,
      dots: notated.dots,
      tiedToNext: false,
      // Only the first symbol carries the index; the rest are continuation.
      sourceIndex: rests.length === 0 ? sourceIndex : NO_SOURCE,
    });
    at += value;
    remaining -= value;
  }

  return rests;
}
