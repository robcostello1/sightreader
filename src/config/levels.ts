import { NOTE_VALUES, type IdiomCategory, type NoteValue, type NoteValueName } from '../lib/types';

export const MAX_LEVEL = 10;

export interface ScoringConfig {
  /** Occupancy fraction required to pass a note window (spec §6.5). */
  passThreshold: number;
  /** Attack-transient guard skipped at the head of each window, in ms (§6.2). */
  attackGuardMs: number;
  /** Below this, a window is too short to judge and scores 'unscorable' (§6). */
  minSamples: number;
  /** Pitch-detector confidence gate; below this a sample is excluded, not wrong (§5). */
  confidenceGate: number;
  /** Half-width of the pitch match window, in cents. */
  toleranceCents: number;
  /** v1 recommendation: do not penalise a note ringing through a rest (§6). */
  penaliseSustainThroughRest: boolean;
}

export const DEFAULT_SCORING: ScoringConfig = {
  passThreshold: 0.65,
  attackGuardMs: 40,
  minSamples: 4,
  confidenceGate: 0.8,
  toleranceCents: 50,
  penaliseSustainThroughRest: false,
};

export interface TupletRatio {
  num: number;
  inSpaceOf: number;
}

export interface WeightedNoteValue {
  name: NoteValueName;
  value: NoteValue;
  /** Relative likelihood of being chosen. Zero means not yet introduced. */
  weight: number;
}

export interface LevelConfig {
  level: number;
  noteValues: WeightedNoteValue[];
  restChance: number;
  tupletChance: number;
  tupletRatios: TupletRatio[];
  /** Largest permitted leap between consecutive notes within an idiom, in semitones. */
  maxLocalInterval: number;
  /** Chance an idiom repeats transposed rather than a new idiom being chosen. */
  sequenceChance: number;
  accidentalChance: number;
  /** Keys are admitted by how many accidentals their signature carries. */
  maxKeyAccidentals: number;
  categories: IdiomCategory[];
  /**
   * Bars to fill: two early, four from the middle up. Kept short deliberately —
   * what should grow with level is how many notes fit in a bar, not how long you
   * wait to find out whether you read it correctly.
   */
  targetBars: number;
  timeSignature: [number, number];
  countInBars: number;
  clickThroughExercise: boolean;
  endOnCadence: boolean;
  scoring: ScoringConfig;
}

/** 0 below `from`, 1 at or above `to`, linear between. */
function ramp(level: number, from: number, to: number): number {
  if (level <= from) return 0;
  if (level >= to) return 1;
  return (level - from) / (to - from);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * When each note value first appears, and how its likelihood moves from there.
 *
 * Both halves of "shorter notes get more likely and more available" live here:
 * a value contributes nothing before its level, then grows, while the long
 * values decay so they do not keep dominating the mix.
 */
const VALUE_RAMPS: { name: NoteValueName; from: number; atIntro: number; atMax: number }[] = [
  // The crotchet-and-longer end. Breve is deliberately absent as a *unit*: it
  // arises naturally from a two-beat idiom event, and using it as the unit would
  // make one note four bars long. Half is the base unit even at level 1, since a
  // four-event idiom of whole notes is four bars before anything else is added —
  // too long a wait for a beginner to find out whether they read it right.
  { name: 'whole', from: 1, atIntro: 0.5, atMax: 0.05 },
  { name: 'half', from: 1, atIntro: 1, atMax: 0.4 },
  { name: 'quarter', from: 3, atIntro: 0.3, atMax: 1 },
  { name: 'eighth', from: 5, atIntro: 0.2, atMax: 0.9 },
  { name: 'sixteenth', from: 8, atIntro: 0.15, atMax: 0.5 },
];

export function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(1, Math.round(level)));
}

/**
 * Everything that varies with difficulty, interpolated rather than stepped, so
 * no single level is a cliff. Fretboard position is deliberately absent: it is
 * chosen separately, because moving up the neck changes what you are practising
 * rather than how hard it is.
 */
export function levelConfig(rawLevel: number): LevelConfig {
  const level = clampLevel(rawLevel);
  const t = ramp(level, 1, MAX_LEVEL);

  const noteValues = VALUE_RAMPS.map(({ name, from, atIntro, atMax }) => ({
    name,
    value: NOTE_VALUES[name],
    weight: level < from ? 0 : lerp(atIntro, atMax, ramp(level, from, MAX_LEVEL)),
  })).filter((entry) => entry.weight > 0);

  const tupletRatios: TupletRatio[] = [];
  if (level >= 4) tupletRatios.push({ num: 3, inSpaceOf: 2 });
  if (level >= 9) tupletRatios.push({ num: 5, inSpaceOf: 4 });

  const categories: IdiomCategory[] = ['scalar', 'interval'];
  if (level >= 4) categories.push('cadential');
  if (level >= 3) categories.push('arpeggio');

  return {
    level,
    noteValues,
    restChance: lerp(0.08, 0.4, ramp(level, 3, MAX_LEVEL)) * (level >= 3 ? 1 : 0),
    tupletChance: lerp(0.1, 0.35, ramp(level, 4, MAX_LEVEL)) * (level >= 4 ? 1 : 0),
    tupletRatios,
    maxLocalInterval: Math.round(lerp(2, 12, t)),
    sequenceChance: lerp(0.2, 0.6, ramp(level, 4, MAX_LEVEL)) * (level >= 4 ? 1 : 0),
    accidentalChance: lerp(0.1, 0.35, ramp(level, 6, MAX_LEVEL)) * (level >= 6 ? 1 : 0),
    maxKeyAccidentals: level < 3 ? 0 : Math.round(lerp(1, 5, ramp(level, 3, MAX_LEVEL))),
    categories,
    targetBars: Math.round(lerp(2, 4, ramp(level, 1, 5))),
    timeSignature: [4, 4],
    countInBars: 1,
    // The click thins out once the pulse should be internalised.
    clickThroughExercise: level <= 5,
    // Only once note values are short enough that a cadence fits alongside a
    // phrase. At whole-note density a single idiom already fills the exercise.
    endOnCadence: level >= 4,
    scoring: DEFAULT_SCORING,
  };
}

/** Short human-readable notes on what a level introduces, for the UI. */
export function levelSummary(config: LevelConfig): string[] {
  const shortest = config.noteValues[config.noteValues.length - 1];
  const summary = [`down to ${shortest.name}s`, `leaps to ${config.maxLocalInterval} semitones`];
  summary.push(
    config.maxKeyAccidentals === 0
      ? 'C major only'
      : `keys up to ${config.maxKeyAccidentals} sharps/flats`,
  );
  if (config.restChance > 0) summary.push('rests');
  if (config.tupletRatios.length > 0) {
    summary.push(config.tupletRatios.length > 1 ? 'triplets and quintuplets' : 'triplets');
  }
  if (config.sequenceChance > 0) summary.push('transposed sequences');
  if (config.accidentalChance > 0) summary.push('accidentals');
  summary.push(`${config.targetBars} bars`);
  return summary;
}

export const LEVELS: LevelConfig[] = Array.from({ length: MAX_LEVEL }, (_, i) => levelConfig(i + 1));
