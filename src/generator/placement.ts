import { maxLocalInterval, placementPitches } from '../idioms';
import type { IdiomPlacement } from '../idioms';
import type { Idiom, Midi, NoteValue } from '../lib/types';

/** Degrees searched when placing an idiom — comfortably beyond any one region. */
const DEGREE_SEARCH = { min: -21, max: 28 };

export interface PlacementConstraints {
  keyCenter: Midi;
  pool: ReadonlySet<Midi>;
  /** Largest permitted leap between consecutive notes, in semitones. */
  maxInterval: number;
}

/**
 * Every degree at which an idiom fits both constraints from spec §3: the pool
 * (which pitches the region can reach at all) and the local movement limit
 * (how far consecutive notes may jump). The two are independent — a wide pool
 * stays readable because the second constraint keeps each idiom compact.
 */
export function validPlacements(
  idiom: Idiom,
  unitValue: NoteValue,
  constraints: PlacementConstraints,
): IdiomPlacement[] {
  const placements: IdiomPlacement[] = [];
  for (let startDegree = DEGREE_SEARCH.min; startDegree <= DEGREE_SEARCH.max; startDegree++) {
    const placement: IdiomPlacement = {
      idiom,
      startDegree,
      keyCenter: constraints.keyCenter,
      unitValue,
    };
    const pitches = placementPitches(placement);
    if (pitches.length === 0) continue;
    if (!pitches.every((midi) => constraints.pool.has(midi))) continue;
    if (maxLocalInterval(placement) > constraints.maxInterval) continue;
    placements.push(placement);
  }
  return placements;
}

/**
 * Weight for a starting pitch, biased towards the extremes of the region.
 *
 * Spec §3: the low E/A and high B/E strings are typically weakest and involve
 * ledger lines, so they deserve more practice than the middle. Weighting the
 * choice rather than widening any single exercise means coverage evens out over
 * many exercises without making one of them hard to read.
 */
export function startPitchWeight(midi: Midi, low: Midi, high: Midi, extremeBias: number): number {
  if (high === low) return 1;
  const centre = (low + high) / 2;
  const normalised = Math.abs(midi - centre) / ((high - low) / 2);
  return 1 + extremeBias * normalised * normalised;
}
