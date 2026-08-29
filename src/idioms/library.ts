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

export const IDIOM_LIBRARY: Idiom[] = [
  ...SCALAR_IDIOMS,
  ...ARPEGGIO_IDIOMS,
  ...INTERVAL_IDIOMS,
  ...CADENTIAL_IDIOMS,
];

export function idiomById(id: string): Idiom | undefined {
  return IDIOM_LIBRARY.find((idiom) => idiom.id === id);
}
