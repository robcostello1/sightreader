import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME_SIZE, PitchyDetector, computeRms } from './detector';
import { DETECTOR_MAX_HZ, DETECTOR_MIN_HZ } from './constants';
import { DEFAULT_VIABILITY } from '../config/viability';
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

  it('hears everything the generator is willing to write', () => {
    // These two were an octave apart, so the generator wrote notes the
    // detector discarded before scoring — silently, as an unplayed note. They
    // are the same physical limit and must be the same number.
    expect(DEFAULT_VIABILITY.resolutionFloorHz).toBe(DETECTOR_MIN_HZ);

    expect(DEFAULT_VIABILITY.resolutionCeilingHz).toBe(DETECTOR_MAX_HZ);

    // C1 is the lowest note the frame can resolve at 44.1kHz; B0 is not.
    const detector = new PitchyDetector();
    expect(midiToHz(24)).toBeGreaterThan(DETECTOR_MIN_HZ); // C1, 32.7Hz
    expect(midiToHz(23)).toBeLessThan(DETECTOR_MIN_HZ); // B0, 30.9Hz
    expect(detector.detect(pluck(midiToHz(24)), SAMPLE_RATE).hz).not.toBeNull();

    // And G#7 is the highest; above it the reading comes back an octave flat.
    expect(midiToHz(104)).toBeLessThan(DETECTOR_MAX_HZ); // G#7, 3322Hz
    expect(midiToHz(105)).toBeGreaterThan(DETECTOR_MAX_HZ); // A7, 3520Hz
  });

  it('narrows the band when the hardware opens at a higher rate', () => {
    // The same frame spans less time at 48kHz, so it holds 1.5 cycles of a
    // higher pitch than it does at 44.1kHz: C1 is nameable at one rate and not
    // the other, and a device opening at 48kHz simply loses it.
    const detector = new PitchyDetector();
    expect(detector.bandAt(44100).minHz).toBeCloseTo(DETECTOR_MIN_HZ, 6);
    expect(detector.bandAt(48000).minHz).toBeGreaterThan(midiToHz(24)); // above C1
    expect(detector.bandAt(44100).minHz).toBeLessThan(midiToHz(24));
  });

  it('never widens past the band the generator writes to', () => {
    // A higher rate would resolve a little higher too, but the generator works
    // to the nominal band, so nothing is ever written up there. Widening would
    // only admit readings from a region nothing asks about — and just past the
    // ceiling they come back an octave flat, which is worse than silence.
    const detector = new PitchyDetector();
    expect(detector.bandAt(48000).maxHz).toBe(DETECTOR_MAX_HZ);
    expect(detector.bandAt(44100).maxHz).toBe(DETECTOR_MAX_HZ);
  });

  it('keeps an explicitly narrow band narrow', () => {
    // Deriving from the rate must widen nothing a caller deliberately pinched.
    const narrow = new PitchyDetector({ minHz: 200, maxHz: 400 });
    expect(narrow.bandAt(44100)).toEqual({ minHz: 200, maxHz: 400 });
  });
});
