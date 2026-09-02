import { instantiateIdiom, maxLocalInterval, placementPitches } from '../idioms';
import type { IdiomPlacement } from '../idioms';
import { isViable, type ViabilityConfig } from '../config/viability';
import type { ScoringConfig } from '../config/levels';
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
  viability?: {
    config: ViabilityConfig;
    /** The scorer's own frame rule, applied per note rather than as a tempo cap. */
    scoring: ScoringConfig;
    bpm: number;
    beatUnit: number;
  };
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
      isViable(
        midiToHz(note.midi),
        note.value,
        check.beatUnit,
        check.bpm,
        check.config,
        check.scoring,
      ),
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
 * Weight for a starting pitch, according to how far it sits from the centre of
 * the range.
 *
 * `rangeBias` is what an extreme of the range is worth against its centre: 1
 * weights every pitch alike, above 1 leans towards the edges, below 1 towards
 * the middle. It is reciprocal-symmetric, so 4 and 0.25 are mirror shapes of
 * the same strength. The exponent is the *square* of the distance from centre,
 * which keeps the lean gentle through the middle and lets it reach full
 * strength only at the ends.
 *
 * It defaults to 1 because a lean applied open-loop does not do what spec §3
 * asks of it. The spec wants weighting so that coverage evens out over many
 * exercises; measuring the generator showed the distribution was already
 * extremity-heavy before any weighting, from the shape of the idiom library and
 * from the holes a fretted position leaves in its pool, so leaning further that
 * way took guitar 5th position to twelve times as many notes at the edges of
 * the range as in the middle of it. See docs/note-distribution.md.
 */
export function startPitchWeight(midi: Midi, low: Midi, high: Midi, rangeBias: number): number {
  if (!(rangeBias > 0)) {
    // Zero used to mean "no bias" under the old additive parameter, where it
    // was the neutral value. Here it would collapse the choice onto the exact
    // centre of the range, so it is worth catching rather than obeying.
    throw new RangeError(`rangeBias must be positive (1 is even), received ${rangeBias}`);
  }
  if (high === low || rangeBias === 1) return 1;
  const centre = (low + high) / 2;
  const normalised = Math.abs(midi - centre) / ((high - low) / 2);
  return rangeBias ** (normalised * normalised);
}
