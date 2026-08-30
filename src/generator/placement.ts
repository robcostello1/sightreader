import { instantiateIdiom, maxLocalInterval, placementPitches } from '../idioms';
import type { IdiomPlacement } from '../idioms';
import { isViable, type ViabilityConfig } from '../config/viability';
import { midiToHz } from '../lib/pitch';
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
  /**
   * What the microphone could actually score, given the tempo. Omitted, or
   * disabled, and every placement passes.
   */
  viability?: { config: ViabilityConfig; bpm: number; beatUnit: number };
}

/**
 * Whether every note of this placement is long enough, at its own frequency,
 * to be worth putting on the page.
 *
 * Checked on *sounding* pitch, which is what a placement holds: the generator
 * works in concert pitch throughout and transposition happens only at the page.
 * Gating on the written note would ask whether a frequency nobody produces is
 * detectable.
 *
 * The whole placement stands or falls together. Swapping one note out of a
 * scalar run leaves a phrase that no longer says anything; rejecting the run
 * and picking another idiom is the honest repair.
 */
function viablePlacement(placement: IdiomPlacement, constraints: PlacementConstraints): boolean {
  const check = constraints.viability;
  if (!check || !check.config.enabled) return true;
  return instantiateIdiom(placement).every(
    (note) =>
      note.midi === null ||
      isViable(midiToHz(note.midi), note.value, check.beatUnit, check.bpm, check.config),
  );
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
 * Every degree at which an idiom fits all three constraints: the pool (which
 * pitches the region can reach at all), the local movement limit (how far
 * consecutive notes may jump), and viability (whether the microphone could
 * score the result at this tempo).
 *
 * They are independent of each other — a wide pool stays readable because the
 * movement limit keeps each idiom compact, and viability cuts across both,
 * since it depends on the note value and the tempo as much as the pitch.
 *
 * Being a filter is what gives the fallback its shape. A pitch that fails at
 * this note value simply leaves the list, so the caller's existing choice falls
 * on a different pitch, or on the same idiom at a longer value, or — if nothing
 * survives — on a different idiom altogether. No note is ever patched in place.
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
    if (!viablePlacement(placement, constraints)) continue;
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
