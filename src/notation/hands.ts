import { soundingToWritten } from '../config/instruments';
import { beatOf, drawnValue, NO_SOURCE } from './rests';
import type { InstrumentDefinition } from '../config/instruments';
import type { Midi } from '../lib/types';
import type { NotatedNote } from './layout';

/** Where the hands divide. Middle C and above is the right hand's. */
const MIDDLE_C = 60;

const EPSILON = 1e-9;

/**
 * How far either side of middle C a note may be pulled onto the other staff to
 * keep its beat whole. A fifth is about two ledger lines, which reads.
 */
const SHARED_SEMITONES = 7;

/**
 * The group each note belongs to, one key per note: its tuplet where it has
 * one, and otherwise the beat it starts in.
 */
function groupKeys(notes: readonly NotatedNote[], signature: [number, number]): string[] {
  const beat = beatOf(signature);
  let position = 0;
  return notes.map((notated) => {
    const key =
      notated.tuplet !== undefined
        ? `t${notated.tuplet.group}`
        : `b${Math.floor(position / beat + EPSILON)}`;
    position += drawnValue(notated);
    return key;
  });
}

/**
 * Which hand each group of notes is written in: wherever most of the group
 * sounds. A group is a tuplet, or failing that the beat the note starts in.
 *
 * Splitting note by note at middle C strands the odd note on its own staff — a
 * semiquaver alone in the bass under a treble figure, and eleven sixteenths of
 * rests printed under it to make up the bar. A player reads that as two hands
 * when it is one. Keeping the beat together sends the outlier across with a
 * ledger line instead, which is what a printed part does. Ties are left split:
 * two notes either side of middle C are a real alternation, and moving one
 * would only be a guess.
 *
 * Only notes near middle C follow the beat — see SHARED_SEMITONES. Anything
 * further out is squarely one hand's, and dragging it across would buy a tidy
 * bar with four ledger lines.
 */
function staffByGroup(
  notes: readonly NotatedNote[],
  instrument: InstrumentDefinition,
  signature: [number, number],
): Map<string, 'treble' | 'bass'> {
  const counts = new Map<string, { treble: number; bass: number; first: 'treble' | 'bass' }>();
  const keys = groupKeys(notes, signature);
  notes.forEach((notated, index) => {
    if (notated.midi === null) return;
    const side = handFor(notated.midi, instrument);
    const entry = counts.get(keys[index]) ?? { treble: 0, bass: 0, first: side };
    entry[side]++;
    counts.set(keys[index], entry);
  });
  const staves = new Map<string, 'treble' | 'bass'>();
  for (const [key, { treble, bass, first }] of counts) {
    // A tuplet is one bracket whichever way it leans, so an even one still
    // picks a side; an even beat keeps both hands.
    if (treble !== bass) staves.set(key, treble > bass ? 'treble' : 'bass');
    else if (key.startsWith('t')) staves.set(key, first);
  }
  return staves;
}

export function handFor(midi: Midi, instrument: InstrumentDefinition): 'treble' | 'bass' {
  return soundingToWritten(midi, instrument) >= MIDDLE_C ? 'treble' : 'bass';
}

/**
 * One staff's view of a bar: the notes that belong to it, with the other
 * staff's notes standing in as rests so both voices span the same bar.
 */
export function notesForStaff(
  notes: readonly NotatedNote[],
  side: 'treble' | 'bass',
  instrument: InstrumentDefinition,
  signature: [number, number],
): NotatedNote[] {
  const groups = staffByGroup(notes, instrument, signature);
  const keys = groupKeys(notes, signature);
  return notes.map((notated, index) => {
    if (notated.midi === null) return notated; // a rest is a rest in both hands
    const own = handFor(notated.midi, instrument);
    const shared =
      notated.tuplet !== undefined ||
      Math.abs(soundingToWritten(notated.midi, instrument) - MIDDLE_C) <= SHARED_SEMITONES;
    const belongs = (shared ? groups.get(keys[index]) : undefined) ?? own;
    // Not this staff's note at all, so it answers to no result and no cursor —
    // it is only here so both voices count the same ticks.
    return belongs === side
      ? notated
      : { ...notated, midi: null, tiedToNext: false, sourceIndex: NO_SOURCE };
  });
}
