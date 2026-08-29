import { matchesTarget, nearestMidi } from '../lib/pitch';
import type { ScoringConfig } from '../config/tiers';
import type { Midi, NoteResult, NoteWindow, PitchSample } from '../lib/types';
import type { Schedule } from '../scheduler/schedule';

/**
 * Samples expected to land in a window's scoring zone at a given hop rate. Below
 * ScoringConfig.minSamples the window cannot be judged, which is what caps the
 * fastest tempo/note-value combination the app can score.
 */
export function expectedSampleCount(window: NoteWindow, hopMs: number): number {
  return Math.floor((window.endMs - window.scoreFromMs) / hopMs);
}

/** Share of confident samples sitting on each detected semitone. */
function pitchHistogram(samples: readonly PitchSample[]): Map<Midi, number> {
  const counts = new Map<Midi, number>();
  for (const sample of samples) {
    const midi = nearestMidi(sample.hz!);
    counts.set(midi, (counts.get(midi) ?? 0) + 1);
  }
  return counts;
}

/**
 * Scores one note window by occupancy: what fraction of the confident pitch
 * samples in its scoring zone were the target note. Binary pass/fail in v1,
 * though the verdict carries the fail mode for later diagnostics.
 *
 * Low-confidence frames are excluded rather than counted as wrong — an unvoiced
 * frame is an absence of evidence, not evidence of a wrong note.
 */
export function scoreWindow(
  window: NoteWindow,
  samples: readonly PitchSample[],
  config: ScoringConfig,
): NoteResult {
  const zone = samples.filter(
    (s) => s.timestamp >= window.scoreFromMs && s.timestamp < window.endMs,
  );
  const confident = zone.filter((s) => s.hz !== null && s.confidence >= config.confidenceGate);

  if (window.note.midi === null) return scoreRest(window, zone, confident, config);

  // Judged on the whole zone, not just the confident frames: a window with no
  // samples at all is unscorable, whereas one full of silence is a real miss.
  if (zone.length < config.minSamples) {
    return { index: window.index, passed: false, verdict: 'unscorable', occupancy: 0, sampleCount: zone.length };
  }

  if (confident.length === 0) {
    return { index: window.index, passed: false, verdict: 'silence', occupancy: 0, sampleCount: 0 };
  }

  const target = window.note.midi;
  const matches = confident.filter((s) => matchesTarget(s.hz!, target, config.toleranceCents));
  const occupancy = matches.length / confident.length;

  if (occupancy >= config.passThreshold) {
    return { index: window.index, passed: true, verdict: 'pass', occupancy, sampleCount: confident.length };
  }

  return {
    index: window.index,
    passed: false,
    verdict: classifyFailure(confident, occupancy, config),
    occupancy,
    sampleCount: confident.length,
  };
}

/**
 * Distinguishes "played the wrong note" from "more than one string was
 * sounding". With only the pitch stream to go on, the signature of a double stop
 * or a bleeding open string is that no single pitch ever dominates the window.
 *
 * The spec's cheaper alternative — spectral flatness or inharmonicity as a
 * polyphony proxy — is not implemented: it needs a signal-level feature from the
 * worklet, and keeping the scorer dependent only on the pitch stream is what
 * lets the detector be swapped without touching this code.
 */
function classifyFailure(
  confident: readonly PitchSample[],
  occupancy: number,
  config: ScoringConfig,
): 'wrong-pitch' | 'unclear' {
  const histogram = pitchHistogram(confident);
  const shares = [...histogram.values()].map((count) => count / confident.length);
  const dominant = Math.max(...shares, occupancy);
  const contenders = shares.filter((share) => share >= 0.2).length;
  return dominant < config.passThreshold && contenders >= 2 ? 'unclear' : 'wrong-pitch';
}

/**
 * A rest asks "did the previous note stop ringing", not "was a pitch present".
 * v1 does not penalise sustain through a rest by default, but the occupancy is
 * still reported so the behaviour can be revisited without changing the shape.
 */
function scoreRest(
  window: NoteWindow,
  zone: readonly PitchSample[],
  confident: readonly PitchSample[],
  config: ScoringConfig,
): NoteResult {
  const silence = zone.length === 0 ? 1 : (zone.length - confident.length) / zone.length;

  if (!config.penaliseSustainThroughRest) {
    return { index: window.index, passed: true, verdict: 'pass', occupancy: silence, sampleCount: zone.length };
  }
  if (zone.length < config.minSamples) {
    return { index: window.index, passed: false, verdict: 'unscorable', occupancy: silence, sampleCount: zone.length };
  }
  const passed = silence >= config.passThreshold;
  return {
    index: window.index,
    passed,
    verdict: passed ? 'pass' : 'wrong-pitch',
    occupancy: silence,
    sampleCount: zone.length,
  };
}

export function scoreExercise(
  schedule: Schedule,
  samples: readonly PitchSample[],
  config: ScoringConfig,
): NoteResult[] {
  return schedule.windows.map((window) => scoreWindow(window, samples, config));
}

export interface ExerciseSummary {
  total: number;
  passed: number;
  /** Passed as a fraction of windows that could be scored at all. */
  accuracy: number;
  unscorable: number;
}

/**
 * Accuracy deliberately excludes unscorable windows: they say the tempo outran
 * the detector, not that the player got anything wrong, and folding them in
 * would corrupt the mastery signal that gates progression.
 */
export function summarise(results: readonly NoteResult[]): ExerciseSummary {
  const unscorable = results.filter((r) => r.verdict === 'unscorable').length;
  const scorable = results.length - unscorable;
  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    accuracy: scorable === 0 ? 0 : passed / scorable,
    unscorable,
  };
}
