import { useCallback, useEffect, useRef, useState } from 'react';
import { startMicCapture, startSilentSession, type MicSession } from '../audio';
import { generateExercise } from '../generator';
import {
  barStartAt,
  buildSchedule,
  countInClicksBefore,
  scheduleClicks,
  shiftSchedule,
  windowAt,
} from '../scheduler';
import type { Schedule, ScheduledClicks } from '../scheduler';
import { scoreWindow, summarise, type ExerciseSummary } from '../scoring';
import { levelConfig } from '../config/levels';
import { DEFAULT_PROGRESSION, advanceLevel, advanceUnscored } from '../config/progression';
import {
  instrumentById,
  positionById,
  soundingPool,
  DEFAULT_INSTRUMENT_ID,
} from '../config/instruments';
import type { Exercise, NoteResult, OnsetEvent, PitchSample } from '../lib/types';

export type LessonPhase = 'idle' | 'arming' | 'count-in' | 'playing' | 'results' | 'error';

/** What the browser made of a microphone request. */
export type MicRequest = { granted: true } | { granted: false; cause: unknown };

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
  /** Exercises finished since the last level change. Drives progress when
   *  there is no accuracy to gate on. */
  unscoredCompleted: number;
  error: string | null;
}

export interface UseLessonOptions {
  /** 1–10. */
  level: number;
  /** Instrument id; decides the pitch pool, the clef and the transposition. */
  instrumentId?: string;
  /** Position id, for the instruments that offer one. */
  positionId?: string | null;
  bpm?: number;
  /** Grace period before the count-in, so the worklet can fill its first frame. */
  leadInMs?: number;
  /**
   * Whether the microphone is available to score against. With it off the
   * exercise still runs — count-in, notation, tempo — but nothing is judged,
   * and the level advances on exercises played rather than on accuracy.
   */
  scoring?: boolean;
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
  unscoredCompleted: 0,
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
    instrumentId = DEFAULT_INSTRUMENT_ID,
    positionId = null,
    bpm = 60,
    scoring: scoringEnabled = true,
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
  /** Exercises finished since the last step, when there is nothing to score. */
  const unscoredRef = useRef(0);
  /** Whether the open session is the silent one, with a clock but no ear. */
  const silentRef = useRef(false);
  /**
   * When the music restarts, on the clock. Normally t0; after a pause it is the
   * bar the exercise picks back up from, with clicks leading into it. Everything
   * that asks "has the music started yet" asks this rather than t0.
   */
  const gateRef = useRef<number | null>(null);
  /** Clock reading at a mid-exercise pause, and null when no exercise is held. */
  const pausedAtRef = useRef<number | null>(null);
  /** Read by the sample callback, which is not re-created per render. */
  const pausedRef = useRef(false);

