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

/** Everything the worklet posts back, tagged so the two streams stay distinct. */
export type WorkletMessage =
  | { type: 'pitch'; sample: PitchSample }
  | { type: 'onset'; event: OnsetEvent };
