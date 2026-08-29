import { OPEN_POSITION, regionPool, type FretboardRegion } from '../config/regions';
import { IDIOM_LIBRARY, idiomDuration, instantiateIdiom, placementPitches } from '../idioms';
import type { IdiomPlacement } from '../idioms';
import { NOTE_VALUES } from '../lib/types';
import { decompose } from '../lib/duration';
import { mulberry32, pick, randomInt, weightedPick, type Rng } from './rng';
import { startPitchWeight, validPlacements } from './placement';
import type { TierConfig } from '../config/tiers';
import type { Exercise, ExerciseNote, Idiom, Midi, NoteValue } from '../lib/types';

/** idiomId carried by rests inserted to fill out a bar; not a library idiom. */
export const PADDING_IDIOM_ID = 'padding';

export interface GenerateOptions {
  tier: TierConfig;
  region?: FretboardRegion;
  /** MIDI of the tonic. Default is C4; spec §2 starts everything in C major. */
  keyCenter?: Midi;
  bpm?: number;
  /** Seed for reproducible generation, or pass `rng` directly. */
  seed?: number;
  rng?: Rng;
  /** How strongly to favour the extremes of the region. */
  extremeBias?: number;
  /** Chance of one interior note becoming a rest, when the tier allows rests. */
  restChance?: number;
  /** Chance of one interior note taking an accidental, when the tier allows it. */
  accidentalChance?: number;
  /** Chance an idiom instance is rendered as triplets, when the tier allows them. */
  tripletChance?: number;
}

interface Candidate {
  idiom: Idiom;
  unitValue: NoteValue;
  placements: IdiomPlacement[];
  duration: NoteValue;
}

/** Whole-note units in one bar of the given time signature. */
function barDuration([beatsPerBar, beatUnit]: [number, number]): NoteValue {
  return beatsPerBar / beatUnit;
}

function buildCandidates(
  idioms: readonly Idiom[],
  unitValues: readonly NoteValue[],
  constraints: Parameters<typeof validPlacements>[2],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const idiom of idioms) {
    for (const unitValue of unitValues) {
      const placements = validPlacements(idiom, unitValue, constraints);
      if (placements.length > 0) {
        candidates.push({ idiom, unitValue, placements, duration: idiomDuration(idiom, unitValue) });
      }
    }
  }
  return candidates;
}

function choosePlacement(
  rng: Rng,
  candidate: Candidate,
  low: Midi,
  high: Midi,
  extremeBias: number,
): IdiomPlacement {
  // Weighted on the starting pitch, per spec §3.
  return weightedPick(rng, candidate.placements, (placement) =>
    startPitchWeight(placementPitches(placement)[0], low, high, extremeBias),
  );
}

export function generateExercise(options: GenerateOptions): Exercise {
  const {
    tier,
    region = OPEN_POSITION,
    keyCenter = 60,
    bpm = 60,
    extremeBias = 3,
    restChance = 0.3,
    accidentalChance = 0.25,
    tripletChance = 0.2,
  } = options;
  const rng = options.rng ?? mulberry32(options.seed ?? 1);

  const poolList = regionPool(region);
  const pool = new Set(poolList);
  const low = poolList[0];
  const high = poolList[poolList.length - 1];
  const constraints = { keyCenter, pool, maxInterval: tier.idioms.maxLocalInterval };

  const unitValues = tier.density.allowedValues.map((name) => NOTE_VALUES[name]);
  const eligible = IDIOM_LIBRARY.filter((idiom) => tier.idioms.categories.includes(idiom.category));
  const phrase = eligible.filter((idiom) => idiom.category !== 'cadential');
  const cadential = eligible.filter((idiom) => idiom.category === 'cadential');

  const target = tier.targetBars === null ? null : tier.targetBars * barDuration(tier.timeSignature);

  // Reserve the cadence up front so the phrase cannot fill the bar and leave no
  // room to land, which is the whole point of having one.
  let cadence: { placement: IdiomPlacement; duration: NoteValue } | null = null;
  if (tier.idioms.endOnCadence && cadential.length > 0) {
    const candidates = buildCandidates(cadential, unitValues, constraints)
      // Cadential idioms resolve to their anchor degree, so only a tonic anchor
      // actually lands the phrase on the tonic.
      .map((c) => ({ ...c, placements: c.placements.filter((p) => p.startDegree % 7 === 0) }))
      .filter((c) => c.placements.length > 0 && (target === null || c.duration <= target));
    if (candidates.length > 0) {
      const candidate = pick(rng, candidates);
      cadence = {
        placement: choosePlacement(rng, candidate, low, high, extremeBias),
        duration: candidate.duration,
      };
    }
  }

  const budget = target === null ? null : target - (cadence?.duration ?? 0);
  const notes: ExerciseNote[] = [];
  const usedIdioms = new Set<string>();
  let used = 0;

  const instances = randomInt(rng, ...tier.idioms.instances);
  const phraseCandidates = buildCandidates(phrase, unitValues, constraints);

  for (let i = 0; i < instances; i++) {
    const remaining = budget === null ? Number.POSITIVE_INFINITY : budget - used;
    const fits = phraseCandidates.filter((candidate) => {
      if (candidate.duration > remaining) return false;
      // Without transposition, an idiom may only appear once per exercise.
      if (!tier.idioms.allowTransposition && usedIdioms.has(candidate.idiom.id)) return false;
      return true;
    });
    if (fits.length === 0) break;

    const candidate = pick(rng, fits);
    const placement = choosePlacement(rng, candidate, low, high, extremeBias);
    usedIdioms.add(candidate.idiom.id);

    const rendered = instantiateIdiom(placement, i);
    let duration = candidate.duration;

    if (tier.density.allowTriplets && rng() < tripletChance) {
      const applied = applyTriplet(rng, rendered, candidate, i);
      // Three single-beat notes become the space of two, so the instance loses
      // exactly one unit. Scaling the whole idiom instead would yield durations
      // like 8/3, which no combination of symbols can notate.
      if (applied) duration -= candidate.unitValue;
    }

    notes.push(...rendered);
    used += duration;

    // A single-idiom tier stops after one instance regardless of budget.
    if (budget === null) break;
  }

  // Padded before the cadence, not after: leftover space becomes a breath
  // rather than a trailing rest, and the phrase still lands on the tonic.
  if (budget !== null && budget - used > 1e-9) {
    padWithRests(notes, budget - used, tier.density.allowRests, instances);
  }

  if (cadence) notes.push(...instantiateIdiom(cadence.placement, instances + 1));

  applyDecorations(rng, notes, {
    pool,
    allowRests: tier.density.allowRests,
    allowAccidentals: tier.idioms.allowAccidentals,
    restChance,
    accidentalChance,
  });

  return { notes, keyCenter, timeSignature: tier.timeSignature, bpm };
}

