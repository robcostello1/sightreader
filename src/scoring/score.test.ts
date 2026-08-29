import { describe, expect, it } from 'vitest';
import {
  expectedSampleCount,
  isScorableAtTempo,
  scoreExercise,
  scoreWindow,
  summarise,
} from './score';
import { buildSchedule } from '../scheduler/schedule';
import { DEFAULT_SCORING } from '../config/levels';
import { midiToHz } from '../lib/pitch';
import { NOTE_VALUES } from '../lib/types';
import { keyByName } from '../lib/key';
import type { Exercise, ExerciseNote, NoteWindow, PitchSample } from '../lib/types';

const HOP_MS = 512 / 44.1;

const note = (value: number, midi: number | null = 60): ExerciseNote => ({
  midi,
  value,
  idiomId: 'test',
  instance: 0,
});

function exercise(notes: ExerciseNote[], bpm = 60): Exercise {
  return { notes, keyCenter: 60, key: keyByName('C'), timeSignature: [4, 4], bpm };
}

const SCHEDULE_OPTIONS = {
  startMs: 0,
  countInBars: 1,
  clickThroughExercise: false,
  attackGuardMs: DEFAULT_SCORING.attackGuardMs,
};

/** Fills a window's scoring zone with hops, choosing each sample by callback. */
function fillZone(
  window: NoteWindow,
  pick: (index: number) => Partial<PitchSample>,
): PitchSample[] {
  const samples: PitchSample[] = [];
  let index = 0;
  for (let t = window.scoreFromMs; t < window.endMs; t += HOP_MS) {
    samples.push({ hz: null, confidence: 0, timestamp: t, ...pick(index++) });
  }
  return samples;
}

const played = (midi: number, confidence = 0.95) => () => ({ hz: midiToHz(midi), confidence });

function singleNoteWindow(value = NOTE_VALUES.whole, midi: number | null = 60): NoteWindow {
  return buildSchedule(exercise([note(value, midi)]), SCHEDULE_OPTIONS).windows[0];
}

describe('scoreWindow', () => {
  it('passes a note held for the whole window', () => {
    const window = singleNoteWindow();
    const result = scoreWindow(window, fillZone(window, played(60)), DEFAULT_SCORING);
    expect(result).toMatchObject({ passed: true, verdict: 'pass', occupancy: 1 });
  });

  it('passes when occupancy clears the threshold despite a shaky start', () => {
    const window = singleNoteWindow();
    // First 25% wrong, rest correct — above the 0.65 default.
    const samples = fillZone(window, (i) => played(i < 8 ? 62 : 60)());
    const result = scoreWindow(window, samples, DEFAULT_SCORING);
    expect(result.occupancy).toBeGreaterThan(DEFAULT_SCORING.passThreshold);
    expect(result.passed).toBe(true);
  });

  it('fails as silence when nothing confident was played', () => {
    const window = singleNoteWindow();
    const result = scoreWindow(window, fillZone(window, () => ({})), DEFAULT_SCORING);
    expect(result).toMatchObject({ passed: false, verdict: 'silence', sampleCount: 0 });
  });

  it('fails as wrong-pitch when a different note was held', () => {
    const window = singleNoteWindow();
    const result = scoreWindow(window, fillZone(window, played(62)), DEFAULT_SCORING);
    expect(result).toMatchObject({ passed: false, verdict: 'wrong-pitch', occupancy: 0 });
  });

  it('excludes low-confidence frames instead of counting them wrong', () => {
    const window = singleNoteWindow();
    // Half the frames are unvoiced; every confident one is correct.
    const samples = fillZone(window, (i) =>
      i % 2 === 0 ? played(60)() : { hz: midiToHz(62), confidence: 0.1 },
    );
    const result = scoreWindow(window, samples, DEFAULT_SCORING);
    expect(result.passed).toBe(true);
    expect(result.occupancy).toBe(1);
  });

  it('reports unclear when no pitch dominates, as with a double stop', () => {
    const window = singleNoteWindow();
    // Target and a bleeding open string alternate; neither takes the window.
    const samples = fillZone(window, (i) => played(i % 2 === 0 ? 60 : 64)());
    const result = scoreWindow(window, samples, DEFAULT_SCORING);
    expect(result.verdict).toBe('unclear');
    expect(result.passed).toBe(false);
  });

  it('calls a decisive wrong note wrong-pitch, not unclear', () => {
    const window = singleNoteWindow();
    const samples = fillZone(window, (i) => played(i < 2 ? 60 : 64)());
    expect(scoreWindow(window, samples, DEFAULT_SCORING).verdict).toBe('wrong-pitch');
  });

  it('marks a window too short for the hop rate as unscorable', () => {
    // Demisemiquaver at 200bpm leaves almost nothing after the attack guard.
    const window = buildSchedule(exercise([note(1 / 32)], 200), SCHEDULE_OPTIONS).windows[0];
    expect(expectedSampleCount(window, HOP_MS)).toBeLessThan(DEFAULT_SCORING.minSamples);
    const result = scoreWindow(window, fillZone(window, played(60)), DEFAULT_SCORING);
    expect(result).toMatchObject({ passed: false, verdict: 'unscorable' });
  });

  it('ignores samples before the attack guard', () => {
    const window = singleNoteWindow();
    const early: PitchSample[] = [
      { hz: midiToHz(50), confidence: 0.99, timestamp: window.startMs + 5 },
      ...fillZone(window, played(60)),
    ];
    // The stray pick-noise reading sits inside the window but before scoreFromMs.
    expect(scoreWindow(window, early, DEFAULT_SCORING).occupancy).toBe(1);
  });

  it('ignores samples belonging to neighbouring notes', () => {
    const schedule = buildSchedule(
      exercise([note(NOTE_VALUES.half, 60), note(NOTE_VALUES.half, 62)]),
      SCHEDULE_OPTIONS,
    );
    const samples = [
      ...fillZone(schedule.windows[0], played(60)),
      ...fillZone(schedule.windows[1], played(62)),
    ];
    expect(scoreExercise(schedule, samples, DEFAULT_SCORING).every((r) => r.passed)).toBe(true);
  });
});

