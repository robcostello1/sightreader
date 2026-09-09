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
function candidates(
  position: NoteValue,
  barSize: NoteValue,
  common: boolean,
  signature: [number, number],
): NoteValue[] {
  const dotted = STANDARD_VALUES.flatMap((base) => [base * 1.75, base * 1.5, base]);
  const middle = barSize / 2;
  const beat = beatOf(signature);
  const intoBeat = position - Math.floor(position / beat + EPSILON) * beat;

  return dotted.filter((value) => {
    // Measured from the beat rather than from the bar, which is what compound
    // time needs: three quavers into a six-eight bar is the second beat, and a
    // crotchet rest there is ordinary — against the bar it divides nothing, and
    // the rest came out as a dotted quaver and a semiquaver.
    const divides =
      Math.abs(intoBeat % value) < EPSILON || Math.abs((intoBeat % value) - value) < EPSILON;
    // Or it finishes the beat off, which is how the rest of a compound beat is
    // written after a note has taken the first of it: a quaver and a crotchet
    // rest, not three quaver rests.
    const completesBeat = Math.abs((intoBeat + value) % beat) < EPSILON;
    if (!divides && !completesBeat) return false;

    // And it stays inside the beat it starts in, unless it covers whole ones.
    const end = position + value;
    const sameBeat = Math.floor((end - EPSILON) / beat) === Math.floor((position + EPSILON) / beat);
    const wholeBeats = intoBeat < EPSILON && Math.abs(end % beat) < EPSILON;
    if (!sameBeat && !wholeBeats) return false;

    if (!common) return true;
    const wholeBar = position < EPSILON && Math.abs(value - barSize) < EPSILON;
    return wholeBar || position >= middle - EPSILON || position + value <= middle + EPSILON;
  });
}

/** One beat as the meter is counted: a dotted one in compound time. */
function beatOf([beats, unit]: [number, number]): NoteValue {
  const compound = unit === 8 && beats % 3 === 0 && beats > 3;
  return (compound ? 3 : 1) / unit;
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
    const run = fill(position, total, barSize, common, inherited, timeSignature);
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
  signature: [number, number],
): NotatedNote[] | null {
  const rests: NotatedNote[] = [];
  let at = position;
  let remaining = total;

  while (remaining > EPSILON) {
    const value = candidates(at, barSize, common, signature).find(
      (v) => v <= remaining + EPSILON,
    );
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
