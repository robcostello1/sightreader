import type { AudioTimeMs, Exercise, NoteValue, NoteWindow, PitchSample } from '../lib/types';

/** Duration of one beat, where "beat" is the time signature's lower number. */
export function beatDurationMs(bpm: number): number {
  return 60_000 / bpm;
}

/**
 * A note value is a fraction of a whole note, so tuplets need no special case:
 * a triplet quaver is simply 1/12 rather than 1/8.
 */
export function noteDurationMs(value: NoteValue, beatUnit: number, bpm: number): number {
  return value * beatUnit * beatDurationMs(bpm);
}

export interface ClickEvent {
  timeMs: AudioTimeMs;
  /** First beat of a bar, played louder. */
  accent: boolean;
  phase: 'count-in' | 'exercise';
}

export interface ScheduleOptions {
  /** AudioContext time the count-in should begin. */
  startMs: AudioTimeMs;
  countInBars: number;
  /** Click through the exercise itself. Count-in clicks are always produced. */
  clickThroughExercise: boolean;
  /** Head of each window excluded from scoring — attack transient and detector settling. */
  attackGuardMs: number;
}

export interface Schedule {
  startMs: AudioTimeMs;
  /**
   * The count-in's reference timestamp. Every window boundary is derived from
   * this, so it is the single value the scorer and the notation view must agree on.
   */
  t0: AudioTimeMs;
  endMs: AudioTimeMs;
  beatMs: number;
  clicks: ClickEvent[];
  windows: NoteWindow[];
}

export function buildSchedule(exercise: Exercise, options: ScheduleOptions): Schedule {
  const [beatsPerBar, beatUnit] = exercise.timeSignature;
  const beatMs = beatDurationMs(exercise.bpm);
  const { startMs, countInBars, clickThroughExercise, attackGuardMs } = options;

  const countInBeats = countInBars * beatsPerBar;
  const t0 = startMs + countInBeats * beatMs;

  const windows: NoteWindow[] = [];
  let cursor = t0;
  exercise.notes.forEach((note, index) => {
    const end = cursor + noteDurationMs(note.value, beatUnit, exercise.bpm);
    windows.push({
      index,
      note,
      startMs: cursor,
      endMs: end,
      // A window shorter than the guard collapses to an empty scoring zone; the
      // scorer reports that as unscorable rather than as a miss.
      scoreFromMs: Math.min(cursor + attackGuardMs, end),
    });
    cursor = end;
  });
  const endMs = cursor;

  const clicks: ClickEvent[] = [];
  for (let beat = 0; beat < countInBeats; beat++) {
    clicks.push({
      timeMs: startMs + beat * beatMs,
      accent: beat % beatsPerBar === 0,
      phase: 'count-in',
    });
  }
  if (clickThroughExercise) {
    for (let beat = 0; t0 + beat * beatMs < endMs; beat++) {
      clicks.push({
        timeMs: t0 + beat * beatMs,
        accent: beat % beatsPerBar === 0,
        phase: 'exercise',
      });
    }
  }

  return { startMs, t0, endMs, beatMs, clicks, windows };
}

/**
 * Anything confidently played before the count-in ends is a false start — it is
 * reported rather than scored, so an eager player is told what happened instead
 * of silently failing the first note.
 */
export function detectFalseStart(
  samples: readonly PitchSample[],
  schedule: Schedule,
  confidenceGate: number,
): PitchSample | null {
  return (
    samples.find(
      (sample) =>
        sample.timestamp >= schedule.startMs &&
        sample.timestamp < schedule.t0 &&
        sample.hz !== null &&
        sample.confidence >= confidenceGate,
    ) ?? null
  );
}

/** The window containing `timestamp`, or null between/outside windows. */
export function windowAt(schedule: Schedule, timestamp: AudioTimeMs): NoteWindow | null {
  return (
    schedule.windows.find((w) => timestamp >= w.startMs && timestamp < w.endMs) ?? null
  );
}
