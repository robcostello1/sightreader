// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { levelConfig } from '../config/levels';
import { midiToHz } from '../lib/pitch';
import type { MicCaptureOptions, MicSession } from '../audio/capture';
import type { PitchSample } from '../lib/types';

// The metronome needs a real AudioContext; everything else under test is pure.
vi.mock('../scheduler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scheduler')>()),
  scheduleClicks: () => ({ stop: () => {} }),
}));

const startMicCapture = vi.hoisted(() => vi.fn());
vi.mock('../audio', () => ({ startMicCapture, isMicCaptureSupported: () => true }));

const { useLesson } = await import('./useLesson');
const { buildSchedule } = await import('../scheduler');

const HOP_MS = 512 / 44.1;
const LEAD_IN = 300;

let clock: { currentTime: number };
let emit: MicCaptureOptions['onSample'];
let stopped: boolean;

beforeEach(() => {
  // rAF drives the lesson loop, so it has to be under the test's control.
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  clock = { currentTime: 0 };
  stopped = false;
  startMicCapture.mockImplementation(async (options: MicCaptureOptions): Promise<MicSession> => {
    emit = options.onSample;
    return {
      context: clock as unknown as AudioContext,
      sampleRate: 44100,
      stop: async () => {
        stopped = true;
      },
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Lets the mic promise settle without waiting on real time. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Advances the AudioContext clock and pumps enough frames for the loop to see it. */
async function advanceTo(ms: number) {
  clock.currentTime = ms / 1000;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}

const LEVEL = 1;
const CONFIG = levelConfig(LEVEL);

function renderLesson(level = LEVEL) {
  return renderHook(() => useLesson({ level, leadInMs: LEAD_IN }));
}

async function startAndGetSchedule(result: { current: ReturnType<typeof useLesson> }) {
  act(() => result.current.start());
  await flush();
  expect(result.current.phase).toBe('count-in');
  return buildSchedule(result.current.exercise!, {
    startMs: LEAD_IN,
    countInBars: CONFIG.countInBars,
    clickThroughExercise: CONFIG.clickThroughExercise,
    attackGuardMs: CONFIG.scoring.attackGuardMs,
  });
}

describe('useLesson', () => {
  it('generates an exercise and waits for the count-in before playing', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    expect(result.current.exercise!.notes.length).toBeGreaterThan(0);
    expect(result.current.seed).not.toBeNull();

    await advanceTo(schedule.t0 - 500);
    expect(result.current.phase).toBe('count-in');
    expect(result.current.beatsUntilStart).toBeGreaterThan(0);

    await advanceTo(schedule.t0 + 10);
    expect(result.current.phase).toBe('playing');
  });

  it('scores each window as it closes rather than all at the end', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    // Play the first note correctly, then stop halfway through the exercise.
    const first = schedule.windows[0];
    const samples: PitchSample[] = [];
    for (let t = first.scoreFromMs; t < first.endMs; t += HOP_MS) {
      samples.push({ hz: midiToHz(first.note.midi!), confidence: 0.95, timestamp: t });
    }
    act(() => samples.forEach((s) => emit(s)));

    await advanceTo(first.endMs + 10);
    // Results exist before the exercise is over.
    expect(result.current.phase).toBe('playing');
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0]).toMatchObject({ index: 0, passed: true });
  });

  it('passes every note when the exercise is played correctly', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    for (const window of schedule.windows) {
      if (window.note.midi === null) continue;
      act(() => {
        for (let t = window.scoreFromMs; t < window.endMs; t += HOP_MS) {
          emit({ hz: midiToHz(window.note.midi!), confidence: 0.95, timestamp: t });
        }
      });
    }

    await advanceTo(schedule.endMs + 10);
    expect(result.current.phase).toBe('results');
    expect(result.current.summary!.accuracy).toBe(1);
    expect(result.current.results).toHaveLength(schedule.windows.length);
  });

  it('fails notes as silence when the player stays quiet', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    // A live mic still emits samples while nobody plays — unvoiced, not absent.
    for (const window of schedule.windows) {
      act(() => {
        for (let t = window.scoreFromMs; t < window.endMs; t += HOP_MS) {
          emit({ hz: null, confidence: 0, timestamp: t });
        }
      });
    }

    await advanceTo(schedule.endMs + 10);
    expect(result.current.phase).toBe('results');
    expect(result.current.summary!.passed).toBe(0);
    expect(result.current.results.every((r) => r.verdict === 'silence')).toBe(true);
  });

  it('reports unscorable rather than silence when no samples arrive at all', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    // Distinct from a quiet player: this is the detector producing nothing.
    await advanceTo(schedule.endMs + 10);
    expect(result.current.results.every((r) => r.verdict === 'unscorable')).toBe(true);
    expect(result.current.summary!.accuracy).toBe(0);
  });

  it('flags a note played during the count-in as a false start', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    act(() => emit({ hz: midiToHz(60), confidence: 0.95, timestamp: schedule.t0 - 1000 }));
    await advanceTo(schedule.t0 + 10);

    expect(result.current.falseStart).not.toBeNull();
    // Flagged, not scored: the first window is still judged on its own samples.
    expect(result.current.results).toHaveLength(0);
  });

  it('releases the microphone once the exercise finishes', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    await advanceTo(schedule.endMs + 10);
    expect(result.current.phase).toBe('results');
    expect(stopped).toBe(true);
  });

  it('releases the microphone when stopped early', async () => {
    const { result } = renderLesson();
    await startAndGetSchedule(result);

    act(() => result.current.stop());
    expect(stopped).toBe(true);
    expect(result.current.phase).toBe('idle');
  });

  it('surfaces a microphone failure instead of hanging', async () => {
    startMicCapture.mockRejectedValueOnce(new Error('Permission denied'));
    const { result } = renderLesson();

    act(() => result.current.start());
    await flush();
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('Permission denied');
  });
});
