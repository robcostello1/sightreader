import FFT from 'fft.js';
import type { OnsetEvent } from '../lib/types';

/**
 * Analysed over the tail of the pitch frame rather than the whole thing: a
 * 2048-sample window would smear a pick transient across ~46ms and blunt the
 * flux peak we are trying to find.
 */
export const DEFAULT_ONSET_WINDOW = 1024;

export interface OnsetDetectorOptions {
  windowSize?: number;
  /** Frames of flux history backing the adaptive threshold (~0.5s by default). */
  historyFrames?: number;
  /** Flux must exceed median * multiplier + floor to count as an onset. */
  thresholdMultiplier?: number;
  /** Absolute floor, so a silent passage's tiny median cannot trigger onsets. */
  thresholdFloor?: number;
  /** Debounce; also caps the fastest detectable re-articulation. */
  minIntervalMs?: number;
  /**
   * Frames either side that a peak must dominate. Comparing only immediate
   * neighbours lets ripple in a decaying note register as an onset, so the
   * candidate has to be the local maximum over a wider span. Costs this many
   * hops of detection latency.
   */
  peakNeighborhood?: number;
}

/**
 * Calibrated against synthetic plucks only — these are starting points, not
 * measured values, and need tuning against real instruments. That is why onset
 * sensitivity is a per-instrument knob rather than one global threshold.
 *
 * Known weakness: recall degrades when several notes sustain and beat against
 * each other, because the constant flux inflates the adaptive median and masks
 * real attacks. Damping the previous note (ordinary single-string melodic
 * playing) avoids it; heavy open-string ringing does not.
 *
 * Distortion compresses dynamics, so an attack stands out less against its own
 * sustain (lower multiplier) while the sustain itself is noisier (higher floor).
 * Fingerstyle is the opposite case: a soft attack, but a quiet decay behind it.
 */
export const ONSET_PRESETS = {
  'acoustic-fingerstyle': { thresholdMultiplier: 10, thresholdFloor: 0.00004, minIntervalMs: 60 },
  'acoustic-pick': { thresholdMultiplier: 14, thresholdFloor: 0.00008, minIntervalMs: 50 },
  'electric-clean': { thresholdMultiplier: 12, thresholdFloor: 0.00006, minIntervalMs: 50 },
  'electric-distorted': { thresholdMultiplier: 8, thresholdFloor: 0.0001, minIntervalMs: 70 },
} as const satisfies Record<string, OnsetDetectorOptions>;

export type InstrumentPreset = keyof typeof ONSET_PRESETS;

/**
 * Spectral-flux onset detection: sum the frame-to-frame rise in each frequency
 * bin, then peak-pick against an adaptive threshold.
 *
 * Half-wave rectification (rises only) is what makes this work for a repeated
 * note at the same pitch — a plain energy derivative would miss the re-pluck of
 * a still-ringing string, and the "repeated note" rhythm drill in the idiom
 * library is exactly that case.
 */
export class SpectralFluxOnsetDetector {
  readonly windowSize: number;

  private readonly fft: FFT;
  private readonly hann: Float64Array;
  private readonly windowed: Float64Array;
  private readonly spectrum: Float64Array;
  private readonly magnitude: Float64Array;
  private readonly prevMagnitude: Float64Array;

  private readonly historyFrames: number;
  private readonly thresholdMultiplier: number;
  private readonly thresholdFloor: number;
  private readonly minIntervalMs: number;
  private readonly peakNeighborhood: number;

  private readonly flux: number[] = [];
  private readonly times: number[] = [];
  private readonly sorted: number[] = [];

  private primed = false;
  private lastOnsetMs = Number.NEGATIVE_INFINITY;

