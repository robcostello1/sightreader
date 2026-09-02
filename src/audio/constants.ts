import type { OnsetEvent, PitchSample } from '../lib/types';

/**
 * Shared between the worklet and the main thread. Kept in its own module so
 * capture.ts can name the processor without importing the worklet entry, which
 * would pull registerProcessor into the main bundle.
 */
export const PITCH_PROCESSOR_NAME = 'pitch-processor';

/** Message the main thread sends to wind the processor down. */
export interface StopMessage {
  type: 'stop';
}

/**
 * Hop length at 44.1kHz, for reasoning about scorability before a microphone is
 * open and the real rate is known. Hardware may differ; this is only used for
 * advice, never for scoring.
 */
export const NOMINAL_HOP_MS = 512 / 44.1;

/**
 * Nominal frame length, and the rate the nominal band below is quoted at.
 *
 * Real hardware may open at another rate — 48kHz is common — which moves both
 * ends of the band, so the detector recomputes them from the rate it is
 * actually handed. These constants are for reasoning before a microphone is
 * open, in the same spirit as NOMINAL_HOP_MS.
 */
const NOMINAL_FRAME = 2048;
const NOMINAL_RATE = 44100;

/**
 * Cycles of a pitch that must fit inside one frame for it to be nameable.
 *
 * Measured, not assumed. Sweeping the detector over struck-string signals — a
 * decaying harmonic stack, with and without noise — it names every pitch from
 * 1.52 cycles per frame upward and returns nothing below 1.43. The old figure
 * was 2 cycles, which was conservative by five semitones.
 */
export const MIN_PERIODS_IN_FRAME = 1.5;

/**
 * Samples per period a pitch needs for the peak to be resolved.
 *
 * The other end of the same sweep. Above roughly 13 samples per period the NSDF
 * peak at the true period is worse resolved than the one an octave below it, and
 * the detector reports half the frequency — a clean octave error rather than a
 * gradual loss. G#7 (3322Hz, 13.3 samples per period at 44.1kHz) is named; A7
 * (3520Hz, 12.5) comes back an octave flat. Adding noise at -20dB and -14dB
 * moves neither end.
 */
export const MIN_SAMPLES_PER_PERIOD = 13;

/**
 * The band at the nominal rate: C1 (32.7Hz) to G#7 (3322Hz).
 *
 * These used to be 70Hz and 1320Hz — a guard sized for the guitar's low E, back
 * when guitar was the only instrument, and a ceiling "well above open position's
 * top note", which is G#4 at 415Hz. Between them they cost the low instruments
 * about an octave each and threw away three notes in five on a piccolo, silently,
 * because an unscoreable note reads as one the player did not sound.
 *
 * The band now covers 81 of the piano's 88 keys. What it still cannot reach is
 * A0-B0 at the bottom and A7-C8 at the top; reaching those means a longer frame,
 * which costs time resolution everywhere else — see docs/detector-band.md.
 */
export const DETECTOR_MIN_HZ = detectorMinHz(NOMINAL_RATE, NOMINAL_FRAME);
export const DETECTOR_MAX_HZ = detectorMaxHz(NOMINAL_RATE);

/** Lowest nameable frequency for a given rate and frame — see MIN_PERIODS_IN_FRAME. */
export function detectorMinHz(sampleRate: number, frameSize: number): number {
  return (MIN_PERIODS_IN_FRAME * sampleRate) / frameSize;
}

/** Highest nameable frequency for a given rate — see MIN_SAMPLES_PER_PERIOD. */
export function detectorMaxHz(sampleRate: number): number {
  return sampleRate / MIN_SAMPLES_PER_PERIOD;
}

/** Everything the worklet posts back, tagged so the two streams stay distinct. */
export type WorkletMessage =
  | { type: 'pitch'; sample: PitchSample }
  | { type: 'onset'; event: OnsetEvent };
