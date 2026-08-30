import { maxLocalInterval, placementPitches } from '../idioms';
import type { IdiomPlacement } from '../idioms';
import type { Idiom, Midi, NoteValue } from '../lib/types';

/**
 * Degrees to search either side of the pool, so an idiom anchored just outside
 * it still gets tried — its events reach up and down from the anchor.
 */
const DEGREE_MARGIN = 7;

/** Scale degrees per octave, for converting a semitone span into a degree span. */
const DEGREES_PER_OCTAVE = 7;

export interface PlacementConstraints {
  keyCenter: Midi;
  pool: ReadonlySet<Midi>;
  /** Lowest and highest pitches in play, used to bound the degree search. */
  low: Midi;
  high: Midi;
  /** Largest permitted leap between consecutive notes, in semitones. */
  maxInterval: number;
}

/**
 * The degrees worth trying, derived from the pool rather than fixed.
 *
 * A constant window silently caps how high an idiom can be placed: anchored on
 * a key centre at the bottom of the pool, a window of 28 degrees reaches four
 * octaves and no further, which is fine for a guitar position and leaves the
 * top three octaves of a piano unreachable.
 */
function degreeSearch(constraints: PlacementConstraints): { min: number; max: number } {
  const degrees = (semitones: number) => (semitones * DEGREES_PER_OCTAVE) / 12;
  return {
    min: Math.floor(degrees(constraints.low - constraints.keyCenter)) - DEGREE_MARGIN,
    max: Math.ceil(degrees(constraints.high - constraints.keyCenter)) + DEGREE_MARGIN,
  };
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
  const search = degreeSearch(constraints);
  for (let startDegree = search.min; startDegree <= search.max; startDegree++) {
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
