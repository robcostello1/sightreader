import { OPEN_POSITION, regionPool, type FretboardRegion } from '../config/regions';
import { levelConfig, type LevelConfig, type TupletRatio } from '../config/levels';
import { IDIOM_LIBRARY, idiomDuration, instantiateIdiom, placementPitches } from '../idioms';
import type { IdiomPlacement } from '../idioms';
import { decompose } from '../lib/duration';
import { keysUpTo, type MusicalKey } from '../lib/key';
import { mulberry32, pick, weightedPick, type Rng } from './rng';
import { startPitchWeight, validPlacements } from './placement';
import type { Exercise, ExerciseNote, Idiom, Midi, NoteValue } from '../lib/types';

/** idiomId carried by rests inserted to fill out a bar; not a library idiom. */
export const PADDING_IDIOM_ID = 'padding';

export interface GenerateOptions {
  /** 1–10, or a pre-built config. */
  level: number | LevelConfig;
  /** Fretboard position. Chosen independently of level — see regions.ts. */
  region?: FretboardRegion;
  /** Force a key; otherwise one is drawn from those the level admits. */
  key?: MusicalKey;
  bpm?: number;
  seed?: number;
  rng?: Rng;
  /** How strongly to favour the extremes of the region. */
  extremeBias?: number;
}

interface Candidate {
  idiom: Idiom;
  unitValue: NoteValue;
  weight: number;
  placements: IdiomPlacement[];
  duration: NoteValue;
}

function barDuration([beatsPerBar, beatUnit]: [number, number]): NoteValue {
  return beatsPerBar / beatUnit;
}

/**
 * Places the tonic at or below the region's lowest pitch, so scale degrees
 * ascend into the pool rather than starting above it.
 */
function keyCentreFor(key: MusicalKey, low: Midi): Midi {
  const candidate = Math.floor(low / 12) * 12 + key.tonic;
  return candidate <= low ? candidate : candidate - 12;
}

