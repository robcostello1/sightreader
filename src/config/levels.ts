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

export interface WeightedTuplet {
  num: number;
  inSpaceOf: number;
  weight: number;
}

export interface WeightedNoteValue {
  name: NoteValueName;
  value: NoteValue;
  /** Relative likelihood of being chosen, once available. */
  weight: number;
  /**
   * Chance this value is available at all in a given exercise.
   *
   * A newly introduced value needs this as well as a weight. Weighting alone
   * does not hold it back: once the first idiom has eaten into the bar budget
   * only short candidates still fit, so a short value ends up in nearly every
   * exercise however lightly it is weighted.
   */
  chance: number;
}

export interface LevelConfig {
  /** Fractional, 1.0–10.0. The decimal is how far a level's new ideas have been adopted. */
  level: number;
  noteValues: WeightedNoteValue[];
  restChance: number;
  tupletChance: number;
  tupletRatios: WeightedTuplet[];
  /** Largest permitted leap between consecutive notes within an idiom, in semitones. */
  maxLocalInterval: number;
  /** Chance an idiom repeats transposed rather than a new idiom being chosen. */
  sequenceChance: number;
  accidentalChance: number;
  /**
   * Keys are admitted by how many accidentals their signature carries. The
   * fraction is the chance of admitting one more than the whole part, so a new
   * key signature turns up occasionally before it turns up always.
   */
  maxKeyAccidentals: number;
  /** Chance each optional idiom category is available in a given exercise. */
  categoryChance: Record<IdiomCategory, number>;
  /** Chance the phrase ends on a cadential figure. */
  cadenceChance: number;
  /** Bars of idioms to pack in; fractional, so the bar count varies. */
  targetBars: number;
  timeSignature: [number, number];
  countInBars: number;
  /** Chance the click keeps going through the exercise rather than only the count-in. */
  clickThroughChance: number;
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
 * How far a feature introduced at `from` has been taken up, over the level that
 * introduces it. At 3.0 an idea new to level 3 never appears, at 3.5 it appears
 * in half the exercises, by 4.0 always — so crossing a level is a slope rather
 * than a step, and 3.0 still plays like level 2.
 */
function adoption(level: number, from: number): number {
  // Level 1 is the floor: what is present there is the baseline, not a new idea
  // easing in, so it applies in full from the start.
  if (from <= 1) return 1;
  return ramp(level, from, from + 1);
}

/**
 * When each note value first appears, and how its likelihood moves from there.
 *
 * Both halves of "shorter notes get more likely and more available" live here:
 * a value contributes nothing before its level, fades in across it, then grows,
 * while the long values decay so they do not keep dominating the mix.
 */
const VALUE_RAMPS: { name: NoteValueName; from: number; atIntro: number; atMax: number }[] = [
  // Breve is deliberately absent as a *unit*: it arises naturally from a
  // two-beat idiom event, and using it as the unit would make one note four bars
  // long. Half is the base unit even at level 1, since a four-event idiom of
  // whole notes is four bars before anything else is added — too long a wait for
  // a beginner to find out whether they read it right.
  { name: 'whole', from: 1, atIntro: 0.5, atMax: 0.05 },
  { name: 'half', from: 1, atIntro: 1, atMax: 0.4 },
  { name: 'quarter', from: 3, atIntro: 0.3, atMax: 1 },
  { name: 'eighth', from: 5, atIntro: 0.2, atMax: 0.9 },
  { name: 'sixteenth', from: 8, atIntro: 0.15, atMax: 0.5 },
];

/** Clamps to the valid range and quantises to a tenth of a level. */
export function clampLevel(level: number): number {
  const clamped = Math.min(MAX_LEVEL, Math.max(1, level));
  return Math.round(clamped * 10) / 10;
}

/**
 * Everything that varies with difficulty. Continuous in both directions: across
 * levels the settled parameters interpolate, and within a level the newly
 * introduced ones fade in by probability.
 *
 * Fretboard position is deliberately absent: it is chosen separately, because
 * moving up the neck changes what you are practising rather than how hard it is.
 */
export function levelConfig(rawLevel: number): LevelConfig {
  const level = clampLevel(rawLevel);
  const t = ramp(level, 1, MAX_LEVEL);

  const noteValues = VALUE_RAMPS.map(({ name, from, atIntro, atMax }) => ({
    name,
    value: NOTE_VALUES[name],
    weight: lerp(atIntro, atMax, ramp(level, from, MAX_LEVEL)),
    chance: adoption(level, from),
  })).filter((entry) => entry.chance > 1e-6);

  const tupletRatios: WeightedTuplet[] = [
    { num: 3, inSpaceOf: 2, weight: adoption(level, 4) },
    { num: 5, inSpaceOf: 4, weight: adoption(level, 9) },
  ].filter((ratio) => ratio.weight > 1e-6);

  return {
    level,
    noteValues,
    restChance: lerp(0.08, 0.4, ramp(level, 3, MAX_LEVEL)) * adoption(level, 3),
    tupletChance: lerp(0.1, 0.35, ramp(level, 4, MAX_LEVEL)) * adoption(level, 4),
    tupletRatios,
    maxLocalInterval: lerp(2, 12, t),
    sequenceChance: lerp(0.2, 0.6, ramp(level, 4, MAX_LEVEL)) * adoption(level, 4),
    accidentalChance: lerp(0.1, 0.35, ramp(level, 6, MAX_LEVEL)) * adoption(level, 6),
    maxKeyAccidentals: lerp(0, 5, ramp(level, 3, MAX_LEVEL)),
    categoryChance: {
      scalar: 1,
      interval: 1,
      arpeggio: adoption(level, 3),
      // Governed by cadenceChance, which decides both availability and use.
      cadential: adoption(level, 4),
    },
    cadenceChance: adoption(level, 4),
    targetBars: lerp(2, 4, ramp(level, 1, 5)),
    timeSignature: [4, 4],
    countInBars: 1,
    // Thins out once the pulse should be internalised: some exercises keep the
    // click, more of them lose it, until none has it.
    clickThroughChance: 1 - ramp(level, 5, 7),
    scoring: DEFAULT_SCORING,
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Short human-readable notes on what a level involves, for the UI. */
export function levelSummary(config: LevelConfig): string[] {
  const shortest = config.noteValues[config.noteValues.length - 1];
  const summary: string[] = [];

  // A value still fading in is described by how often it turns up at all.
  summary.push(
    shortest.chance < 0.99
      ? `${shortest.name}s in ${percent(shortest.chance)}`
      : `down to ${shortest.name}s`,
  );
  summary.push(`leaps to ${Math.floor(config.maxLocalInterval)} semitones`);

  const keyTier = Math.floor(config.maxKeyAccidentals);
  summary.push(
    keyTier === 0 && config.maxKeyAccidentals < 0.05
      ? 'C major only'
      : `keys up to ${keyTier}–${keyTier + 1} sharps/flats`,
  );

  if (config.restChance > 0.01) summary.push(`rests ${percent(config.restChance)}`);
  if (config.tupletChance > 0.01) {
    const kinds = config.tupletRatios.length > 1 ? 'triplets/quintuplets' : 'triplets';
    summary.push(`${kinds} ${percent(config.tupletChance)}`);
  }
  if (config.sequenceChance > 0.01) summary.push(`sequences ${percent(config.sequenceChance)}`);
  if (config.accidentalChance > 0.01) {
    summary.push(`accidentals ${percent(config.accidentalChance)}`);
  }
  if (config.categoryChance.arpeggio > 0.01) {
    summary.push(`arpeggios ${percent(config.categoryChance.arpeggio)}`);
  }
  summary.push(`~${config.targetBars.toFixed(1)} bars`);
  return summary;
}

/** The whole-number milestones, for reference and tests. */
export const LEVELS: LevelConfig[] = Array.from({ length: MAX_LEVEL }, (_, i) => levelConfig(i + 1));
