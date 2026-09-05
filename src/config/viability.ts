import { DETECTOR_MAX_HZ, DETECTOR_MIN_HZ, NOMINAL_HOP_MS } from '../audio/constants';
import { midiToHz } from '../lib/pitch';
import type { ScoringConfig } from './levels';
import { NOTE_VALUES, type Midi, type NoteValue } from '../lib/types';

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
   * On, and the only thing standing between a player and a note nothing can
   * score — the blunt instrument-level and tempo-level limits it replaced are
   * gone. The constants below are still the spike's to calibrate, but they err
   * conservatively, so running live can only leave out notes that might have
   * been fine. That is the safe direction to be wrong in.
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
  /**
   * Lowest frequency the detector can resolve at all, in Hz.
   *
   * Not a matter of note length: a 2048-sample frame at 44.1kHz spans 46ms, so
   * around 43Hz it stops holding the two cycles the detector needs, and holding
   * the note longer does not put more of it inside one frame. A tuba's D1 is
   * 37Hz and the open E of a bass is 41Hz — both under it, however long they
   * ring. Raising this means a longer frame for low registers, which is a
   * detector change rather than a constant.
   *
   * Set from DETECTOR_MIN_HZ so this and the detector's own band cannot
   * disagree — they did, by an octave, and the generator lost the argument.
   */
  resolutionFloorHz: number;
  /**
   * Highest frequency the detector can resolve at all, in Hz.
   *
   * The mirror of the floor, and it had no counterpart here at all, so the
   * generator wrote whatever an instrument's range reached and the detector
   * discarded it: three notes in five on a piccolo, one in three on a soprano
   * recorder. Above this the NSDF peak an octave down is better resolved than
   * the true one and readings come back exactly an octave flat, so a note up
   * there is not merely noisy, it is confidently wrong.
   *
   * Set from DETECTOR_MAX_HZ, for the same reason as the floor.
   */
  resolutionCeilingHz: number;
}

/**
 * Conservative placeholders, pending spike-pitch-detection-viability.
 *
 * Kept together and apart from the logic so the measured numbers drop in
 * without anything else being touched.
 */
export const DEFAULT_VIABILITY: ViabilityConfig = {
  enabled: true,
  basePeriods: 3,
  marginMultiplier: 1.5,
  attackExclusionMs: 40,
  resolutionFloorHz: DETECTOR_MIN_HZ,
  resolutionCeilingHz: DETECTOR_MAX_HZ,
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
 * Four ways a note can be unscoreable, and all of them are properties of the
 * note rather than of the instrument or the tempo:
 *
 *  - its frequency is outside the band the detector can resolve at all;
 *  - it holds too few cycles of itself to be named;
 *  - it yields too few detector frames to be judged.
 *
 * The third is the scorer's own rule, applied here as well: the generator has
 * to know it, because it is the one deciding what to write. Nothing else limits
 * tempo or instrument any more, so all of it lives in this one test.
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
  scoring?: ScoringConfig,
  hopMs: number = NOMINAL_HOP_MS,
): boolean {
  if (!config.enabled) return true;
  if (hz < config.resolutionFloorHz || hz > config.resolutionCeilingHz) return false;
  if (periodsAvailable(hz, value, beatUnit, bpm, config) < requiredPeriods(config) - 1e-9) {
    return false;
  }
  if (!scoring) return true;
  // The window has to yield enough frames to judge, which the detector delivers
  // at a fixed rate whatever the pitch. This is what used to cap the tempo
  // control; per note, it costs the level its shortest values at high tempo
  // instead of costing the player the tempo.
  const usableMs = noteDurationMs(value, beatUnit, bpm) - scoring.attackGuardMs;
  return Math.floor(usableMs / hopMs) >= scoring.minSamples;
}

/**
 * Shortest note value the whole range can sustain at this tempo, or null if
 * even the longest cannot.
 *
 * This is the per-range answer, and it is a note length rather than a tempo:
 * nothing stops the player choosing 240bpm on a double bass, it is just that
 * down there the semiquavers drop out and the quavers stay. The lowest pitch
 * is the binding one, since its cycles are the longest.
 *
 * `pool` is sounding pitches, as the generator holds them.
 */
export function shortestViableValue(
  pool: readonly Midi[],
  beatUnit: number,
  bpm: number,
  config: ViabilityConfig,
  scoring?: ScoringConfig,
  hopMs: number = NOMINAL_HOP_MS,
): NoteValue | null {
  // The lowest pitch that can be resolved at all, not simply the lowest: below
  // the floor no note length helps, so those are not what the range's shortest
  // value is about — they are absent from every exercise regardless.
  const resolvable = pool.filter((midi) => midiToHz(midi) >= config.resolutionFloorHz);
  if (resolvable.length === 0) return null;
  const hz = midiToHz(Math.min(...resolvable));
  // Shortest first: the answer is the first that survives. Only the values the
  // generator actually writes, so the answer is one the player could meet.
  const ascending = Object.values(NOTE_VALUES).sort((a, b) => a - b);
  return (
    ascending.find((value) => isViable(hz, value, beatUnit, bpm, config, scoring, hopMs)) ?? null
  );
}
