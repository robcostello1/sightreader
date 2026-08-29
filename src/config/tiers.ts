import type { IdiomCategory, NoteValueName } from '../lib/types';

/**
 * Difficulty config (§2, §8). Idiom complexity, rhythmic density and fretboard
 * region are independent dials so a learner can be drilled on "simple idioms at
 * quaver speed" or "medium idioms at whole-note speed" separately — the point
 * is isolating pattern-reading trouble from tempo trouble.
 */

export type TierId = 'simple' | 'medium';

/** How dense the rhythm is, independent of which idioms are in play. */
export interface DensityDial {
  id: string;
  allowedValues: NoteValueName[];
  allowRests: boolean;
  allowTriplets: boolean;
}

/** How hard the patterns are, independent of how fast they go. */
export interface IdiomDial {
  id: string;
  categories: IdiomCategory[];
  /** Idiom instances per exercise. */
  instances: [min: number, max: number];
  /** Transposed instances of the same idiom are allowed. */
  allowTransposition: boolean;
  /** Max semitone leap between consecutive notes — the local movement constraint (§3). */
  maxLocalInterval: number;
  /** Chromatic passing / borrowed notes permitted. */
  allowAccidentals: boolean;
  /** End the phrase on a cadential figure rather than an arbitrary stop. */
  endOnCadence: boolean;
}

export const DENSITIES: Record<string, DensityDial> = {
  'whole-only': { id: 'whole-only', allowedValues: ['whole'], allowRests: false, allowTriplets: false },
  'to-half': { id: 'to-half', allowedValues: ['whole', 'half'], allowRests: false, allowTriplets: false },
  'to-quarter': { id: 'to-quarter', allowedValues: ['whole', 'half', 'quarter'], allowRests: true, allowTriplets: false },
  'to-eighth': {
    id: 'to-eighth',
    allowedValues: ['half', 'quarter', 'eighth'],
    allowRests: true,
    allowTriplets: true,
  },
};

export const IDIOM_DIALS: Record<string, IdiomDial> = {
  simple: {
    id: 'simple',
    categories: ['scalar', 'interval'],
    instances: [1, 1],
    allowTransposition: false,
    maxLocalInterval: 4, // steps and small thirds
    allowAccidentals: false,
    endOnCadence: false,
  },
  medium: {
    id: 'medium',
    categories: ['scalar', 'arpeggio', 'interval', 'cadential'],
    instances: [2, 4],
    allowTransposition: true,
    maxLocalInterval: 7, // idiom-scoped leaps up to a fifth
    allowAccidentals: true,
    endOnCadence: true,
  },
};

export interface ScoringConfig {
  /** Occupancy fraction required to pass a note window (§6.5). */
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

export interface TierConfig {
  id: TierId;
  name: string;
  regionId: string;
  density: DensityDial;
  idioms: IdiomDial;
  bars: number;
  timeSignature: [number, number];
  /** Count-in length in bars; provides the scheduler's t0 reference (§2). */
  countInBars: number;
  /** Whether the click keeps going once the exercise starts (§2). */
  clickThroughExercise: boolean;
  scoring: ScoringConfig;
}

export const TIERS: Record<TierId, TierConfig> = {
  simple: {
    id: 'simple',
    name: 'Simple',
    regionId: 'open-position',
    density: DENSITIES['whole-only'],
    idioms: IDIOM_DIALS.simple,
    bars: 1,
    timeSignature: [4, 4],
    countInBars: 1,
    clickThroughExercise: true,
    scoring: DEFAULT_SCORING,
  },
  medium: {
    id: 'medium',
    name: 'Medium',
    regionId: 'open-position',
    density: DENSITIES['to-eighth'],
    idioms: IDIOM_DIALS.medium,
    bars: 2,
    timeSignature: [4, 4],
    countInBars: 1,
    clickThroughExercise: false,
    scoring: DEFAULT_SCORING,
  },
};
