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
const startSilentSession = vi.hoisted(() => vi.fn());
vi.mock('../audio', () => ({
  startMicCapture,
  startSilentSession,
  isMicCaptureSupported: () => true,
}));

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
  startSilentSession.mockClear();
  startSilentSession.mockImplementation(
    async (): Promise<MicSession> => ({
      context: clock as unknown as AudioContext,
      analyser: { fftSize: 1024 } as unknown as AnalyserNode,
      sampleRate: 44100,
      stop: async () => {
        stopped = true;
      },
    }),
  );
  startMicCapture.mockImplementation(async (options: MicCaptureOptions): Promise<MicSession> => {
    emit = options.onSample;
    return {
      context: clock as unknown as AudioContext,
      analyser: { fftSize: 1024 } as unknown as AnalyserNode,
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

  it('generates each exercise at the tempo in force when it starts', async () => {
    // Viability depends on tempo, so an exercise built at one tempo and played
    // at another would be gated against the wrong number. Nothing is generated
    // ahead of time: every exercise is built at the moment it begins, which is
    // what makes a mid-session tempo change safe without re-checking anything.
    const { result, rerender } = renderHook(
      ({ bpm }) => useLesson({ level: LEVEL, bpm, leadInMs: LEAD_IN }),
      { initialProps: { bpm: 60 } },
    );

    act(() => result.current.start());
    await flush();
    expect(result.current.exercise!.bpm).toBe(60);

    rerender({ bpm: 120 });
    act(() => result.current.start());
    await flush();
    expect(result.current.exercise!.bpm).toBe(120);
  });

  it('uses the requested tempo for the exercise and its count-in', async () => {
    const { result } = renderHook(() => useLesson({ level: 1, bpm: 120, leadInMs: LEAD_IN }));
    act(() => result.current.start());
    await flush();

    expect(result.current.exercise!.bpm).toBe(120);
    const schedule = buildSchedule(result.current.exercise!, {
      startMs: LEAD_IN,
        clickThroughExercise: false,
      attackGuardMs: CONFIG.scoring.attackGuardMs,
    });
    // Four beats of count-in at 120bpm is two seconds, half of what 60 gives.
    expect(schedule.t0 - schedule.startMs).toBeCloseTo(2000, 6);
    expect(schedule.beatMs).toBe(500);
  });

  it('ignores anything played during the count-in', async () => {
    const { result } = renderLesson();
    const schedule = await startAndGetSchedule(result);

    // Loudly playing the wrong note throughout the count-in.
    act(() => {
      for (let t = schedule.startMs; t < schedule.t0; t += HOP_MS) {
        emit({ hz: midiToHz(60), confidence: 0.99, timestamp: t });
      }
    });
    // Then the exercise itself, played correctly.
    playCorrectly(schedule);
    await advanceTo(schedule.endMs + 10);

    // Not scored, not classified, not held against the reading.
    expect(result.current.summary!.accuracy).toBe(1);
    expect(result.current.history).toEqual([1]);
  });

  describe('pause', () => {
    it('holds the gap before the next exercise', async () => {
      const { result } = renderLesson(LEVEL, true);
      const schedule = await startAndGetSchedule(result);
      await advanceTo(schedule.endMs + 10);
      expect(result.current.phase).toBe('results');

      act(() => result.current.pause());
      expect(result.current.paused).toBe(true);

      // The next exercise does not arrive while held.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADVANCE_MS * 5);
      });
      expect(result.current.phase).toBe('results');
    });

    it('picks up again on resume', async () => {
      const { result } = renderLesson(LEVEL, true);
      const schedule = await startAndGetSchedule(result);
      await advanceTo(schedule.endMs + 10);

      act(() => result.current.pause());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADVANCE_MS * 3);
      });

      act(() => result.current.resume());
      expect(result.current.paused).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADVANCE_MS + 50);
      });
      expect(result.current.phase).toBe('count-in');
    });

    it('does nothing mid-exercise, where there is no coherent place to stop', async () => {
      const { result } = renderLesson(LEVEL, true);
      const schedule = await startAndGetSchedule(result);
      await advanceTo(schedule.t0 + 10);
      expect(result.current.phase).toBe('playing');

      act(() => result.current.pause());
      expect(result.current.paused).toBe(false);
    });
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
                clickThroughExercise: false,
          attackGuardMs: CONFIG.scoring.attackGuardMs,
        });
        playCorrectly(schedule);
        await advanceTo(schedule.endMs + 10);
        if (i < 4) expect(advances).toHaveLength(0);
      }

      expect(advances).toEqual([3.1]);
      // The count starts again, so the next step is earned at the new level.
      expect(result.current.history).toEqual([]);
    });

    it('requires a full window at the new level before stepping again', async () => {
      const advances: number[] = [];
      const { result } = renderHook(() =>
        useLesson({ level: 3, leadInMs: LEAD_IN, onAdvance: (n) => advances.push(n) }),
      );

      // Nine clean exercises: five earn the first step, four are not yet enough
      // for the second.
      for (let i = 0; i < 9; i++) {
        act(() => result.current.start());
        await flush();
        const schedule = buildSchedule(result.current.exercise!, {
          startMs: clock.currentTime * 1000 + LEAD_IN,
                clickThroughExercise: false,
          attackGuardMs: CONFIG.scoring.attackGuardMs,
        });
        playCorrectly(schedule);
        await advanceTo(schedule.endMs + 10);
      }

      expect(advances).toEqual([3.1]);
    });

    it('steps again once another full window is earned', async () => {
      const advances: number[] = [];
      const { result } = renderHook(() =>
        useLesson({ level: 3, leadInMs: LEAD_IN, onAdvance: (n) => advances.push(n) }),
      );

      for (let i = 0; i < 10; i++) {
        act(() => result.current.start());
        await flush();
        const schedule = buildSchedule(result.current.exercise!, {
          startMs: clock.currentTime * 1000 + LEAD_IN,
                clickThroughExercise: false,
          attackGuardMs: CONFIG.scoring.attackGuardMs,
        });
        playCorrectly(schedule);
        await advanceTo(schedule.endMs + 10);
      }

      expect(advances).toHaveLength(2);
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

  describe('milestones', () => {
    it('pauses on crossing a whole level so the new ideas can be read', async () => {
      const advances: number[] = [];
      const { result } = renderHook(() =>
        useLesson({
          level: 3.9,
          leadInMs: LEAD_IN,
          autoAdvance: true,
          advanceDelayMs: ADVANCE_MS,
          onAdvance: (n) => advances.push(n),
        }),
      );

      for (let i = 0; i < 5; i++) {
        act(() => result.current.start());
        await flush();
        const schedule = buildSchedule(result.current.exercise!, {
          startMs: clock.currentTime * 1000 + LEAD_IN,
                clickThroughExercise: false,
          attackGuardMs: CONFIG.scoring.attackGuardMs,
        });
        playCorrectly(schedule);
        await advanceTo(schedule.endMs + 10);
      }

      expect(advances).toEqual([4]);
      expect(result.current.milestone).toBe(4);

      // Auto-advance is held back, so the panel is not skipped past.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADVANCE_MS * 5);
      });
      expect(result.current.milestone).toBe(4);
      expect(result.current.phase).toBe('results');
    });

    it('picks the session back up when acknowledged', async () => {
      const { result } = renderHook(() =>
        useLesson({ level: 3.9, leadInMs: LEAD_IN, onAdvance: () => {} }),
      );
      for (let i = 0; i < 5; i++) {
        act(() => result.current.start());
        await flush();
        const schedule = buildSchedule(result.current.exercise!, {
          startMs: clock.currentTime * 1000 + LEAD_IN,
                clickThroughExercise: false,
          attackGuardMs: CONFIG.scoring.attackGuardMs,
        });
        playCorrectly(schedule);
        await advanceTo(schedule.endMs + 10);
      }
      expect(result.current.milestone).toBe(4);

      act(() => result.current.acknowledgeMilestone());
      expect(result.current.milestone).toBeNull();
      expect(result.current.phase).toBe('count-in');
      // Same microphone session throughout.
      expect(startMicCapture).toHaveBeenCalledTimes(1);
    });

    it('does not pause on a tenth-of-a-level step', async () => {
      const { result } = renderHook(() =>
        useLesson({ level: 3, leadInMs: LEAD_IN, onAdvance: () => {} }),
      );
      for (let i = 0; i < 5; i++) {
        act(() => result.current.start());
        await flush();
        const schedule = buildSchedule(result.current.exercise!, {
          startMs: clock.currentTime * 1000 + LEAD_IN,
                clickThroughExercise: false,
          attackGuardMs: CONFIG.scoring.attackGuardMs,
        });
        playCorrectly(schedule);
        await advanceTo(schedule.endMs + 10);
      }
      expect(result.current.milestone).toBeNull();
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

describe('without a microphone', () => {
  const UNSCORED = 10;

  function renderSilent(level = LEVEL, onAdvance?: (next: number) => void) {
    return renderHook(() =>
      useLesson({ level, scoring: false, leadInMs: LEAD_IN, advanceDelayMs: ADVANCE_MS, onAdvance }),
    );
  }

  /** Runs one exercise from start to finish, playing nothing. */
  async function readThrough(result: { current: ReturnType<typeof useLesson> }) {
    act(() => result.current.start());
    await flush();
    const schedule = buildSchedule(result.current.exercise!, {
      startMs: clock.currentTime * 1000 + LEAD_IN,
      clickThroughExercise: false,
      attackGuardMs: CONFIG.scoring.attackGuardMs,
    });
    await advanceTo(schedule.endMs + 10);
  }

  it('never opens the microphone, but still has a clock to run against', async () => {
    const { result } = renderSilent();
    act(() => result.current.start());
    await flush();

    expect(startMicCapture).not.toHaveBeenCalled();
    expect(startSilentSession).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('count-in');
    expect(result.current.exercise).not.toBeNull();
  });

  it('passes no verdict rather than failing every note', async () => {
    const { result } = renderSilent();
    await readThrough(result);

    // Silence is a verdict; the absence of a microphone is not.
    expect(result.current.phase).toBe('results');
    expect(result.current.results).toEqual([]);
    expect(result.current.summary).toBeNull();
    expect(result.current.history).toEqual([]);
  });

  it('counts the exercises read, since that is the only signal left', async () => {
    const { result } = renderSilent();
    await readThrough(result);
    await readThrough(result);

    expect(result.current.unscoredCompleted).toBe(2);
    expect(result.current.stats.completed).toBe(2);
  });

  it('advances a tenth of a level once enough have been read, and starts again', async () => {
    const advances: number[] = [];
    const { result } = renderSilent(3, (next) => advances.push(next));

    for (let i = 0; i < UNSCORED; i++) {
      await readThrough(result);
      if (i < UNSCORED - 1) expect(advances).toHaveLength(0);
    }

    expect(advances).toEqual([3.1]);
    expect(result.current.unscoredCompleted).toBe(0);
  });
});
