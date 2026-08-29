import { describe, expect, it } from 'vitest';
import { ONSET_PRESETS, SpectralFluxOnsetDetector } from './onset';
import { DEFAULT_FRAME_SIZE, DEFAULT_HOP_SIZE } from './detector';
import { midiToHz } from '../lib/pitch';
import type { OnsetEvent } from '../lib/types';

const SAMPLE_RATE = 44100;

interface Note {
  midi: number;
  startMs: number;
}

/**
 * Renders plucked notes with a ~2ms attack and exponential decay. Each note is
 * damped when the next begins, matching ordinary single-string melodic playing.
 */
function renderMelody(notes: Note[], durationMs: number): Float32Array {
  const signal = new Float32Array(Math.ceil((durationMs / 1000) * SAMPLE_RATE));
  notes.forEach((note, index) => {
    const start = Math.floor((note.startMs / 1000) * SAMPLE_RATE);
    const end =
      index + 1 < notes.length
        ? Math.floor((notes[index + 1].startMs / 1000) * SAMPLE_RATE)
        : signal.length;
    const hz = midiToHz(note.midi);
    for (let i = start; i < end; i++) {
      const t = (i - start) / SAMPLE_RATE;
      const envelope = Math.exp(-t / 0.45) * (1 - Math.exp(-t / 0.002));
      for (let h = 1; h <= 6; h++) {
        signal[i] += (0.5 / h) * envelope * Math.sin(2 * Math.PI * hz * h * t);
      }
    }
  });
  return signal;
}

/** Drives the detector hop by hop exactly as the worklet does. */
function detectOnsets(signal: Float32Array, detector = new SpectralFluxOnsetDetector()): OnsetEvent[] {
  const frame = new Float32Array(DEFAULT_FRAME_SIZE);
  const onsets: OnsetEvent[] = [];
  for (let end = DEFAULT_FRAME_SIZE; end <= signal.length; end += DEFAULT_HOP_SIZE) {
    frame.set(signal.subarray(end - DEFAULT_FRAME_SIZE, end));
    const timestamp = ((end - DEFAULT_FRAME_SIZE / 2) / SAMPLE_RATE) * 1000;
    const onset = detector.push(frame, timestamp);
    if (onset) onsets.push(onset);
  }
  return onsets;
}

describe('SpectralFluxOnsetDetector', () => {
  it('finds every attack in a melody, within a hop of the true time', () => {
    const starts = [200, 450, 700, 950, 1200, 1450, 1700, 1950];
    const midis = [45, 47, 49, 49, 50, 52, 50, 45];
    const onsets = detectOnsets(
      renderMelody(starts.map((startMs, i) => ({ midi: midis[i], startMs })), 2600),
    );

    for (const start of starts) {
      const nearest = onsets.reduce((best, o) =>
        Math.abs(o.timestamp - start) < Math.abs(best.timestamp - start) ? o : best,
      );
      expect(Math.abs(nearest.timestamp - start)).toBeLessThan(30);
    }
    // A couple of spurious peaks are tolerable; the scorer uses the tempo clock
    // for note windows and treats onsets as corroboration, not ground truth.
    expect(onsets.length).toBeLessThanOrEqual(starts.length + 2);
  });

  it('detects a re-pluck at the same pitch', () => {
    // The "repeated note" rhythm drill. A plain energy derivative would miss
    // this while the string is still ringing; half-wave rectified flux does not.
    const onsets = detectOnsets(
      renderMelody([{ midi: 45, startMs: 200 }, { midi: 45, startMs: 700 }], 1300),
    );
    expect(onsets.filter((o) => Math.abs(o.timestamp - 200) < 30)).toHaveLength(1);
    expect(onsets.filter((o) => Math.abs(o.timestamp - 700) < 30)).toHaveLength(1);
  });

  it('reports nothing for silence', () => {
    expect(detectOnsets(new Float32Array(SAMPLE_RATE))).toHaveLength(0);
  });

  it('scores a hard attack above a soft one', () => {
    const hard = detectOnsets(renderMelody([{ midi: 45, startMs: 200 }], 900));
    const softSignal = renderMelody([{ midi: 45, startMs: 200 }], 900).map((s) => s * 0.25) as Float32Array;
    const soft = detectOnsets(softSignal);
    expect(hard[0].strength).toBeGreaterThan(soft[0].strength);
  });

  it('debounces re-articulation faster than minIntervalMs', () => {
    const onsets = detectOnsets(
      renderMelody([{ midi: 45, startMs: 200 }, { midi: 45, startMs: 215 }], 900),
      new SpectralFluxOnsetDetector({ minIntervalMs: 80 }),
    );
    // Both attacks collapse to a single onset; later decay ripple is not this test's concern.
    expect(onsets.filter((o) => o.timestamp > 150 && o.timestamp < 280)).toHaveLength(1);
  });

  it('exposes a tunable threshold per instrument', () => {
    // Distortion compresses dynamics, so it must trigger on a smaller relative rise.
    expect(ONSET_PRESETS['electric-distorted'].thresholdMultiplier).toBeLessThan(
      ONSET_PRESETS['acoustic-pick'].thresholdMultiplier,
    );
    const sensitive = detectOnsets(
      renderMelody([{ midi: 45, startMs: 200 }], 900),
      new SpectralFluxOnsetDetector(ONSET_PRESETS['electric-distorted']),
    );
    expect(sensitive.length).toBeGreaterThan(0);
  });
});
