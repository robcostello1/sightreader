import type { AudioTimeMs, Exercise, NoteValue, NoteWindow } from '../lib/types';

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
  /** Defaults to what the exercise's signature needs — see countInBarsFor. */
  countInBars?: number;
  /** Click through the exercise itself. Count-in clicks are always produced. */
  clickThroughExercise: boolean;
  /** Head of each window excluded from scoring — attack transient and detector settling. */
  attackGuardMs: number;
}

/**
 * 6/8 and its relatives are counted in two dotted-quarter beats, not six
 * quavers. Clicking every quaver would be both frantic and misleading about
 * where the pulse is.
 */
export function isCompound([beatsPerBar, beatUnit]: [number, number]): boolean {
  return beatUnit === 8 && beatsPerBar % 3 === 0 && beatsPerBar > 3;
}

/** Pulses a count-in should give before the music starts. */
const MIN_COUNT_IN_CLICKS = 4;

/**
 * And how long it should take giving them, in ms. Four clicks at 240bpm is a
 * second, which is over before it has established anything.
 */
const MIN_COUNT_IN_MS = 1600;

/**
 * Bars of count-in a signature needs at this tempo.
 *
 * Two demands, and the larger wins. Enough pulses: a bar is worth a different
 * number in each signature — one bar of 4/4 is four, of 3/4 three, and of 6/8
 * only two once it is counted in dotted-crotchet beats — so a single bar of 3/4
 * or 6/8 is too few to settle into.
 *
 * And enough time. Four pulses is plenty at 60bpm and nothing at 240, where the
 * same bar goes by in a second. The count-in has to last *longer* than the
 * minimum rather than merely reach it, so a bar of 4/4 at exactly 150bpm — 1.6
 * seconds — already earns a second bar.
 */
export function countInBarsFor(timeSignature: [number, number], bpm: number): number {
  const [beatsPerBar] = timeSignature;
  const clicksPerBar = beatsPerBar / (isCompound(timeSignature) ? 3 : 1);
  const byClicks = Math.max(1, Math.ceil(MIN_COUNT_IN_CLICKS / clicksPerBar));
  const byTime = Math.floor(MIN_COUNT_IN_MS / (beatsPerBar * beatDurationMs(bpm))) + 1;
  return Math.max(byClicks, byTime);
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
  /** Gap between clicks — three beat-units in a compound meter, one otherwise. */
  clickMs: number;
  /** One bar. A paused exercise picks back up on one of these — see barStartAt. */
  barMs: number;
  clicks: ClickEvent[];
  windows: NoteWindow[];
}

export function buildSchedule(exercise: Exercise, options: ScheduleOptions): Schedule {
  const [beatsPerBar, beatUnit] = exercise.timeSignature;
  const beatMs = beatDurationMs(exercise.bpm);
  const { startMs, clickThroughExercise, attackGuardMs } = options;
  const countInBars = options.countInBars ?? countInBarsFor(exercise.timeSignature, exercise.bpm);

  const countInBeats = countInBars * beatsPerBar;
  const t0 = startMs + countInBeats * beatMs;
  const unitsPerClick = isCompound(exercise.timeSignature) ? 3 : 1;
  const clickMs = beatMs * unitsPerClick;
  const barMs = beatsPerBar * beatMs;

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
  for (let beat = 0; beat < countInBeats; beat += unitsPerClick) {
    clicks.push({
      timeMs: startMs + beat * beatMs,
      accent: beat % beatsPerBar === 0,
      phase: 'count-in',
    });
  }
  if (clickThroughExercise) {
    for (let beat = 0; t0 + beat * beatMs < endMs; beat += unitsPerClick) {
      clicks.push({
        timeMs: t0 + beat * beatMs,
        accent: beat % beatsPerBar === 0,
        phase: 'exercise',
      });
    }
  }

  return { startMs, t0, endMs, beatMs, clickMs, barMs, clicks, windows };
}

/** The window containing `timestamp`, or null between/outside windows. */
export function windowAt(schedule: Schedule, timestamp: AudioTimeMs): NoteWindow | null {
  return (
    schedule.windows.find((w) => timestamp >= w.startMs && timestamp < w.endMs) ?? null
  );
}

/**
 * The same schedule moved bodily along the clock.
 *
 * Every timestamp in a schedule is on the AudioContext clock, and a pause
 * spends clock the music did not. Shifting all of them by the same offset is
 * what lets an exercise be picked up later without any of its parts — windows,
 * clicks, t0 — drifting against the others.
 */
export function shiftSchedule(schedule: Schedule, offsetMs: number): Schedule {
  return {
    ...schedule,
    startMs: schedule.startMs + offsetMs,
    t0: schedule.t0 + offsetMs,
    endMs: schedule.endMs + offsetMs,
    clicks: schedule.clicks.map((click) => ({ ...click, timeMs: click.timeMs + offsetMs })),
    windows: schedule.windows.map((window) => ({
      ...window,
      startMs: window.startMs + offsetMs,
      endMs: window.endMs + offsetMs,
      scoreFromMs: window.scoreFromMs + offsetMs,
    })),
  };
}

/**
 * Start of the bar `timestamp` falls in, never earlier than the music itself.
 *
 * Where an interrupted exercise picks up from. A bar is the unit a player
 * re-enters on — "from the top of bar three" is an instruction anyone can
 * follow, where "from 1.4 seconds into bar three" is not.
 */
export function barStartAt(schedule: Schedule, timestamp: AudioTimeMs): AudioTimeMs {
  if (timestamp <= schedule.t0) return schedule.t0;
  return schedule.t0 + Math.floor((timestamp - schedule.t0) / schedule.barMs) * schedule.barMs;
}

/**
 * A bar of count-in clicks landing immediately before `atMs`.
 *
 * The count-in a resumed exercise gets. It is built from the schedule's own
 * click spacing rather than from the signature again, so a compound meter is
 * counted in the same two-in-a-bar it was counted in to begin with.
 */
export function countInClicksBefore(schedule: Schedule, atMs: AudioTimeMs): ClickEvent[] {
  const clicksPerBar = Math.max(1, Math.round(schedule.barMs / schedule.clickMs));
  return Array.from({ length: clicksPerBar }, (_, i) => ({
    timeMs: atMs - schedule.barMs + i * schedule.clickMs,
    accent: i === 0,
    phase: 'count-in' as const,
  }));
}
