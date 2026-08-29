/**
 * Shared domain types. These define the seams between the modules described in
 * the design spec: audio -> scheduler -> scorer, and idioms -> generator ->
 * notation.
 */

/** MIDI note number is the canonical internal pitch representation. */
export type Midi = number;

/** Milliseconds on the AudioContext clock (not wall clock / Date.now). */
export type AudioTimeMs = number;

/** Scale degree, 0-indexed: 0 = tonic, 4 = dominant. Can exceed 6 to mean the octave above. */
export type ScaleDegree = number;

/** Chromatic alteration applied on top of a diatonic scale degree. */
export type Alteration = -1 | 0 | 1;

/** Note value as a fraction of a whole note. Quaver = 1/8. */
export type NoteValue = number;

export const NOTE_VALUES = {
  breve: 2,
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
} as const;

export type NoteValueName = keyof typeof NOTE_VALUES;

// --- Idiom library (§4) -----------------------------------------------------

/**
 * One event in an idiom's relative pattern. Idioms are stored as scale degrees
 * plus rhythmic values so a single idiom can be instantiated in any key,
 * transposed to any starting degree, and re-rendered at any rhythmic density.
 */
export interface IdiomEvent {
  /** Offset from the idiom's starting degree. Null = rest. */
  degree: ScaleDegree | null;
  alteration?: Alteration;
  /** Relative duration within the idiom; normalised against the tier's density. */
  beats: number;
}

export type IdiomCategory = 'scalar' | 'arpeggio' | 'interval' | 'cadential';

export interface Idiom {
  id: string;
  name: string;
  category: IdiomCategory;
  events: IdiomEvent[];
}

// --- Generated exercise -----------------------------------------------------

/** A concrete, pitched, timed note ready to be scheduled and notated. */
export interface ExerciseNote {
  /** Null = rest (scored per §6 as "did the prior pitch stop ringing"). */
  midi: Midi | null;
  value: NoteValue;
  idiomId: string;
  /**
   * Which idiom instance produced this note. Two placements of the same idiom
   * in one exercise share an idiomId but differ here, so the local movement
   * constraint can be checked within an instance rather than across a join.
   */
  instance: number;
  /**
   * Shared id for the notes of one tuplet group. Three notes carrying the same
   * id occupy the space of two, which is what keeps the bar arithmetic exact
   * and lets the notation layer draw the bracket.
   */
  tuplet?: number;
}

export interface Exercise {
  notes: ExerciseNote[];
  keyCenter: Midi;
  timeSignature: [number, number];
  bpm: number;
}

// --- Scheduling (§6) --------------------------------------------------------

/**
 * A note's expected occupancy window, derived from the count-in reference
 * timestamp (t0) plus tempo and note value.
 */
export interface NoteWindow {
  index: number;
  note: ExerciseNote;
  startMs: AudioTimeMs;
  endMs: AudioTimeMs;
  /** Start of the scoring zone: window start plus the attack-transient guard. */
  scoreFromMs: AudioTimeMs;
}

// --- Audio (§5) -------------------------------------------------------------

/** One pitch-detector hop emitted from the worklet. */
export interface PitchSample {
  /** Detected fundamental in Hz, or null when unvoiced. */
  hz: number | null;
  /** 0..1. Samples below the gate are excluded from scoring, not counted wrong. */
  confidence: number;
  timestamp: AudioTimeMs;
}

export interface OnsetEvent {
  timestamp: AudioTimeMs;
  strength: number;
}

/**
 * The swappable pitch-detection seam (§5, §9). v1 ships a YIN/autocorrelation
 * implementation; a neural detector must be droppable in behind this interface
 * without the scorer changing.
 */
export interface PitchDetector {
  readonly name: string;
  /** Hop size in samples; determines the sample rate available to the scorer. */
  readonly hopSize: number;
  detect(frame: Float32Array, sampleRate: number): Omit<PitchSample, 'timestamp'>;
}

// --- Scoring (§6) -----------------------------------------------------------

export type NoteVerdict = 'pass' | 'silence' | 'wrong-pitch' | 'unclear' | 'unscorable';

export interface NoteResult {
  index: number;
  /** Binary pass/fail in v1; the verdict carries the internal fail mode. */
  passed: boolean;
  verdict: NoteVerdict;
  /** Fraction of high-confidence scoring-zone samples matching the target. */
  occupancy: number;
  sampleCount: number;
}
