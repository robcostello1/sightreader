import { OPEN_POSITION, regionPool } from '../config/regions';
import { levelConfig, type LevelConfig } from '../config/levels';
import { DEFAULT_VIABILITY, isViable, type ViabilityConfig } from '../config/viability';
import { IDIOM_LIBRARY, idiomDuration, instantiateIdiom, placementPitches } from '../idioms';
import type { IdiomPlacement } from '../idioms';
import { decompose } from '../lib/duration';
import { keysUpTo, type MusicalKey } from '../lib/key';
import { midiToHz } from '../lib/pitch';
import { mulberry32, pick, weightedPick, type Rng } from './rng';
import { startPitchWeight, validPlacements } from './placement';
import type { Exercise, ExerciseNote, Idiom, IdiomCategory, Midi, NoteValue } from '../lib/types';

/** idiomId carried by rests inserted to fill out a bar; not a library idiom. */
export const PADDING_IDIOM_ID = 'padding';

export interface GenerateOptions {
  /** 1–10, or a pre-built config. */
  level: number | LevelConfig;
  /**
   * Every sounding pitch the player can produce. Sounding, not written: the
   * generator, the scorer and the microphone all work in concert pitch, and
   * transposition is applied only when the notes reach the page.
   */
  pool?: readonly Midi[];
  /** Force a key; otherwise one is drawn from those the level admits. */
  key?: MusicalKey;
  bpm?: number;
  seed?: number;
  rng?: Rng;
  /** How strongly to favour the extremes of the region. */
  extremeBias?: number;
  /**
   * Keeps notes the microphone could not score off the page. Off by default
   * until the pitch-detection spike calibrates it.
   */
  viability?: ViabilityConfig;
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
 * The widest span one exercise may range over, in semitones.
 *
 * Matched to the guitar's open position, the widest region the app already
 * treated as one readable unit — so a fretted position is unaffected and a
 * five-octave keyboard range is not read as an invitation to leap across it.
 */
const MAX_EXERCISE_SPAN = 28;

/**
 * Narrows a wide pool to the register this exercise lives in.
 *
 * Idioms are compact by construction, but nothing constrains the gap between
 * one and the next, so a pool spanning a whole piano produces a line that
 * lurches between octaves. Drawing a window per exercise keeps each one
 * readable while coverage still spreads over the full range across a session.
 */
function registerWindow(pool: readonly Midi[], rng: Rng): readonly Midi[] {
  const low = pool[0];
  const high = pool[pool.length - 1];
  if (high - low <= MAX_EXERCISE_SPAN) return pool;
  const start = low + Math.floor(rng() * (high - low - MAX_EXERCISE_SPAN + 1));
  return pool.filter((midi) => midi >= start && midi <= start + MAX_EXERCISE_SPAN);
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
  noteValues: readonly { value: NoteValue; weight: number }[],
  constraints: Parameters<typeof validPlacements>[2],
  barSize: NoteValue,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const idiom of idioms) {
    const longestEvent = Math.max(...idiom.events.map((event) => event.beats));
    for (const { value, weight } of noteValues) {
      // No single note may outlast a bar. In 3/4 and 6/8 a bar is three
      // quarters of a whole note, so a two-beat event at minim density would
      // tie across the bar line — dead time, and the reason this rule exists.
      if (longestEvent * value > barSize + 1e-9) continue;
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
  const { bpm = 60, extremeBias = 3, viability = DEFAULT_VIABILITY } = options;
  const rng = options.rng ?? mulberry32(options.seed ?? 1);

  const poolList = registerWindow(options.pool ?? regionPool(OPEN_POSITION), rng);
  const pool = new Set(poolList);
  const low = poolList[0];
  const high = poolList[poolList.length - 1];

  // The fractional part is the chance of admitting one more accidental than the
  // whole part, so a new key signature turns up occasionally before always.
  const keyTier = Math.floor(config.maxKeyAccidentals);
  const accidentals = rng() < config.maxKeyAccidentals - keyTier ? keyTier + 1 : keyTier;
  const key = options.key ?? pick(rng, keysUpTo(accidentals));
  const keyCenter = keyCentreFor(key, low);
  const baseConstraints = { keyCenter, pool, low, high, maxInterval: config.maxLocalInterval };

  // Categories are rolled per exercise, so a newly introduced one shows up in
  // some exercises before all of them.
  const categories = (Object.keys(config.categoryChance) as IdiomCategory[]).filter(
    (category) => rng() < config.categoryChance[category] + 1e-9,
  );
  // Note values are admitted per exercise too, for the same reason as
  // categories: a value that is still arriving should be absent from most
  // exercises, not merely unlikely within them.
  const noteValues = config.noteValues.filter((entry) => rng() < entry.chance + 1e-9);

  const eligible = IDIOM_LIBRARY.filter((idiom) => categories.includes(idiom.category));
  const phrase = eligible.filter((idiom) => idiom.category !== 'cadential');
  const cadential = eligible.filter((idiom) => idiom.category === 'cadential');

  // One signature per exercise, weighted, so a new one arrives gradually.
  let timeSignature = weightedPick(rng, config.timeSignatures, (entry) => entry.weight).value;
  let barSize = barDuration(timeSignature);

  // Viability is measured in beats, so it cannot be settled until the beat unit
  // is known: the same quaver lasts twice as long in 6/8 as in 4/4.
  const withViability = (signature: [number, number]) => ({
    ...baseConstraints,
    viability: { config: viability, bpm, beatUnit: signature[1] },
  });
  let constraints = withViability(timeSignature);

  let phraseCandidates = buildCandidates(phrase, noteValues, constraints, barSize);
  // A shorter bar can rule out every idiom when the exercise happens to admit
  // only long note values. Common time always leaves a candidate, so fall back
  // to it rather than emit nothing.
  if (phraseCandidates.length === 0 && barSize !== barDuration([4, 4])) {
    timeSignature = [4, 4];
    barSize = barDuration(timeSignature);
    constraints = withViability(timeSignature);
    phraseCandidates = buildCandidates(phrase, noteValues, constraints, barSize);
  }

  const target = config.targetBars * barSize;

  // Reserve the cadence up front so the phrase cannot fill the bar and leave no
  // room to land, which is the whole point of having one.
  let cadence: { placement: IdiomPlacement; duration: NoteValue } | null = null;
  if (cadential.length > 0 && rng() < config.cadenceChance) {
    const candidates = buildCandidates(cadential, noteValues, constraints, barSize)
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

    // A sequence repeats the previous shape on a new scale degree. It rewards
    // recognising the pattern rather than re-decoding it, which is exactly the
    // chunking the whole design is built around.
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
      // Weighted, so quintuplets stay rare while they are being introduced.
      const ratio = weightedPick(rng, config.tupletRatios, (r) => r.weight);
      // A tuplet of `num` notes takes the space of `inSpaceOf`, so the instance
      // loses the difference. Scaling a whole idiom instead would yield
      // durations no combination of symbols can draw.
      if (
        applyTuplet(rng, rendered, candidate, instance, ratio, used, barSize, {
          config: viability,
          bpm,
          beatUnit: timeSignature[1],
        })
      ) {
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
      `generator produced no notes (level ${config.level}, pool ${poolList.length} pitches ` +
        `${poolList[0]}-${poolList[poolList.length - 1]}, key ${key.name}, ` +
        `seed ${options.seed ?? 'n/a'})`,
    );
  }

  return { notes, keyCenter, key, timeSignature, bpm };
}

/**
 * Repeats the previous idiom a step or two up or down the scale — a *diatonic*
 * sequence, sometimes called tonal.
 *
 * The shape is preserved in scale degrees, not in semitones, so the intervals
 * change to fit the key: a neighbour figure of F–G–F becomes B–C–B, a tone
 * becoming a semitone. That is the point of it. A real sequence would keep the
 * intervals exact and leave the key, and a modulating one would change key
 * outright; neither happens here, and neither is what a reader at this level
 * should be meeting.
 *
 * Returns null when no such placement fits the pool, in which case the caller
 * just picks a fresh idiom.
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
    // Never inside a tuplet: it breaks the group's beam and reads as a puzzle
    // rather than as the rhythm the tuplet is there to teach.
    if (notes[index].tuplet === undefined) {
      notes[index] = { ...notes[index], midi: null };
    }
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
  const extendable = last !== undefined && last.tuplet === undefined;
  const headroom = extendable ? Math.max(0, barSize - last.value) : 0;

  let remaining = shortfall;
  if (extendable && headroom > 1e-9) {
    const taken = Math.min(remaining, headroom);
    last.value += taken;
    remaining -= taken;
  }
  if (remaining <= 1e-9) return;

  const rests = decompose(remaining).map((value) => ({
    midi: null,
    value,
    idiomId: PADDING_IDIOM_ID,
    instance,
  }));

  if (cadenceFollows) {
    // padTo runs before the cadence is appended, so these land ahead of it.
    notes.push(...rests);
    return;
  }

  // Nothing follows, so a trailing rest would end the exercise on silence. Put
  // the breath before the closing note instead — and before its whole tuplet
  // group, since splitting one would break the bracket.
  let insertAt = notes.length - 1;
  const group = notes[insertAt]?.tuplet?.group;
  if (group !== undefined) {
    while (insertAt > 0 && notes[insertAt - 1].tuplet?.group === group) insertAt--;
  }
  notes.splice(insertAt, 0, ...rests);
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
  ratio: { num: number; inSpaceOf: number },
  offset: NoteValue,
  barSize: NoteValue,
  viability: { config: ViabilityConfig; bpm: number; beatUnit: number },
): boolean {
  const events = candidate.idiom.events;
  const span = ratio.inSpaceOf * candidate.unitValue;

  // Running position of each event, so a group can be tested against bar lines.
  const positions: NoteValue[] = [];
  let at = offset;
  for (const note of rendered) {
    positions.push(at);
    at += note.value;
  }

  const starts: number[] = [];
  for (let i = 0; i + ratio.num - 1 < events.length; i++) {
    if (!events.slice(i, i + ratio.num).every((event) => event.beats === 1)) continue;
    const start = positions[i];

    // The whole group must sit within one bar. Split across a bar line, neither
    // bar holds all of it, so the bracket cannot be drawn over the group.
    const sameBar =
      Math.floor(start / barSize + 1e-9) === Math.floor((start + span - 1e-9) / barSize);
    if (!sameBar) continue;

    // And it must begin where the beats it replaces begin. A triplet occupying
    // a crotchet belongs on a crotchet; starting it half a beat late is
    // readable only as a puzzle, and is not how anyone writes one.
    const withinBar = start % barSize;
    const onBeat = Math.abs(withinBar / span - Math.round(withinBar / span)) < 1e-9;
    if (!onBeat) continue;

    // A tuplet squeezes its notes shorter than the value they are drawn at, so
    // a group that was viable as plain quavers need not be as triplet quavers.
    // Checked here rather than at placement, since the group is chosen later.
    const scaled = (candidate.unitValue * ratio.inSpaceOf) / ratio.num;
    const viable = rendered
      .slice(i, i + ratio.num)
      .every(
        (note) =>
          note.midi === null ||
          isViable(midiToHz(note.midi), scaled, viability.beatUnit, viability.bpm, viability.config),
      );
    if (viable) starts.push(i);
  }
  if (starts.length === 0) return false;

  const start = pick(rng, starts);
  for (let i = start; i < start + ratio.num; i++) {
    rendered[i].value = (rendered[i].value * ratio.inSpaceOf) / ratio.num;
    rendered[i].tuplet = { group, num: ratio.num, inSpaceOf: ratio.inSpaceOf };
  }
  return true;
}
