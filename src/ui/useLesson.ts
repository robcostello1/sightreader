import { useCallback, useEffect, useRef, useState } from 'react';
import { startMicCapture, type MicSession } from '../audio';
import { generateExercise } from '../generator';
import { buildSchedule, scheduleClicks, windowAt } from '../scheduler';
import type { Schedule, ScheduledClicks } from '../scheduler';
import { scoreWindow, summarise, type ExerciseSummary } from '../scoring';
import { levelConfig } from '../config/levels';
import { DEFAULT_PROGRESSION, advanceLevel } from '../config/progression';
import type { FretboardRegion } from '../config/regions';
import type { Exercise, NoteResult, OnsetEvent, PitchSample } from '../lib/types';

export type LessonPhase = 'idle' | 'arming' | 'count-in' | 'playing' | 'results' | 'error';

export interface SessionStats {
  /** Exercises played to completion since the microphone was opened. */
  completed: number;
  passed: number;
  scorable: number;
}

export interface LessonState {
  /** Accuracy of each completed exercise, newest last. Drives progression. */
  history: number[];
  /**
   * Whole level just reached, if any. Holds the session so the new ideas can be
   * read before they start turning up; cleared by acknowledgeMilestone.
   */
  milestone: number | null;
  phase: LessonPhase;
  exercise: Exercise | null;
  /** Seed that produced the current exercise, so a bad one can be reproduced. */
  seed: number | null;
  activeIndex: number | null;
  /** Filled in as each window closes, not all at the end. */
  results: NoteResult[];
  summary: ExerciseSummary | null;
  paused: boolean;
  /** Live input tap, for the waveform. Null until the microphone is open. */
  analyser: AnalyserNode | null;
  livePitch: PitchSample | null;
  onsetCount: number;
  beatsUntilStart: number | null;
  stats: SessionStats;
  error: string | null;
}

export interface UseLessonOptions {
  /** 1–10. */
  level: number;
  /** Fretboard position, chosen independently of level. */
  region?: FretboardRegion;
  bpm?: number;
  /** Grace period before the count-in, so the worklet can fill its first frame. */
  leadInMs?: number;
  /** Roll straight into another exercise once results are in. */
  autoAdvance?: boolean;
  /** How long results stay up before the next exercise starts. */
  advanceDelayMs?: number;
  /**
   * Called when accuracy over the recent window earns a level change. Fired from
   * the completion itself rather than an effect watching history, so the level
   * moves as a consequence of the event that caused it.
   */
  onAdvance?: (level: number) => void;
}

const EMPTY_STATS: SessionStats = { completed: 0, passed: 0, scorable: 0 };

const INITIAL: LessonState = {
  history: [],
  milestone: null,
  phase: 'idle',
  exercise: null,
  seed: null,
  activeIndex: null,
  results: [],
  summary: null,
  paused: false,
  analyser: null,
  livePitch: null,
  onsetCount: 0,
  beatsUntilStart: null,
  stats: EMPTY_STATS,
  error: null,
};

/**
 * Drives a practice session: count-in, exercise, results, and — when
 * auto-advance is on — straight into the next one.
 *
 * The microphone session deliberately outlives any single exercise. Closing and
 * reopening the AudioContext between exercises would cost a fresh getUserMedia
 * round trip each time, and a newly created context can only be resumed from a
 * user gesture — which auto-advance, by definition, does not have.
 *
 * Windows are scored as they close rather than in one pass at the end. The
 * verdict cannot exist before its window is over, but waiting for the whole
 * exercise would feel laggy, so the live pitch shows immediately and the
 * pass/fail lands a note later.
 */
