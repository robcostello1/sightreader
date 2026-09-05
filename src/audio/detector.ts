import { PitchDetector as PitchyCore } from 'pitchy';
import { DETECTOR_MAX_HZ, DETECTOR_MIN_HZ, detectorMaxHz, detectorMinHz } from './constants';
import type { PitchDetector, PitchSample } from '../lib/types';

/**
 * A 2048-sample frame names C1 to G#7 at 44.1kHz — 81 of a piano's 88 keys,
 * which is what bounds the instrument list at both ends. A 512-sample hop is
 * ~11.6ms, inside the 10-20ms the spec asks for.
 */
export const DEFAULT_FRAME_SIZE = 2048;
export const DEFAULT_HOP_SIZE = 512;

export interface PitchyDetectorOptions {
  frameSize?: number;
  hopSize?: number;
  /**
   * Floor for a believable reading, at the nominal rate. The live floor is the
   * stricter of this and what the actual sample rate allows.
   */
  minHz?: number;
  /** Ceiling for a believable reading, treated the same way as minHz. */
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
    this.maxHz = options.maxHz ?? DETECTOR_MAX_HZ;
    this.rmsFloor = options.rmsFloor ?? 0.005;
    this.core = PitchyCore.forFloat32Array(this.frameSize);
  }

  /**
   * The band this detector can actually name at a given rate.
   *
   * Both ends move with the sample rate, so they are computed from the rate the
   * hardware granted rather than assumed. At 48kHz the same frame is shorter in
   * time and the floor rises — C1 is nameable at 44.1kHz and is not at 48kHz —
   * while the ceiling rises with it. Taking the stricter of the configured
   * bound and the derived one keeps an explicit narrow band narrow.
   */
  bandAt(sampleRate: number): { minHz: number; maxHz: number } {
    return {
      minHz: Math.max(this.minHz, detectorMinHz(sampleRate, this.frameSize)),
      maxHz: Math.min(this.maxHz, detectorMaxHz(sampleRate)),
    };
  }

  detect(frame: Float32Array, sampleRate: number): Omit<PitchSample, 'timestamp'> {
    if (computeRms(frame) < this.rmsFloor) return { hz: null, confidence: 0 };

    const [hz, clarity] = this.core.findPitch(frame, sampleRate);
    // pitchy returns [0, 0] when it cannot find a pitch at all.
    if (hz <= 0 || clarity <= 0) return { hz: null, confidence: 0 };
    // Out-of-range readings are octave errors or bleed, not the target note.
    const band = this.bandAt(sampleRate);
    if (hz < band.minHz || hz > band.maxHz) return { hz: null, confidence: 0 };

    return { hz, confidence: clarity };
  }
}
