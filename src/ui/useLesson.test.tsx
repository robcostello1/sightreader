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
  startMicCapture.mockClear();
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

const ADVANCE_MS = 200;

function renderLesson(level = LEVEL, autoAdvance = false) {
  return renderHook(() =>
    useLesson({ level, leadInMs: LEAD_IN, autoAdvance, advanceDelayMs: ADVANCE_MS }),
  );
}

/** Plays every window of a schedule correctly. */
function playCorrectly(schedule: ReturnType<typeof buildSchedule>) {
  for (const window of schedule.windows) {
    if (window.note.midi === null) continue;
    act(() => {
      for (let t = window.scoreFromMs; t < window.endMs; t += HOP_MS) {
        emit({ hz: midiToHz(window.note.midi!), confidence: 0.95, timestamp: t });
      }
    });
  }
}

async function startAndGetSchedule(result: { current: ReturnType<typeof useLesson> }) {
  act(() => result.current.start());
  await flush();
  expect(result.current.phase).toBe('count-in');
  return buildSchedule(result.current.exercise!, {
    startMs: LEAD_IN,
    countInBars: CONFIG.countInBars,
    clickThroughExercise: false, // clicks are mocked out; irrelevant to windows
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

  it('keeps the microphone open once an exercise finishes', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    await advanceTo(schedule.endMs + 10);
    expect(result.current.phase).toBe('results');
    // Reopening would cost another getUserMedia round trip, and a fresh
    // AudioContext can only be resumed from a user gesture.
    expect(stopped).toBe(false);
  });

  it('releases the microphone when the hook unmounts', async () => {
    const { result, unmount } = renderLesson();
    await startAndGetSchedule(result);
    unmount();
    expect(stopped).toBe(true);
  });

  it('accumulates stats across exercises in a session', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);
    playCorrectly(schedule);
    await advanceTo(schedule.endMs + 10);

    const first = result.current.stats;
    expect(first.completed).toBe(1);
    expect(first.passed).toBe(first.scorable);
    expect(first.scorable).toBeGreaterThan(0);

    // History drives progression, one accuracy per completed exercise.
    expect(result.current.history).toEqual([1]);
  });

  it('records a per-exercise accuracy even when nothing is played', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    for (const window of schedule.windows) {
      act(() => {
        for (let t = window.scoreFromMs; t < window.endMs; t += HOP_MS) {
          emit({ hz: null, confidence: 0, timestamp: t });
        }
      });
    }
    await advanceTo(schedule.endMs + 10);
    expect(result.current.history).toEqual([0]);
  });

  it('clears history when asked, so a level change starts a fresh window', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);
    playCorrectly(schedule);
    await advanceTo(schedule.endMs + 10);
    expect(result.current.history).toHaveLength(1);

    act(() => result.current.clearHistory());
    expect(result.current.history).toEqual([]);
    // Session totals are untouched — only the progression window resets.
    expect(result.current.stats.completed).toBe(1);
  });

  describe('level progression', () => {
    it('advances after enough accurate exercises, and resets the window', async () => {
      const advances: number[] = [];
      const { result } = renderHook(() =>
        useLesson({
          level: 3,
          leadInMs: LEAD_IN,
          autoAdvance: true,
          advanceDelayMs: ADVANCE_MS,
          onAdvance: (next) => advances.push(next),
        }),
      );

      // Five clean exercises is the agreed bar: 80% over 5.
      for (let i = 0; i < 5; i++) {
        act(() => result.current.start());
        await flush();
        const schedule = buildSchedule(result.current.exercise!, {
          startMs: clock.currentTime * 1000 + LEAD_IN,
          countInBars: CONFIG.countInBars,
          clickThroughExercise: false,
          attackGuardMs: CONFIG.scoring.attackGuardMs,
        });
        playCorrectly(schedule);
        await advanceTo(schedule.endMs + 10);
        if (i < 4) expect(advances).toHaveLength(0);
      }

      expect(advances).toEqual([3.1]);
      // The window rolls rather than resetting, so it stays full.
      expect(result.current.history).toHaveLength(5);
    });

    it('keeps climbing while accuracy holds up', async () => {
      const advances: number[] = [];
      const { result } = renderHook(() =>
        useLesson({ level: 3, leadInMs: LEAD_IN, onAdvance: (n) => advances.push(n) }),
      );

      // Eight clean exercises: five to fill the window, then one step each.
      for (let i = 0; i < 8; i++) {
        act(() => result.current.start());
        await flush();
        const schedule = buildSchedule(result.current.exercise!, {
          startMs: clock.currentTime * 1000 + LEAD_IN,
          countInBars: CONFIG.countInBars,
          clickThroughExercise: false,
          attackGuardMs: CONFIG.scoring.attackGuardMs,
        });
        playCorrectly(schedule);
        await advanceTo(schedule.endMs + 10);
      }

      // A rolling window keeps nudging rather than stalling for five more.
      expect(advances.length).toBeGreaterThan(1);
    });

    it('does not advance on poor accuracy', async () => {
      const advances: number[] = [];
      const { result } = renderHook(() =>
        useLesson({ level: 3, leadInMs: LEAD_IN, onAdvance: (n) => advances.push(n) }),
      );

      for (let i = 0; i < 6; i++) {
        act(() => result.current.start());
        await flush();
        const schedule = buildSchedule(result.current.exercise!, {
          startMs: clock.currentTime * 1000 + LEAD_IN,
          countInBars: CONFIG.countInBars,
          clickThroughExercise: false,
          attackGuardMs: CONFIG.scoring.attackGuardMs,
        });
        // Play nothing at all.
        act(() => {
          for (const w of schedule.windows) {
            for (let t = w.scoreFromMs; t < w.endMs; t += HOP_MS) {
              emit({ hz: null, confidence: 0, timestamp: t });
            }
          }
        });
        await advanceTo(schedule.endMs + 10);
      }

      expect(advances).toEqual([]);
      // Capped at the rolling window, not an unbounded log.
      expect(result.current.history).toHaveLength(5);
    });
  });

  describe('auto-advance', () => {
    it('starts another exercise after the results pause', async () => {
      const { result } = renderLesson(LEVEL, true);
      const schedule = await startAndGetSchedule(result);

      await advanceTo(schedule.endMs + 10);
      expect(result.current.phase).toBe('results');
      const firstSeed = result.current.seed;

      // Only after the pause, so results are readable first.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADVANCE_MS + 50);
      });
      expect(result.current.phase).toBe('count-in');
      expect(result.current.seed).not.toBe(firstSeed);
      expect(result.current.results).toHaveLength(0);
      // The same microphone session carries over.
      expect(stopped).toBe(false);
      expect(startMicCapture).toHaveBeenCalledTimes(1);
    });

    it('counts each completed exercise', async () => {
      const { result } = renderLesson(LEVEL, true);
      let schedule = await startAndGetSchedule(result);

      playCorrectly(schedule);
      await advanceTo(schedule.endMs + 10);
      expect(result.current.stats.completed).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADVANCE_MS + 50);
      });
      schedule = buildSchedule(result.current.exercise!, {
        startMs: clock.currentTime * 1000 + LEAD_IN,
        countInBars: CONFIG.countInBars,
        clickThroughExercise: false, // clicks are mocked out; irrelevant to windows
        attackGuardMs: CONFIG.scoring.attackGuardMs,
      });
      await advanceTo(schedule.endMs + 10);
      expect(result.current.stats.completed).toBe(2);
    });

    it('does not advance when switched off', async () => {
      const { result } = renderLesson(LEVEL, false);
      const schedule = await startAndGetSchedule(result);

      await advanceTo(schedule.endMs + 10);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADVANCE_MS * 5);
      });
      expect(result.current.phase).toBe('results');
    });

    it('stops advancing once the session is stopped', async () => {
      const { result } = renderLesson(LEVEL, true);
      const schedule = await startAndGetSchedule(result);

      await advanceTo(schedule.endMs + 10);
      act(() => result.current.stop());
      expect(stopped).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADVANCE_MS * 5);
      });
      expect(result.current.phase).toBe('idle');
    });
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
