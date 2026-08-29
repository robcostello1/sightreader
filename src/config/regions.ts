import type { Midi } from '../lib/types';

/**
 * Fretboard region model (spec §3).
 *
 * Position is deliberately a separate axis from level: moving up the neck
 * changes *what* you are practising — a different set of shapes under the hand,
 * the same notes in a new place — rather than making the reading harder. A
 * learner should be able to take level 3 up to 5th position without also being
 * handed quavers and accidentals.
 */
export interface FretboardRegion {
  id: string;
  name: string;
  /** Open-string pitches, low to high. Standard tuning by default. */
  tuning: Midi[];
  /** Inclusive fret span reachable without shifting position. */
  frets: [number, number];
  /** Whether open strings are available, which only holds low on the neck. */
  includesOpenStrings: boolean;
}

export const STANDARD_TUNING: Midi[] = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

function position(
  id: string,
  name: string,
  lowFret: number,
  span = 3,
  includesOpenStrings = false,
): FretboardRegion {
  return {
    id,
    name,
    tuning: STANDARD_TUNING,
    frets: [lowFret, lowFret + span],
    includesOpenStrings,
  };
}

export const OPEN_POSITION: FretboardRegion = {
  id: 'open',
  name: 'Open position',
  tuning: STANDARD_TUNING,
  frets: [0, 4],
  includesOpenStrings: true,
};

/**
 * A four-fret span per position, which is one finger per fret. Positions are
 * named for the fret the index finger sits on, as guitarists number them.
 */
export const POSITIONS: FretboardRegion[] = [
  OPEN_POSITION,
  position('pos-2', '2nd position', 2),
  position('pos-4', '4th position', 4),
  position('pos-5', '5th position', 5),
  position('pos-7', '7th position', 7),
  position('pos-9', '9th position', 9),
  position('pos-12', '12th position', 12),
];

/**
 * Positions are named for the fret the index finger sits on, spanning four frets
 * — one finger per fret. Open position is the exception: open strings plus the
 * first four frets.
 */
export function fretRangeLabel(region: FretboardRegion): string {
  const [lo, hi] = region.frets;
  const first = region.includesOpenStrings ? 1 : lo;
  return region.includesOpenStrings
    ? `open strings + frets ${first}–${hi}`
    : `frets ${lo}–${hi}`;
}

export function regionById(id: string): FretboardRegion {
  const found = POSITIONS.find((region) => region.id === id);
  if (!found) throw new Error(`unknown region: ${id}`);
  return found;
}

/** Every distinct pitch reachable in the region — the "pool constraint" (§3). */
export function regionPool(region: FretboardRegion): Midi[] {
  const [lo, hi] = region.frets;
  const pool = new Set<Midi>();
  for (const open of region.tuning) {
    if (region.includesOpenStrings) pool.add(open);
    for (let fret = Math.max(lo, region.includesOpenStrings ? 1 : lo); fret <= hi; fret++) {
      pool.add(open + fret);
    }
  }
  return [...pool].sort((a, b) => a - b);
}
