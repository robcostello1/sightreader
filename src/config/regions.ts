import type { Midi } from '../lib/types';

/**
 * Fretboard region model (§3). v1 ships open position only, but the shape here
 * anticipates higher positions as separate progression tracks.
 */
export interface FretboardRegion {
  id: string;
  name: string;
  /** Open-string pitches, low to high. Standard tuning by default. */
  tuning: Midi[];
  /** Inclusive fret span reachable without shifting position. */
  frets: [number, number];
}

export const STANDARD_TUNING: Midi[] = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

export const OPEN_POSITION: FretboardRegion = {
  id: 'open-position',
  name: 'Open position, all six strings',
  tuning: STANDARD_TUNING,
  frets: [0, 4],
};

/** Future regions (5th position and up) plug in here; not unlocked in v1. */
export const REGIONS: FretboardRegion[] = [OPEN_POSITION];

/** Every distinct pitch reachable in the region — the "pool constraint" (§3). */
export function regionPool(region: FretboardRegion): Midi[] {
  const [lo, hi] = region.frets;
  const pool = new Set<Midi>();
  for (const open of region.tuning) {
    for (let fret = lo; fret <= hi; fret++) pool.add(open + fret);
  }
  return [...pool].sort((a, b) => a - b);
}