  // Read through refs inside the animation loop so it never restarts mid-exercise.
  const settingsRef = useRef({
    level,
    instrumentId,
    positionId,
    bpm,
    scoringEnabled,
    leadInMs,
    autoAdvance,
    advanceDelayMs,
    onAdvance,
  });
  useEffect(() => {
    settingsRef.current = {
      level,
      instrumentId,
      positionId,
      bpm,
      scoringEnabled,
      leadInMs,
      autoAdvance,
      advanceDelayMs,
      onAdvance,
    };
  }, [
    level,
    instrumentId,
    positionId,
    bpm,
    scoringEnabled,
    leadInMs,
    autoAdvance,
    advanceDelayMs,
    onAdvance,
  ]);

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
    pausedAtRef.current = null;
    pausedRef.current = false;
    clicksRef.current?.stop();
    clicksRef.current = null;
  }, []);

  const closeSession = useCallback(() => {
    haltExercise();
    void sessionRef.current?.stop();
    sessionRef.current = null;
    silentRef.current = false;
    scheduleRef.current = null;
    gateRef.current = null;
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

  /**
   * One frame of a running exercise: score whatever has closed, move the
   * cursor, and decide whether the exercise is over.
   *
   * It lives out here rather than inside beginExercise because resuming a
   * paused exercise has to start the loop again without generating a new one.
   * Everything it reads is a ref, so it never has to be rebuilt mid-exercise.
   */
  const tick = useCallback<() => void>(function frame() {
    const current = sessionRef.current;
    if (!current || !scheduleRef.current) return;

    const now = current.context.currentTime * 1000;
    const samples = samplesRef.current;
    const judging = settingsRef.current.scoringEnabled;
    const scoring = levelConfig(settingsRef.current.level).scoring;

    // Score every window that has closed since the last frame. With no
    // microphone there is nothing to score against, and marking every note
    // as silence would be a verdict rather than the absence of one.
    const closed: NoteResult[] = [];
    if (judging) {
      for (const window of scheduleRef.current.windows) {
        if (now < window.endMs || scoredRef.current.has(window.index)) continue;
        scoredRef.current.add(window.index);
        closed.push(scoreWindow(window, samples, scoring));
      }
    }

    const active = scheduleRef.current;
    // Where the music starts, which is t0 until a pause moves it to the bar
    // the exercise is picking up from.
    const gate = gateRef.current ?? active.t0;
    const finished = now >= active.endMs;
    const counting = now < gate;
    const beatsLeft = counting ? Math.ceil((gate - now) / active.clickMs) : null;

    if (closed.length > 0) resultsRef.current = [...resultsRef.current, ...closed];
    const results = resultsRef.current;
    const summary = finished && judging ? summarise(results) : null;
    if (finished && !judging) unscoredRef.current += 1;
    if (summary) {
      // Only the most recent exercises count towards the next step; the
      // window is cleared outright when one is earned.
      historyRef.current = [...historyRef.current, summary.accuracy].slice(
        -DEFAULT_PROGRESSION.windowSize,
      );
    }

    setState((prev) => ({
      ...prev,
      phase: finished ? 'results' : counting ? 'count-in' : 'playing',
      // Nothing is being read during a count-in, including the one that leads
      // back into a resumed bar — where the notes under it have already been
      // played once and would otherwise light up a second time.
      activeIndex: counting ? null : (windowAt(active, now)?.index ?? null),
      results,
      summary,
      onsetCount: onsetsRef.current.length,
      beatsUntilStart: beatsLeft,
      history: historyRef.current,
      unscoredCompleted: unscoredRef.current,
      stats: summary
        ? {
            completed: prev.stats.completed + 1,
            passed: prev.stats.passed + summary.passed,
            scorable: prev.stats.scorable + (summary.total - summary.unscorable),
          }
        : finished && !judging
          ? { ...prev.stats, completed: prev.stats.completed + 1 }
          : prev.stats,
    }));

    if (finished) {
      haltExercise();

      // Decide progression here, at the completion that caused it. With
      // nothing scored, exercises played is the only signal left.
      const { level: playedAt, onAdvance: notify } = settingsRef.current;
      const next = judging
        ? advanceLevel(playedAt, historyRef.current)
        : advanceUnscored(playedAt, unscoredRef.current);
      if (next !== playedAt) {
        // Start the count again, so the next step is earned at the new level
        // rather than on results from the old one.
        historyRef.current = [];
        unscoredRef.current = 0;
        setState((prev) => ({ ...prev, history: [], unscoredCompleted: 0 }));
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
    frameRef.current = requestAnimationFrame(frame);
  }, [armAdvance, haltExercise]);

  const beginExercise = useCallback(
    (session: MicSession) => {
      const {
        level: lvl,
        instrumentId: instrId,
        positionId: posId,
        bpm: tempo,
        leadInMs: lead,
      } = settingsRef.current;
      const config = levelConfig(lvl);
      const instrument = instrumentById(instrId);
      const pool = soundingPool(instrument, positionById(instrument, posId));
      const seed = Math.floor(Math.random() * 1_000_000_000);

      let exercise: Exercise;
      try {
        exercise = generateExercise({ level: config, pool, bpm: tempo, seed });
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
      pausedAtRef.current = null;
      pausedRef.current = false;

      // Anchored on the same AudioContext clock the samples are stamped with, so
      // windows and detections cannot drift apart.
      const schedule = buildSchedule(exercise, {
        startMs: session.context.currentTime * 1000 + lead,
        clickThroughExercise: Math.random() < config.clickThroughChance,
        attackGuardMs: config.scoring.attackGuardMs,
      });
      scheduleRef.current = schedule;
      gateRef.current = schedule.t0;
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

      frameRef.current = requestAnimationFrame(tick);
    },
    [tick],
  );

  /**
   * Holds the session wherever it is: mid-count-in, mid-exercise, or in the gap
   * before the next one.
   *
   * Mid-exercise the clock cannot be stopped — the AudioContext runs on — so
   * what is held is the schedule's claim on it. The loop stops, the clicks
   * already queued are cancelled, and where we got to is banked; resume moves
   * the whole schedule down the clock by however long the pause turned out to
   * be. In the gap there is nothing scheduled at all, so only the wall-clock
   * timer needs banking and the audio graph is left alone.
   */
  const pause = useCallback(() => {
    const session = sessionRef.current;
    if (frameRef.current !== null && session && scheduleRef.current) {
      pausedAtRef.current = session.context.currentTime * 1000;
      pausedRef.current = true;
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      clicksRef.current?.stop();
      clicksRef.current = null;
      setState((prev) => ({ ...prev, paused: true }));
      return;
    }

    if (advanceRef.current === null) return;
    clearTimeout(advanceRef.current);
    advanceRef.current = null;
    advanceRemainingRef.current = Math.max(
      0,
      advanceRemainingRef.current - (Date.now() - advanceArmedAtRef.current),
    );
    setState((prev) => ({ ...prev, paused: true }));
  }, []);

  /**
   * Picks the exercise back up from somewhere a player can re-enter.
   *
   * From the top of the bar that was in progress, with a bar of clicks leading
   * into it — the same instruction a teacher would give. Dropping someone back
   * mid-bar on the beat they left is not something anyone can play, and losing
   * the whole exercise for a pause in the last bar is not something anyone
   * would ask for twice. The bar being re-read is un-scored first, so it is
   * judged on the reading that happens rather than on the one that was
   * interrupted.
   *
   * A pause during the count-in gets the count-in over again: there is no music
   * to pick up yet, and resuming into the last click of a count-in is the same
   * problem in miniature.
   */
  const resumeExercise = useCallback(
    (session: MicSession, pausedAt: number) => {
      const held = scheduleRef.current;
      if (!held) return;
      const now = session.context.currentTime * 1000;
      const midExercise = pausedAt >= held.t0;
      // What the music picks up from, and how much clock to allow before it.
      const from = midExercise ? barStartAt(held, pausedAt) : held.startMs;
      const lead = midExercise ? held.barMs : settingsRef.current.leadInMs;

      const schedule = shiftSchedule(held, now + lead - from);
      const gate = Math.max(schedule.t0, from + (now + lead - from));
      scheduleRef.current = schedule;
      gateRef.current = gate;

      // Everything from the resumed bar on is unread again.
      for (const window of schedule.windows) {
        if (window.startMs >= gate) scoredRef.current.delete(window.index);
      }
      resultsRef.current = resultsRef.current.filter((result) =>
        scoredRef.current.has(result.index),
      );

      clicksRef.current = scheduleClicks(
        session.context,
        midExercise ? [...countInClicksBefore(schedule, gate), ...schedule.clicks] : schedule.clicks,
      );
      setState((prev) => ({
        ...prev,
        paused: false,
        phase: 'count-in',
        activeIndex: null,
        results: resultsRef.current,
        // Published here rather than left to the next frame, so the count
        // appears on the press instead of a frame after it.
        beatsUntilStart: Math.ceil((gate - now) / schedule.clickMs),
      }));
      frameRef.current = requestAnimationFrame(tick);
    },
    [tick],
  );

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
    const session = sessionRef.current;
    if (!session) return;

    const pausedAt = pausedAtRef.current;
    if (pausedAt !== null) {
      pausedAtRef.current = null;
      pausedRef.current = false;
      resumeExercise(session, pausedAt);
      return;
    }

    setState((prev) => ({ ...prev, paused: false }));
    armAdvance(advanceRemainingRef.current || settingsRef.current.advanceDelayMs);
  }, [armAdvance, resumeExercise]);

  /**
   * Opens the microphone without starting anything, so the readout is live
   * before the first exercise and between them.
   *
   * Failure is deliberately silent: nothing has been asked for yet, and a
   * permission prompt the user dismissed is not an error to report. Pressing
   * Start surfaces it properly.
   */
  const openSession = useCallback(
    (
      onReady?: (session: MicSession) => void,
      onFailure?: (cause: unknown) => void,
      options?: { microphone?: boolean },
    ) => {
      // Asking for the microphone specifically overrides the current setting:
      // it is how a player in degraded mode turns scoring back on.
      const wantsMicrophone = options?.microphone ?? settingsRef.current.scoringEnabled;

      if (sessionRef.current) {
        // A silent session cannot become a listening one; swap it out.
        if (!wantsMicrophone || !silentRef.current) {
          onReady?.(sessionRef.current);
          return;
        }
        void sessionRef.current.stop();
        sessionRef.current = null;
        silentRef.current = false;
      }

      // No microphone to open: the lesson still needs a clock for the count-in
      // and the note windows, and that is all a silent session is.
      if (!wantsMicrophone) {
        startSilentSession().then(
          (session) => {
            sessionRef.current = session;
            silentRef.current = true;
            setState((prev) => ({ ...prev, analyser: session.analyser }));
            onReady?.(session);
          },
          (cause: unknown) => onFailure?.(cause),
        );
        return;
      }

      startMicCapture({
        onSample: (sample) => {
        // Always the newest reading, so the readout works before an exercise and
        // between them. Showing what is heard is not scoring it.
          latestRef.current = sample;

          // Count-in audio is ignored entirely — not scored, not classified, not
          // even retained — and nothing is collected while no exercise runs or
          // while one is held. The count-in leading back into a resumed bar is
          // a count-in like any other, which is why this asks the gate rather
          // than t0: after a pause, t0 is already behind us.
          const schedule = scheduleRef.current;
          if (!schedule || pausedRef.current) return;
          if (sample.timestamp < (gateRef.current ?? schedule.t0)) return;
          samplesRef.current.push(sample);
        },
        onOnset: (onset) => onsetsRef.current.push(onset),
      }).then(
        (session) => {
          sessionRef.current = session;
          silentRef.current = false;
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

  /**
   * Opens the microphone and reports what the browser decided, so the caller
   * can tell a refusal from a missing device. Call it from the click itself:
   * browsers refuse the prompt outside a user gesture.
   */
  const requestMicrophone = useCallback(
    () =>
      new Promise<MicRequest>((resolve) => {
        openSession(
          () => resolve({ granted: true }),
          (cause) => resolve({ granted: false, cause }),
          { microphone: true },
        );
      }),
    [openSession],
  );

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

  return {
    ...state,
    start,
    stop,
    listen,
    requestMicrophone,
    pause,
    resume,
    clearHistory,
    acknowledgeMilestone,
  };
}