function buildCandidates(
  idioms: readonly Idiom[],
  config: LevelConfig,
  constraints: Parameters<typeof validPlacements>[2],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const idiom of idioms) {
    for (const { value, weight } of config.noteValues) {
      const placements = validPlacements(idiom, value, constraints);
      if (placements.length > 0) {
        candidates.push({
          idiom,
          unitValue: value,
          weight,
          placements,
          duration: idiomDuration(idiom, value),
        });
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
  return weightedPick(rng, candidate.placements, (placement) =>
    startPitchWeight(placementPitches(placement)[0], low, high, extremeBias),
  );
}

export function generateExercise(options: GenerateOptions): Exercise {
  const config = typeof options.level === 'number' ? levelConfig(options.level) : options.level;
  const { region = OPEN_POSITION, bpm = 60, extremeBias = 3 } = options;
  const rng = options.rng ?? mulberry32(options.seed ?? 1);

  const poolList = regionPool(region);
  const pool = new Set(poolList);
  const low = poolList[0];
  const high = poolList[poolList.length - 1];

  const key = options.key ?? pick(rng, keysUpTo(config.maxKeyAccidentals));
  const keyCenter = keyCentreFor(key, low);
  const constraints = { keyCenter, pool, maxInterval: config.maxLocalInterval };

  const eligible = IDIOM_LIBRARY.filter((idiom) => config.categories.includes(idiom.category));
  const phrase = eligible.filter((idiom) => idiom.category !== 'cadential');
  const cadential = eligible.filter((idiom) => idiom.category === 'cadential');

  const barSize = barDuration(config.timeSignature);
  const target = config.targetBars * barSize;

  // Reserve the cadence up front so the phrase cannot fill the bar and leave no
  // room to land, which is the whole point of having one.
  let cadence: { placement: IdiomPlacement; duration: NoteValue } | null = null;
  if (config.endOnCadence && cadential.length > 0) {
    const candidates = buildCandidates(cadential, config, constraints)
      // Cadential idioms resolve to their anchor degree, so only a tonic anchor
      // actually lands the phrase on the tonic.
      .map((c) => ({ ...c, placements: c.placements.filter((p) => p.startDegree % 7 === 0) }))
      // At most half the exercise, so there is room for a phrase to lead into it.
      .filter((c) => c.placements.length > 0 && c.duration <= target / 2);
    if (candidates.length > 0) {
      const candidate = weightedPick(rng, candidates, (c) => c.weight);
      cadence = {
        placement: choosePlacement(rng, candidate, low, high, extremeBias),
        duration: candidate.duration,
      };
    }
  }

  const budget = Math.max(0, target - (cadence?.duration ?? 0));
  const notes: ExerciseNote[] = [];
  const phraseCandidates = buildCandidates(phrase, config, constraints);

  let used = 0;
  let instance = 0;
  let previous: { candidate: Candidate; placement: IdiomPlacement } | null = null;

  while (used === 0 || budget - used > 1e-9) {
    const remaining = budget - used;
    const fitting = phraseCandidates.filter((candidate) => candidate.duration <= remaining);
    // The first idiom always goes in. If none fits the budget, take the
    // shortest available and let the bar count round up rather than emit
    // nothing — an exercise is made of whole shapes.
    const fits =
      fitting.length > 0
        ? fitting
        : used === 0
          ? shortestOf(phraseCandidates)
          : [];
    if (fits.length === 0) break;

    // A sequence repeats the previous shape at a new degree. It is the clearest
    // way transposition shows up in reading, and it rewards recognising the
    // pattern rather than re-decoding it.
    const sequenced: { candidate: Candidate; placement: IdiomPlacement } | null =
      previous && rng() < config.sequenceChance
        ? sequenceOf(rng, previous, fits, remaining)
        : null;

    const candidate: Candidate = sequenced?.candidate ?? weightedPick(rng, fits, (c) => c.weight);
    const placement: IdiomPlacement =
      sequenced?.placement ?? choosePlacement(rng, candidate, low, high, extremeBias);

    const rendered = instantiateIdiom(placement, instance);
    let duration = candidate.duration;

    if (config.tupletRatios.length > 0 && rng() < config.tupletChance) {
      const ratio = pick(rng, config.tupletRatios);
      // A tuplet of `num` notes takes the space of `inSpaceOf`, so the instance
      // loses the difference. Scaling a whole idiom instead would yield
      // durations no combination of symbols can draw.
      if (applyTuplet(rng, rendered, candidate, instance, ratio)) {
        duration -= (ratio.num - ratio.inSpaceOf) * candidate.unitValue;
      }
    }

    notes.push(...rendered);
    used += duration;
    previous = { candidate, placement };
    instance++;

  }

  // Round up to the next bar line — and no further. Forcing the total up to
  // targetBars would inflate the final note to fill the gap, which is dead time:
  // a bar spent holding one note asks nothing of the reader. targetBars governs
  // how many idioms are packed in, not how long the result is padded to.
  if (notes.length > 0) {
    const sounded = used + (cadence?.duration ?? 0);
    const shortfall = Math.ceil(sounded / barSize - 1e-9) * barSize - sounded;
    if (shortfall > 1e-9) padTo(notes, shortfall, instance, barSize, cadence !== null);
  }

  if (cadence) notes.push(...instantiateIdiom(cadence.placement, instance + 1));

  applyDecorations(rng, notes, config, pool);

  // An empty exercise is always a bug — a constraint combination with no valid
  // placement. Failing loudly here beats silently rendering a blank stave.
  if (notes.length === 0) {
    throw new Error(
      `generator produced no notes (level ${config.level}, region ${region.id}, ` +
        `key ${key.name}, seed ${options.seed ?? 'n/a'})`,
    );
  }

  return { notes, keyCenter, key, timeSignature: config.timeSignature, bpm };
}

/**
 * Finds the previous idiom placed a step or two away, if the pool allows it.
 * Returns null when no transposed placement fits, in which case the caller just
 * picks a fresh idiom.
 */
function sequenceOf(
  rng: Rng,
  previous: { candidate: Candidate; placement: IdiomPlacement },
  fits: readonly Candidate[],
  remaining: NoteValue,
): { candidate: Candidate; placement: IdiomPlacement } | null {
  const candidate = fits.find(
    (c) => c.idiom.id === previous.candidate.idiom.id && c.unitValue === previous.candidate.unitValue,
  );
  if (!candidate || candidate.duration > remaining) return null;

  const shifted = candidate.placements.filter((placement) => {
    const step = Math.abs(placement.startDegree - previous.placement.startDegree);
    return step >= 1 && step <= 3;
  });
  if (shifted.length === 0) return null;

  return { candidate, placement: pick(rng, shifted) };
}

/**
 * Sprinkles the level's permitted deviations. Both only ever touch interior
 * notes: opening on a rest gives the player nothing to start from, and altering
 * the final note undermines the cadence's landing.
 */
function applyDecorations(
  rng: Rng,
  notes: ExerciseNote[],
  config: LevelConfig,
  pool: ReadonlySet<Midi>,
): void {
  const interior = notes.length - 2;
  if (interior <= 0) return;

  if (config.accidentalChance > 0 && rng() < config.accidentalChance) {
    const index = 1 + Math.floor(rng() * interior);
    const note = notes[index];
    if (note.midi !== null) {
      const altered = note.midi + (rng() < 0.5 ? 1 : -1);
      // Chromatic passing tones are still bound by the region's reach.
      if (pool.has(altered)) note.midi = altered;
    }
  }

  if (config.restChance > 0 && rng() < config.restChance) {
    const index = 1 + Math.floor(rng() * interior);
    notes[index] = { ...notes[index], midi: null };
  }
}

/** The shortest candidates, for when nothing fits the remaining budget. */
function shortestOf(candidates: readonly Candidate[]): Candidate[] {
  if (candidates.length === 0) return [];
  const shortest = Math.min(...candidates.map((c) => c.duration));
  return candidates.filter((c) => c.duration <= shortest + 1e-9);
}

/**
 * Takes up leftover space to the bar line.
 *
 * Extends the last note where that keeps it inside a bar, so the phrase ends on
 * something held. Beyond a bar it becomes dead time — six seconds of holding one
 * note at 60bpm asks nothing of the reader — so the space becomes a rest
 * instead, which reads as a breath before the cadence.
 *
 * Two cases block extension outright: a tuplet member, where lengthening one
 * note breaks its ratio against the rest of the group; and having no cadence to
 * follow, where a trailing rest would end the exercise on silence.
 */
function padTo(
  notes: ExerciseNote[],
  shortfall: NoteValue,
  instance: number,
  barSize: NoteValue,
  cadenceFollows: boolean,
): void {
  const last = notes[notes.length - 1];
  const extendable = last && !last.tuplet;

  if (extendable && (last.value + shortfall <= barSize + 1e-9 || !cadenceFollows)) {
    last.value += shortfall;
    return;
  }
  for (const value of decompose(shortfall)) {
    notes.push({ midi: null, value, idiomId: PADDING_IDIOM_ID, instance });
  }
}

/**
 * Turns a run of consecutive single-beat notes into a tuplet. Returns false when
 * the idiom has no run long enough, since scaling uneven beats would produce
 * durations that cannot be drawn.
 */
function applyTuplet(
  rng: Rng,
  rendered: ExerciseNote[],
  candidate: Candidate,
  group: number,
  ratio: TupletRatio,
): boolean {
  const events = candidate.idiom.events;
  const starts: number[] = [];
  for (let i = 0; i + ratio.num - 1 < events.length; i++) {
    if (events.slice(i, i + ratio.num).every((event) => event.beats === 1)) starts.push(i);
  }
  if (starts.length === 0) return false;

  const start = pick(rng, starts);
  for (let i = start; i < start + ratio.num; i++) {
    rendered[i].value = (rendered[i].value * ratio.inSpaceOf) / ratio.num;
    rendered[i].tuplet = { group, num: ratio.num, inSpaceOf: ratio.inSpaceOf };
  }
  return true;
}