export function useLesson(options: UseLessonOptions) {
  const {
    level,
    region,
    bpm = 60,
    leadInMs = 300,
    autoAdvance = false,
    advanceDelayMs = 2500,
    onAdvance,
  } = options;

  const [state, setState] = useState<LessonState>(INITIAL);

  const sessionRef = useRef<MicSession | null>(null);
  const clicksRef = useRef<ScheduledClicks | null>(null);
  const scheduleRef = useRef<Schedule | null>(null);
  const samplesRef = useRef<PitchSample[]>([]);
  const onsetsRef = useRef<OnsetEvent[]>([]);
  const scoredRef = useRef<Set<number>>(new Set());
  const latestRef = useRef<PitchSample | null>(null);
  const frameRef = useRef<number | null>(null);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Wall-clock bookkeeping for the gap between exercises, so it can be paused. */
  const advanceArmedAtRef = useRef(0);
  const advanceRemainingRef = useRef(0);
  // Mirrored outside React state so completion can act on them immediately.
  const resultsRef = useRef<NoteResult[]>([]);
  const historyRef = useRef<number[]>([]);

  // Read through refs inside the animation loop so it never restarts mid-exercise.
  const settingsRef = useRef({
    level,
    region,
    bpm,
    leadInMs,
    autoAdvance,
    advanceDelayMs,
    onAdvance,
  });
  useEffect(() => {
    settingsRef.current = {
      level,
      region,
      bpm,
      leadInMs,
      autoAdvance,
      advanceDelayMs,
      onAdvance,
    };
  }, [level, region, bpm, leadInMs, autoAdvance, advanceDelayMs, onAdvance]);

  // Lets the loop queue the next exercise without beginExercise capturing itself.
  const beginExerciseRef = useRef<((session: MicSession) => void) | null>(null);

  /** Arms the gap before the next exercise, tracking it so pause can bank it. */
  const armAdvance = useCallback((delayMs: number) => {
    advanceArmedAtRef.current = Date.now();
    advanceRemainingRef.current = delayMs;
    advanceRef.current = setTimeout(() => {
      advanceRemainingRef.current = 0;
      const open = sessionRef.current;
      if (open) beginExerciseRef.current?.(open);
    }, delayMs);
  }, []);

  /** Stops the loop and any queued advance, leaving the microphone open. */
  const haltExercise = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (advanceRef.current !== null) clearTimeout(advanceRef.current);
    advanceRef.current = null;
    advanceRemainingRef.current = 0;
    clicksRef.current?.stop();
    clicksRef.current = null;
  }, []);

  const closeSession = useCallback(() => {
    haltExercise();
    void sessionRef.current?.stop();
    sessionRef.current = null;
    scheduleRef.current = null;
    samplesRef.current = [];
    onsetsRef.current = [];
    scoredRef.current = new Set();
    latestRef.current = null;
  }, [haltExercise]);

  /** Called after a level change, so the next decision starts from scratch. */
  const clearHistory = useCallback(() => {
    historyRef.current = [];
    setState((prev) => ({ ...prev, history: [] }));
  }, []);

  const stop = useCallback(() => {
    closeSession();
    resultsRef.current = [];
    historyRef.current = [];
    setState(INITIAL);
  }, [closeSession]);

  const beginExercise = useCallback((session: MicSession) => {
    const { level: lvl, region: reg, bpm: tempo, leadInMs: lead } = settingsRef.current;
    const config = levelConfig(lvl);
    const seed = Math.floor(Math.random() * 1_000_000_000);

    let exercise: Exercise;
    try {
      exercise = generateExercise({ level: config, region: reg, bpm: tempo, seed });
    } catch (cause) {
      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: cause instanceof Error ? cause.message : String(cause),
      }));
      return;
    }

    samplesRef.current = [];
    onsetsRef.current = [];
    scoredRef.current = new Set();
    resultsRef.current = [];
    latestRef.current = null;

    // Anchored on the same AudioContext clock the samples are stamped with, so
    // windows and detections cannot drift apart.
    const schedule = buildSchedule(exercise, {
      startMs: session.context.currentTime * 1000 + lead,
      clickThroughExercise: Math.random() < config.clickThroughChance,
      attackGuardMs: config.scoring.attackGuardMs,
    });
    scheduleRef.current = schedule;
    clicksRef.current = scheduleClicks(session.context, schedule.clicks);

    setState((prev) => ({
      ...prev,
      phase: 'count-in',
      exercise,
      seed,
      activeIndex: null,
      results: [],
      summary: null,
      paused: false,
      onsetCount: 0,
      beatsUntilStart: null,
      error: null,
    }));

    const tick = () => {
      const current = sessionRef.current;
      if (!current || !scheduleRef.current) return;

      const now = current.context.currentTime * 1000;
      const samples = samplesRef.current;
      const scoring = levelConfig(settingsRef.current.level).scoring;

      // Score every window that has closed since the last frame.
      const closed: NoteResult[] = [];
      for (const window of scheduleRef.current.windows) {
        if (now < window.endMs || scoredRef.current.has(window.index)) continue;
        scoredRef.current.add(window.index);
        closed.push(scoreWindow(window, samples, scoring));
      }

      const active = scheduleRef.current;
      const finished = now >= active.endMs;
      const beatsLeft =
        now < active.t0 ? Math.ceil((active.t0 - now) / active.clickMs) : null;

      if (closed.length > 0) resultsRef.current = [...resultsRef.current, ...closed];
      const results = resultsRef.current;
      const summary = finished ? summarise(results) : null;
      if (summary) {
        // Only the most recent exercises count towards the next step; the
        // window is cleared outright when one is earned.
        historyRef.current = [...historyRef.current, summary.accuracy].slice(
          -DEFAULT_PROGRESSION.windowSize,
        );
      }

      setState((prev) => ({
        ...prev,
        phase: finished ? 'results' : now >= active.t0 ? 'playing' : 'count-in',
        activeIndex: windowAt(active, now)?.index ?? null,
        results,
        summary,
        onsetCount: onsetsRef.current.length,
        beatsUntilStart: beatsLeft,
        history: historyRef.current,
        stats: summary
          ? {
              completed: prev.stats.completed + 1,
              passed: prev.stats.passed + summary.passed,
              scorable: prev.stats.scorable + (summary.total - summary.unscorable),
            }
          : prev.stats,
      }));

      if (finished) {
        haltExercise();

        // Decide progression here, at the completion that caused it.
        const { level: playedAt, onAdvance: notify } = settingsRef.current;
        const next = advanceLevel(playedAt, historyRef.current);
        if (next !== playedAt) {
          // Start the count again, so the next step is earned at the new level
          // rather than on results from the old one.
          historyRef.current = [];
          setState((prev) => ({ ...prev, history: [] }));
          notify?.(next);
          // Crossing into a new whole level pauses here, so what is arriving can
          // be read before it starts turning up mid-exercise.
          if (Math.floor(next) > Math.floor(playedAt)) {
            setState((prev) => ({ ...prev, milestone: Math.floor(next) }));
            return;
          }
        }
        if (settingsRef.current.autoAdvance) armAdvance(settingsRef.current.advanceDelayMs);
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  }, [armAdvance, haltExercise]);

  /**
   * Holds the session between exercises. Only the gap is pausable: an exercise
   * is a continuous reading against a fixed tempo, so there is no coherent way
   * to stop partway and pick it up again. Nothing is scheduled during the gap,
   * so this is only the wall-clock timer — the audio graph is left alone.
   */
  const pause = useCallback(() => {
    if (advanceRef.current === null) return;
    clearTimeout(advanceRef.current);
    advanceRef.current = null;
    advanceRemainingRef.current = Math.max(
      0,
      advanceRemainingRef.current - (Date.now() - advanceArmedAtRef.current),
    );
    setState((prev) => ({ ...prev, paused: true }));
  }, []);

  useEffect(() => {
    beginExerciseRef.current = beginExercise;
  }, [beginExercise]);

  /** Dismisses the milestone panel and picks the session back up. */
  const acknowledgeMilestone = useCallback(() => {
    setState((prev) => ({ ...prev, milestone: null }));
    const open = sessionRef.current;
    if (open) beginExercise(open);
  }, [beginExercise]);

  const resume = useCallback(() => {
    if (!sessionRef.current) return;
    setState((prev) => ({ ...prev, paused: false }));
    armAdvance(advanceRemainingRef.current || settingsRef.current.advanceDelayMs);
  }, [armAdvance]);

  /**
   * Opens the microphone without starting anything, so the readout is live
   * before the first exercise and between them.
   *
   * Failure is deliberately silent: nothing has been asked for yet, and a
   * permission prompt the user dismissed is not an error to report. Pressing
   * Start surfaces it properly.
   */
  const openSession = useCallback(
    (onReady?: (session: MicSession) => void, onFailure?: (cause: unknown) => void) => {
      if (sessionRef.current) {
        onReady?.(sessionRef.current);
        return;
      }
      startMicCapture({
        onSample: (sample) => {
        // Always the newest reading, so the readout works before an exercise and
        // between them. Showing what is heard is not scoring it.
          latestRef.current = sample;

          // Count-in audio is ignored entirely — not scored, not classified, not
          // even retained — and nothing is collected while no exercise runs.
          const schedule = scheduleRef.current;
          if (!schedule || sample.timestamp < schedule.t0) return;
          samplesRef.current.push(sample);
        },
        onOnset: (onset) => onsetsRef.current.push(onset),
      }).then(
        (session) => {
          sessionRef.current = session;
          setState((prev) => ({ ...prev, analyser: session.analyser }));

          // Opened without a gesture, the context can come up suspended. Pick it
          // up on the first interaction rather than leaving a dead readout.
          if (session.context.state !== 'running') {
            const wake = () => {
              void session.context.resume();
              window.removeEventListener('pointerdown', wake);
              window.removeEventListener('keydown', wake);
            };
            window.addEventListener('pointerdown', wake, { once: true });
            window.addEventListener('keydown', wake, { once: true });
          }

          onReady?.(session);
        },
        (cause: unknown) => onFailure?.(cause),
      );
    },
    [],
  );

  /** Starts monitoring only; used on load so the readout is live immediately. */
  const listen = useCallback(() => openSession(), [openSession]);

  const start = useCallback(() => {
    const existing = sessionRef.current;
    if (existing) {
      // Already listening — just queue up another exercise.
      haltExercise();
      beginExercise(existing);
      return;
    }

    setState((prev) => ({ ...INITIAL, stats: prev.stats, phase: 'arming' }));
    openSession(beginExercise, (cause) =>
      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: cause instanceof Error ? cause.message : String(cause),
      })),
    );
  }, [beginExercise, haltExercise, openSession]);

  // The readout is published on its own frame loop rather than by the exercise
  // tick, so it keeps running when no exercise does.
  useEffect(() => {
    if (state.analyser === null) return;
    let frame = requestAnimationFrame(function publish() {
      frame = requestAnimationFrame(publish);
      setState((prev) =>
        prev.livePitch === latestRef.current ? prev : { ...prev, livePitch: latestRef.current },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [state.analyser]);

  useEffect(() => closeSession, [closeSession]);

  return { ...state, start, stop, listen, pause, resume, clearHistory, acknowledgeMilestone };
}
