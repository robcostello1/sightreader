import { PitchDetector as PitchyCore } from 'pitchy';
import type { PitchDetector, PitchSample } from '../lib/types';

/**
 * Defaults sized for the lowest note the app admits. A 2048-sample frame
 * resolves down to ~43Hz at 44.1kHz, comfortably below E2 (82.4Hz), the floor
 * every available instrument sits above; a 512-sample hop is ~11.6ms, inside
 * the 10-20ms the spec asks for.
 */
export const DEFAULT_FRAME_SIZE = 2048;
export const DEFAULT_HOP_SIZE = 512;

export interface PitchyDetectorOptions {
  frameSize?: number;
  hopSize?: number;
  /** Below the low E with margin for a flat string. */
  minHz?: number;
  /** Well above open position's top note, leaving room for future regions. */
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
    this.minHz = options.minHz ?? 70;
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
