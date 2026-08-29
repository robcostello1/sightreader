import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME_SIZE, PitchyDetector, computeRms } from './detector';
import { centsFromTarget, midiToHz } from '../lib/pitch';

const SAMPLE_RATE = 44100;

function sine(hz: number, length = DEFAULT_FRAME_SIZE, amplitude = 0.5): Float32Array {
  const frame = new Float32Array(length);
  for (let i = 0; i < length; i++) frame[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  return frame;
}

/**
 * A plucked string is far from a pure sine — most of its energy sits in the
 * harmonics, which is exactly what trips naive autocorrelation into octave
 * errors. Decaying harmonic stack stands in for that.
 */
function pluck(hz: number, length = DEFAULT_FRAME_SIZE): Float32Array {
  const frame = new Float32Array(length);
  for (let h = 1; h <= 8; h++) {
    const amp = 0.5 / h;
    for (let i = 0; i < length; i++) {
      frame[i] += amp * Math.sin((2 * Math.PI * hz * h * i) / SAMPLE_RATE);
    }
  }
  return frame;
}

function noise(length = DEFAULT_FRAME_SIZE, amplitude = 0.5): Float32Array {
  const frame = new Float32Array(length);
  // Deterministic LCG — no Math.random, so failures are reproducible.
  let seed = 12345;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    frame[i] = amplitude * (seed / 1073741824 - 1);
  }
  return frame;
}

describe('computeRms', () => {
  it('is zero for silence and ~amplitude/sqrt(2) for a sine', () => {
    expect(computeRms(new Float32Array(1024))).toBe(0);
    expect(computeRms(sine(440))).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });
});

describe('PitchyDetector', () => {
  const detector = new PitchyDetector();

  it('reports the interface contract the scorer depends on', () => {
    expect(detector.name).toBe('pitchy-mpm');
    expect(detector.hopSize).toBe(512);
  });

  it.each([
    ['E2 (low open string)', 40],
    ['A2', 45],
    ['D3', 50],
    ['G3', 55],
    ['B3', 59],
    ['E4 (high open string)', 64],
    ['G#4 (top of open position)', 68],
  ])('locks onto %s within 10 cents', (_label, midi) => {
    const result = detector.detect(pluck(midiToHz(midi)), SAMPLE_RATE);
    expect(result.hz).not.toBeNull();
    expect(Math.abs(centsFromTarget(result.hz!, midi))).toBeLessThan(10);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('handles a pure sine as well as a harmonic-rich pluck', () => {
    const result = detector.detect(sine(440), SAMPLE_RATE);
    expect(Math.abs(centsFromTarget(result.hz!, 69))).toBeLessThan(10);
  });

  it('returns null with zero confidence for silence', () => {
    expect(detector.detect(new Float32Array(DEFAULT_FRAME_SIZE), SAMPLE_RATE)).toEqual({
      hz: null,
      confidence: 0,
    });
  });

  it('gates out signal below the RMS floor rather than guessing', () => {
    const result = detector.detect(pluck(midiToHz(45)).map((s) => s * 0.001) as Float32Array, SAMPLE_RATE);
    expect(result.hz).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('does not report a confident pitch for broadband noise', () => {
    // Unvoiced frames must be excludable, not counted as a wrong-pitch miss.
    const result = detector.detect(noise(), SAMPLE_RATE);
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('rejects readings outside the configured range', () => {
    const narrow = new PitchyDetector({ minHz: 200, maxHz: 400 });
    expect(narrow.detect(pluck(midiToHz(40)), SAMPLE_RATE).hz).toBeNull(); // E2, 82Hz
    expect(narrow.detect(pluck(midiToHz(62)), SAMPLE_RATE).hz).not.toBeNull(); // D4, 294Hz
  });
});
