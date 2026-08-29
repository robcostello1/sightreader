import { useCallback, useEffect, useRef, useState } from 'react';
import { startMicCapture, type MicSession } from '../audio';
import { generateExercise } from '../generator';
import { buildSchedule, detectFalseStart, scheduleClicks, windowAt } from '../scheduler';
import type { Schedule, ScheduledClicks } from '../scheduler';
import { scoreWindow, summarise, type ExerciseSummary } from '../scoring';
import type { FretboardRegion } from '../config/regions';
import type { TierConfig } from '../config/tiers';
import type { Exercise, NoteResult, OnsetEvent, PitchSample } from '../lib/types';

export type LessonPhase = 'idle' | 'arming' | 'count-in' | 'playing' | 'results' | 'error';

export interface LessonState {
  phase: LessonPhase;
  exercise: Exercise | null;
  /** Seed that produced the current exercise, so a bad one can be reproduced. */
  seed: number | null;
  activeIndex: number | null;
  /** Filled in as each window closes, not all at the end. */
  results: NoteResult[];
  summary: ExerciseSummary | null;
  falseStart: PitchSample | null;
  livePitch: PitchSample | null;
  onsetCount: number;
  beatsUntilStart: number | null;
  error: string | null;
}

export interface UseLessonOptions {
  tier: TierConfig;
  region?: FretboardRegion;
  bpm?: number;
  /** Grace period before the count-in, so the worklet can fill its first frame. */
  leadInMs?: number;
}

const INITIAL: LessonState = {
  phase: 'idle',
  exercise: null,
  seed: null,
  activeIndex: null,
  results: [],
  summary: null,
  falseStart: null,
  livePitch: null,
  onsetCount: 0,
  beatsUntilStart: null,
  error: null,
};

/**
 * Drives one lesson: count-in, then the exercise, then results.
 *
 * Windows are scored as they close rather than in one pass at the end. The
 * verdict cannot exist before its window is over, but waiting for the whole
 * exercise would make feedback feel laggy — so the live pitch shows immediately
 * and the pass/fail lands a note later.
 */
export function useLesson(options: UseLessonOptions) {
  const { tier, region, bpm = 60, leadInMs = 300 } = options;
  const [state, setState] = useState<LessonState>(INITIAL);

  const sessionRef = useRef<MicSession | null>(null);
  const clicksRef = useRef<ScheduledClicks | null>(null);
  const scheduleRef = useRef<Schedule | null>(null);
  const samplesRef = useRef<PitchSample[]>([]);
  const onsetsRef = useRef<OnsetEvent[]>([]);
  const scoredRef = useRef<Set<number>>(new Set());
  const latestRef = useRef<PitchSample | null>(null);
  const frameRef = useRef<number | null>(null);

  const teardown = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    clicksRef.current?.stop();
    clicksRef.current = null;
    void sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  const stop = useCallback(() => {
    teardown();
    scheduleRef.current = null;
    samplesRef.current = [];
    onsetsRef.current = [];
    scoredRef.current = new Set();
    latestRef.current = null;
    setState(INITIAL);
  }, [teardown]);

  const start = useCallback(() => {
    if (sessionRef.current) return;

    const seed = Math.floor(Math.random() * 1_000_000_000);
    const exercise = generateExercise({ tier, region, bpm, seed });

    samplesRef.current = [];
    onsetsRef.current = [];
    scoredRef.current = new Set();
    latestRef.current = null;
    setState({ ...INITIAL, phase: 'arming', exercise, seed });

    startMicCapture({
      onSample: (sample) => {
        samplesRef.current.push(sample);
        latestRef.current = sample;
      },
      onOnset: (onset) => onsetsRef.current.push(onset),
    }).then(
      (session) => {
        sessionRef.current = session;

        // The schedule is anchored on the AudioContext clock the samples are
        // stamped with, so windows and detections cannot drift apart.
        const schedule = buildSchedule(exercise, {
          startMs: session.context.currentTime * 1000 + leadInMs,
          countInBars: tier.countInBars,
          clickThroughExercise: tier.clickThroughExercise,
          attackGuardMs: tier.scoring.attackGuardMs,
        });
        scheduleRef.current = schedule;
        clicksRef.current = scheduleClicks(session.context, schedule.clicks);

        setState((prev) => ({ ...prev, phase: 'count-in' }));
        frameRef.current = requestAnimationFrame(tick);
      },
      (cause: unknown) => {
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        }));
      },
    );

    function tick() {
      const session = sessionRef.current;
      const schedule = scheduleRef.current;
      if (!session || !schedule) return;

      const now = session.context.currentTime * 1000;
      const samples = samplesRef.current;

      // Score every window that has closed since the last frame.
      const closed: NoteResult[] = [];
      for (const window of schedule.windows) {
        if (now < window.endMs || scoredRef.current.has(window.index)) continue;
        scoredRef.current.add(window.index);
        closed.push(scoreWindow(window, samples, tier.scoring));
      }

      const finished = now >= schedule.endMs;
      const active = windowAt(schedule, now)?.index ?? null;
      const beatsLeft =
        now < schedule.t0 ? Math.ceil((schedule.t0 - now) / schedule.beatMs) : null;

      setState((prev) => {
        const results = closed.length > 0 ? [...prev.results, ...closed] : prev.results;
        return {
          ...prev,
          phase: finished ? 'results' : now >= schedule.t0 ? 'playing' : 'count-in',
          activeIndex: active,
          results,
          summary: finished ? summarise(results) : null,
          falseStart:
            prev.falseStart ??
            detectFalseStart(samples, schedule, tier.scoring.confidenceGate),
          livePitch: latestRef.current,
          onsetCount: onsetsRef.current.length,
          beatsUntilStart: beatsLeft,
        };
      });

      if (finished) {
        teardown();
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    }
  }, [tier, region, bpm, leadInMs, teardown]);

  useEffect(() => teardown, [teardown]);

  return { ...state, start, stop };
}
