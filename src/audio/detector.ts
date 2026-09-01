import { PitchDetector as PitchyCore } from 'pitchy';
import { DETECTOR_MIN_HZ } from './constants';
import type { PitchDetector, PitchSample } from '../lib/types';

/**
 * A 2048-sample frame resolves down to ~43Hz at 44.1kHz, which is where
 * DETECTOR_MIN_HZ comes from and what bounds the bottom of the instrument list
 * — a tuba's D1 is under it and a double bass's low E is not. A 512-sample hop
 * is ~11.6ms, inside the 10-20ms the spec asks for.
 */
export const DEFAULT_FRAME_SIZE = 2048;
export const DEFAULT_HOP_SIZE = 512;

export interface PitchyDetectorOptions {
  frameSize?: number;
  hopSize?: number;
  /**
   * Floor for a believable reading. Defaults to DETECTOR_MIN_HZ, the frame's
   * own resolution limit, so the detector hears everything the generator is
   * willing to write and the two cannot drift apart.
   */
  minHz?: number;
  /**
   * Ceiling for a believable reading.
   *
   * Still the guitar-era value, and now too low: it is under the top of a
   * piccolo, recorder, flute, violin, clarinet and the piano's wide range, and
   * viability has no ceiling to match it, so those notes are written and then
   * dropped. Raising it needs a measurement of where readings stop being
   * trustworthy, not a guess — see docs/detector-band.md.
   */
  maxHz?: number;
  /** RMS below this is treated as silence rather than run through detection. */
  rmsFloor?: number;
}

export function computeRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * v1 detector: pitchy's McLeod Pitch Method (FFT-based NSDF, O(n log n) — cheap
 * enough to run on the audio thread). Sits behind the PitchDetector interface so
 * a YIN/pYIN or neural detector can replace it without the scorer changing.
 */
export class PitchyDetector implements PitchDetector {
  readonly name = 'pitchy-mpm';
  readonly hopSize: number;
  readonly frameSize: number;

  private readonly core: PitchyCore<Float32Array>;
  private readonly minHz: number;
  private readonly maxHz: number;
  private readonly rmsFloor: number;

  constructor(options: PitchyDetectorOptions = {}) {
    this.frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
    this.hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
    this.minHz = options.minHz ?? DETECTOR_MIN_HZ;
    this.maxHz = options.maxHz ?? 1320;
    this.rmsFloor = options.rmsFloor ?? 0.005;
    this.core = PitchyCore.forFloat32Array(this.frameSize);
  }

  detect(frame: Float32Array, sampleRate: number): Omit<PitchSample, 'timestamp'> {
    if (computeRms(frame) < this.rmsFloor) return { hz: null, confidence: 0 };

    const [hz, clarity] = this.core.findPitch(frame, sampleRate);
    // pitchy returns [0, 0] when it cannot find a pitch at all.
    if (hz <= 0 || clarity <= 0) return { hz: null, confidence: 0 };
    // Out-of-range readings are octave errors or bleed, not the target note.
    if (hz < this.minHz || hz > this.maxHz) return { hz: null, confidence: 0 };

    return { hz, confidence: clarity };
  }
}