describe('rests', () => {
  const window = singleNoteWindow(NOTE_VALUES.whole, null);

  it('passes a rest that is actually silent', () => {
    expect(scoreWindow(window, fillZone(window, () => ({})), DEFAULT_SCORING).passed).toBe(true);
  });

  it('does not penalise sustain through a rest by default', () => {
    const result = scoreWindow(window, fillZone(window, played(60)), DEFAULT_SCORING);
    expect(result.passed).toBe(true);
    // The occupancy is still reported, so the policy can change without a reshape.
    expect(result.occupancy).toBe(0);
  });

  it('fails a rung-through rest when penalisation is switched on', () => {
    const strict = { ...DEFAULT_SCORING, penaliseSustainThroughRest: true };
    expect(scoreWindow(window, fillZone(window, played(60)), strict).passed).toBe(false);
    expect(scoreWindow(window, fillZone(window, () => ({})), strict).passed).toBe(true);
  });
});

describe('isScorableAtTempo', () => {
  const scorable = (value: number, bpm: number) =>
    isScorableAtTempo(value, 4, bpm, DEFAULT_SCORING, HOP_MS);

  it('accepts ordinary note values at ordinary tempos', () => {
    expect(scorable(NOTE_VALUES.quarter, 60)).toBe(true);
    expect(scorable(NOTE_VALUES.eighth, 120)).toBe(true);
  });

  it('rejects notes too brief for the hop rate', () => {
    // The attack guard eats the head of the window and the detector reports
    // once per hop, so a semiquaver at 240 has almost nothing left to judge.
    expect(scorable(NOTE_VALUES.sixteenth, 240)).toBe(false);
  });

  it('is a tempo ceiling, not a cliff at one value', () => {
    expect(scorable(NOTE_VALUES.sixteenth, 120)).toBe(true);
    expect(scorable(NOTE_VALUES.sixteenth, 200)).toBe(false);
  });

  it('agrees with what the scorer actually does', () => {
    // A window the helper calls unscorable must really come back unscorable.
    const fast = exercise([note(NOTE_VALUES.sixteenth)], 240);
    const window = buildSchedule(fast, SCHEDULE_OPTIONS).windows[0];
    expect(scorable(NOTE_VALUES.sixteenth, 240)).toBe(false);
    expect(expectedSampleCount(window, HOP_MS)).toBeLessThan(DEFAULT_SCORING.minSamples);
    expect(scoreWindow(window, fillZone(window, played(60)), DEFAULT_SCORING).verdict).toBe(
      'unscorable',
    );
  });
});

describe('summarise', () => {
  it('excludes unscorable windows from accuracy', () => {
    const summary = summarise([
      { index: 0, passed: true, verdict: 'pass', occupancy: 1, sampleCount: 10 },
      { index: 1, passed: false, verdict: 'wrong-pitch', occupancy: 0, sampleCount: 10 },
      { index: 2, passed: false, verdict: 'unscorable', occupancy: 0, sampleCount: 1 },
    ]);
    // 1 of 2 scorable, not 1 of 3 — the tempo outran the detector on the third.
    expect(summary).toEqual({ total: 3, passed: 1, accuracy: 0.5, unscorable: 1 });
  });

  it('reports zero accuracy rather than NaN when nothing was scorable', () => {
    expect(summarise([{ index: 0, passed: false, verdict: 'unscorable', occupancy: 0, sampleCount: 0 }]).accuracy).toBe(0);
  });
});
