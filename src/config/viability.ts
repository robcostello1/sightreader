import { midiToHz } from '../lib/pitch';
import type { Midi, NoteValue } from '../lib/types';

/**
 * Whether a note is long enough, at its own frequency, to be worth generating.
 *
 * A pitch detector needs to see a number of complete cycles before it can name
 * a pitch, and a low note's cycles are long: at 41Hz a period is 24ms, so a
 * semiquaver at 200bpm holds barely one. The note-window scorer has a ceiling
 * too, but a different one — it counts detector frames, which arrive at a fixed
 * rate whatever the pitch. This ceiling moves with the register, which is why
 * it cannot be folded into that one.
 */
export interface ViabilityConfig {
  /**
   * Off until the pitch-detection spike measures the constants below. The
   * placeholders are a guess, and a guess that gates real exercises is either
   * needlessly restrictive or not restrictive enough — neither is worth
   * shipping to find out.
   */
  enabled: boolean;
  /** Theoretical floor: cycles a detector needs before it can name a pitch. */
  basePeriods: number;
  /** Safety margin over the floor, for a real room and a real instrument. */
  marginMultiplier: number;
  /**
   * Attack transient skipped at the head of the note, in ms. The same window
   * head the scorer's attackGuardMs skips — see the test that holds the two
   * together.
   */
  attackExclusionMs: number;
}

/**
 * Conservative placeholders, pending spike-pitch-detection-viability.
 *
 * Kept together and apart from the logic so the measured numbers drop in
 * without anything else being touched.
 */
export const DEFAULT_VIABILITY: ViabilityConfig = {
  enabled: false,
  basePeriods: 3,
  marginMultiplier: 1.5,
  attackExclusionMs: 40,
};

/** Cycles a note must contain to be scoreable, margin included. */
export function requiredPeriods(config: ViabilityConfig): number {
  return config.basePeriods * config.marginMultiplier;
}

/**
 * How long a note lasts, in ms.
 *
 * `value` is a fraction of a whole note, so the beat unit turns it into beats:
 * a quaver is an eighth of a whole note, which is half a beat in 4/4 and a
 * whole beat in 6/8.
 */
export function noteDurationMs(value: NoteValue, beatUnit: number, bpm: number): number {
  return value * beatUnit * (60_000 / bpm);
}

/** Cycles of `hz` that fit in the note, after its attack is skipped. */
export function periodsAvailable(
  hz: number,
  value: NoteValue,
  beatUnit: number,
  bpm: number,
  config: ViabilityConfig,
): number {
  const usableMs = noteDurationMs(value, beatUnit, bpm) - config.attackExclusionMs;
  if (usableMs <= 0) return 0;
  return (usableMs * hz) / 1000;
}

/**
 * Whether this pitch, at this value and tempo, is worth putting on the page.
 *
 * `hz` is *sounding* frequency, always. A transposing instrument's written note
 * names a different frequency from the one that reaches the microphone, and it
 * is the physical one that decides whether detection is feasible.
 */
export function isViable(
  hz: number,
  value: NoteValue,
  beatUnit: number,
  bpm: number,
  config: ViabilityConfig,
): boolean {
  if (!config.enabled) return true;
  return periodsAvailable(hz, value, beatUnit, bpm, config) >= requiredPeriods(config) - 1e-9;
}

/**
 * Fastest tempo at which this pitch still holds enough cycles at this value.
 *
 * Inverts isViable, so the tempo control can stop where the register does
 * rather than handing the player notes that were never going to be scoreable.
 */
export function fastestViableBpm(
  hz: number,
  value: NoteValue,
  beatUnit: number,
  config: ViabilityConfig,
): number {
  if (!config.enabled) return Number.POSITIVE_INFINITY;
  const neededMs = config.attackExclusionMs + (requiredPeriods(config) * 1000) / hz;
  return (value * beatUnit * 60_000) / neededMs;
}

/**
 * Fastest tempo the whole register can sustain at this note value.
 *
 * The lowest pitch is the binding one: its cycles are the longest, so it fails
 * first. Per instrument and range rather than globally, which is the point —
 * a flute's ceiling and a cello's are nowhere near each other.
 *
 * `pool` is sounding pitches, ascending, as the generator holds them.
 */
export function fastestViableBpmForPool(
  pool: readonly Midi[],
  value: NoteValue,
  beatUnit: number,
  config: ViabilityConfig,
): number {
  if (!config.enabled || pool.length === 0) return Number.POSITIVE_INFINITY;
  return fastestViableBpm(midiToHz(Math.min(...pool)), value, beatUnit, config);
}