interface DecorationOptions {
  pool: ReadonlySet<Midi>;
  allowRests: boolean;
  allowAccidentals: boolean;
  restChance: number;
  accidentalChance: number;
}

/**
 * Sprinkles the tier's permitted deviations. Both only ever touch interior
 * notes: opening on a rest gives the player nothing to start from, and altering
 * the final note undermines the cadence's landing.
 */
function applyDecorations(rng: Rng, notes: ExerciseNote[], options: DecorationOptions): void {
  const interior = notes.length - 2;
  if (interior <= 0) return;

  if (options.allowAccidentals && rng() < options.accidentalChance) {
    const index = 1 + Math.floor(rng() * interior);
    const note = notes[index];
    if (note.midi !== null) {
      const direction = rng() < 0.5 ? 1 : -1;
      const altered = note.midi + direction;
      // Chromatic passing tones are still bound by the region's reach.
      if (options.pool.has(altered)) note.midi = altered;
    }
  }

  if (options.allowRests && rng() < options.restChance) {
    const index = 1 + Math.floor(rng() * interior);
    notes[index] = { ...notes[index], midi: null };
  }
}

/**
 * Fills leftover space with rests decomposed into drawable values. Extending the
 * final note instead would leave it at some arbitrary length — 5/16 of a whole
 * note, say — that no combination of symbols represents.
 */
function padWithRests(
  notes: ExerciseNote[],
  shortfall: NoteValue,
  allowRests: boolean,
  instance: number,
): void {
  const parts = decompose(shortfall);
  if (allowRests) {
    for (const value of parts) {
      notes.push({ midi: null, value, idiomId: PADDING_IDIOM_ID, instance });
    }
    return;
  }
  // No rests permitted: lengthen the last note, but only by amounts that stay
  // notatable on their own.
  if (notes.length > 0) notes[notes.length - 1].value += parts[0] ?? 0;
}

/**
 * Turns three consecutive single-beat notes into a triplet. Returns false when
 * the idiom has no such run, since scaling uneven beats would produce durations
 * that cannot be drawn.
 */
function applyTriplet(
  rng: Rng,
  rendered: ExerciseNote[],
  candidate: Candidate,
  instance: number,
): boolean {
  const events = candidate.idiom.events;
  const starts: number[] = [];
  for (let i = 0; i + 2 < events.length; i++) {
    if (events[i].beats === 1 && events[i + 1].beats === 1 && events[i + 2].beats === 1) {
      starts.push(i);
    }
  }
  if (starts.length === 0) return false;

  const start = pick(rng, starts);
  for (let i = start; i < start + 3; i++) {
    rendered[i].value = (rendered[i].value * 2) / 3;
    rendered[i].tuplet = { group: instance, num: 3, inSpaceOf: 2 };
  }
  return true;
}