  constructor(options: OnsetDetectorOptions = {}) {
    this.windowSize = options.windowSize ?? DEFAULT_ONSET_WINDOW;
    this.historyFrames = options.historyFrames ?? 43;
    this.thresholdMultiplier = options.thresholdMultiplier ?? 12;
    this.thresholdFloor = options.thresholdFloor ?? 0.00006;
    this.minIntervalMs = options.minIntervalMs ?? 50;
    this.peakNeighborhood = options.peakNeighborhood ?? 3;

    const bins = this.windowSize / 2;
    this.fft = new FFT(this.windowSize);
    this.windowed = new Float64Array(this.windowSize);
    this.spectrum = new Float64Array(this.windowSize * 2);
    this.magnitude = new Float64Array(bins);
    this.prevMagnitude = new Float64Array(bins);

    this.hann = new Float64Array(this.windowSize);
    for (let i = 0; i < this.windowSize; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.windowSize - 1)));
    }
  }

  /**
   * Feeds one hop. `frame` must be at least windowSize long; its tail is used.
   *
   * Returns an onset for an *earlier* hop once that hop proves to be the local
   * flux maximum — peak-picking must see the frames that follow, so detection
   * lags real time by peakNeighborhood hops (~35ms by default). The returned
   * timestamp is the peak's own, so accuracy is unaffected by that lag.
   */
  push(frame: Float32Array, timestampMs: number): OnsetEvent | null {
    this.computeMagnitude(frame);

    let sum = 0;
    for (let k = 0; k < this.magnitude.length; k++) {
      const rise = this.magnitude[k] - this.prevMagnitude[k];
      if (rise > 0) sum += rise;
    }
    this.prevMagnitude.set(this.magnitude);

    // The first frame has no predecessor, so its "flux" is the whole spectrum.
    if (!this.primed) {
      this.primed = true;
      return null;
    }

    this.flux.push(sum / this.magnitude.length);
    this.times.push(timestampMs);
    if (this.flux.length > this.historyFrames) {
      this.flux.shift();
      this.times.shift();
    }

    return this.pickPeak();
  }

  private computeMagnitude(frame: Float32Array): void {
    const start = frame.length - this.windowSize;
    for (let i = 0; i < this.windowSize; i++) {
      this.windowed[i] = frame[start + i] * this.hann[i];
    }
    this.fft.realTransform(this.spectrum, this.windowed);
    // Scale to amplitude units (a unit sine reads ~0.5 in its bin, Hann's
    // coherent gain) so thresholdFloor is independent of window size.
    const scale = 4 / this.windowSize;
    for (let k = 0; k < this.magnitude.length; k++) {
      this.magnitude[k] = Math.hypot(this.spectrum[2 * k], this.spectrum[2 * k + 1]) * scale;
    }
  }

  private pickPeak(): OnsetEvent | null {
    const w = this.peakNeighborhood;
    const n = this.flux.length;
    const i = n - 1 - w;
    if (i - w < 0) return null;

    const candidate = this.flux[i];
    // Must dominate its whole neighbourhood: strictly greater looking back,
    // greater-or-equal looking forward so a plateau resolves to its first frame.
    for (let j = i - w; j < i; j++) if (candidate <= this.flux[j]) return null;
    for (let j = i + 1; j <= i + w; j++) if (candidate < this.flux[j]) return null;

    const threshold = this.median() * this.thresholdMultiplier + this.thresholdFloor;
    if (candidate <= threshold) return null;

    const timestamp = this.times[i];
    if (timestamp - this.lastOnsetMs < this.minIntervalMs) return null;
    this.lastOnsetMs = timestamp;

    // Strength as a ratio above threshold, so it stays comparable across input
    // levels instead of tracking raw mic gain.
    return { timestamp, strength: candidate / threshold };
  }

  private median(): number {
    this.sorted.length = 0;
    for (const value of this.flux) this.sorted.push(value);
    this.sorted.sort((a, b) => a - b);
    const mid = this.sorted.length >> 1;
    return this.sorted.length % 2 === 0
      ? (this.sorted[mid - 1] + this.sorted[mid]) / 2
      : this.sorted[mid];
  }
}
