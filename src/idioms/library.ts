import type { Idiom } from '../lib/types';

/**
 * The starting idiom set (spec §4), deliberately small so shapes recur often
 * enough to be recognised rather than decoded. Everything is relative: degree
 * offsets from wherever the idiom is placed, and beats relative to whatever note
 * value the tier's density dial supplies.
 *
 * Cadential idioms end on degree 0, so placing one on the tonic lands the phrase
 * there — that is how a generated phrase gets a shape rather than an arbitrary stop.
 */

const beat = (degree: number | null, beats = 1) => ({ degree, beats });

export const SCALAR_IDIOMS: Idiom[] = [
  {
    id: 'run-up-3',
    name: 'Ascending run, three notes',
    category: 'scalar',
    events: [beat(0), beat(1), beat(2, 2)],
  },
  {
    id: 'run-up-4',
    name: 'Ascending run, four notes',
    category: 'scalar',
    events: [beat(0), beat(1), beat(2), beat(3)],
  },
  {
    id: 'run-down-4',
    name: 'Descending run, four notes',
    category: 'scalar',
    events: [beat(0), beat(-1), beat(-2), beat(-3)],
  },
  {
    id: 'neighbour-upper',
    name: 'Upper neighbour',
    category: 'scalar',
    events: [beat(0), beat(1), beat(0, 2)],
  },
  {
    id: 'neighbour-lower',
    name: 'Lower neighbour',
    category: 'scalar',
    events: [beat(0), beat(-1), beat(0, 2)],
  },
  {
    id: 'turn',
    name: 'Turn figure',
    category: 'scalar',
    events: [beat(0), beat(1), beat(-1), beat(0)],
  },
];

export const ARPEGGIO_IDIOMS: Idiom[] = [
  {
    id: 'triad-up',
    name: 'Triad up',
    category: 'arpeggio',
    events: [beat(0), beat(2), beat(4, 2)],
  },
  {
    id: 'triad-down',
    name: 'Triad down',
    category: 'arpeggio',
    events: [beat(0), beat(-2), beat(-4, 2)],
  },
  {
    id: 'broken-triad',
    name: 'Broken triad',
    category: 'arpeggio',
    events: [beat(0), beat(2), beat(0), beat(4)],
  },
  {
    id: 'i-v-outline',
    name: 'I–V outline',
    category: 'arpeggio',
    // Tonic triad then dominant triad. Spans well over an octave, so the
    // generator will only place it where the region's pool can hold it.
    events: [beat(0), beat(2), beat(4), beat(4), beat(6), beat(8, 2)],
  },
];

export const INTERVAL_IDIOMS: Idiom[] = [
  {
    id: 'repeated-note',
    name: 'Repeated note',
    category: 'interval',
    // Zero pitch difficulty by design — a pure rhythm drill.
    events: [beat(0), beat(0), beat(0), beat(0)],
  },
  {
    id: 'alternating-thirds',
    name: 'Alternating thirds',
    category: 'interval',
    events: [beat(0), beat(2), beat(0), beat(2)],
  },
  {
    id: 'leap-fourth-step-back',
    name: 'Leap of a fourth, step back',
    category: 'interval',
    events: [beat(0), beat(3), beat(2, 2)],
  },
  {
    id: 'leap-fifth-step-back',
    name: 'Leap of a fifth, step back',
    category: 'interval',
    events: [beat(0), beat(4), beat(3, 2)],
  },
];

export const CADENTIAL_IDIOMS: Idiom[] = [
  {
    id: 'cadence-step-down',
    name: 'Step down to the tonic',
    category: 'cadential',
    events: [beat(2), beat(1), beat(0, 2)],
  },
  {
    id: 'cadence-from-fifth',
    name: 'Descent from the fifth to the tonic',
    category: 'cadential',
    events: [beat(4), beat(3), beat(2), beat(1), beat(0, 2)],
  },
];

/**
 * Rhythm rather than shape: what is being learnt is where the notes fall, so
 * the pitches stay as plain as they can be — a repeated note, a step, a
 * neighbour. Every one is marked rhythmFirst, to be met on its own before it is
 * met inside music.
 *
 * `beats` are relative, so these describe proportions and not note values: at a
 * quaver unit, a syncopation of 1-2-1 is quaver, crotchet, quaver, and at a
 * semiquaver unit the same shape is half as long.
 */
export const RHYTHMIC_IDIOMS: Idiom[] = [
  {
    id: 'syncopation-short-long-short',
    name: 'Syncopation, short–long–short',
    category: 'rhythmic',
    rhythmFirst: true,
    // The weight lands off the beat, which is the whole of the lesson.
    events: [beat(0, 1), beat(1, 2), beat(0, 1)],
  },
  {
    id: 'syncopation-offbeat-pair',
    name: 'Syncopation, off the beat and back',
    category: 'rhythmic',
    rhythmFirst: true,
    events: [beat(0, 1), beat(2, 2), beat(1, 2), beat(0, 1)],
  },
  {
    id: 'shuffle-pair',
    name: 'Shuffle, long then short',
    category: 'rhythmic',
    rhythmFirst: true,
    // Two notes to a beat of three: a crotchet and a quaver inside a dotted
    // crotchet. Compound time is what makes that a beat rather than a
    // syncopation, so it is written where the beat already divides in three
    // rather than faked with dots.
    meter: 'compound',
    events: [beat(0, 2), beat(1, 1), beat(0, 2), beat(1, 1)],
  },
  {
    id: 'shuffle-run',
    name: 'Shuffle, rising',
    category: 'rhythmic',
    rhythmFirst: true,
    meter: 'compound',
    events: [beat(0, 2), beat(1, 1), beat(2, 2), beat(3, 1)],
  },
  {
    id: 'anticipation',
    name: 'Anticipation',
    category: 'rhythmic',
    rhythmFirst: true,
    // The arrival comes early and is held: the last note is struck before the
    // beat it belongs to and lasts through it.
    events: [beat(0, 2), beat(1, 1), beat(2, 3)],
  },
  {
    id: 'anticipated-cadence',
    name: 'Anticipated arrival',
    category: 'rhythmic',
    rhythmFirst: true,
    events: [beat(2, 2), beat(1, 1), beat(0, 5)],
  },
];

export const IDIOM_LIBRARY: Idiom[] = [
  ...SCALAR_IDIOMS,
  ...ARPEGGIO_IDIOMS,
  ...INTERVAL_IDIOMS,
  ...CADENTIAL_IDIOMS,
  ...RHYTHMIC_IDIOMS,
];

export function idiomById(id: string): Idiom | undefined {
  return IDIOM_LIBRARY.find((idiom) => idiom.id === id);
}
