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
 * Lowest frequency the detector is asked to resolve, in Hz.
 *
 * Lives here rather than in either place that needs it, because both need the
 * *same* number and they used to disagree: the detector rejected anything under
 * 70Hz — a guard sized for the guitar's low E, back when guitar was the only
 * instrument — while viability told the generator the floor was 43Hz. The
 * generator therefore wrote notes the microphone silently threw away, over a
 * whole octave of the double bass, tuba, bass guitar and french horn.
 *
 * 43Hz is the frame's own limit, not a margin: a 2048-sample frame at 44.1kHz
 * spans 46ms, which holds two cycles at 43.07Hz, and no amount of holding the
 * note longer puts more of it inside one frame. F1 (43.7Hz) is therefore the
 * lowest note the app can name, and E1 (41.2Hz) is out of reach.
 *
 * Note the rate: at 48kHz the same frame spans 42.7ms and the true floor is
 * nearer 47Hz, so F1 is marginal on hardware that opens at that rate. Fixing
 * that means sizing the frame from the live sample rate, which is a detector
 * change rather than a constant.
 */
export const DETECTOR_MIN_HZ = 43;

/** Everything the worklet posts back, tagged so the two streams stay distinct. */
export type WorkletMessage =
  | { type: 'pitch'; sample: PitchSample }
  | { type: 'onset'; event: OnsetEvent };
