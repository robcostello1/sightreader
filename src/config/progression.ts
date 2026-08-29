import { MAX_LEVEL, clampLevel } from './levels';

export interface ProgressionConfig {
  /** Exercises averaged before a decision is made. */
  windowSize: number;
  /** Mean note accuracy needed to move up. Deliberately short of perfect. */
  threshold: number;
  /** How far a single advance moves the level. */
  step: number;
}

/**
 * Advancement is gated on the pass/fail occupancy scores, which are already the
 * mastery signal — no separate scoring system (spec §7).
 *
 * A tenth of a level per advance is what makes the ramp usable: crossing a whole
 * level takes ten of these, so the newly introduced ideas arrive a little at a
 * time rather than all at once. The threshold is short of perfect on purpose —
 * sight-reading is meant to be attempted at the edge of fluency, and demanding
 * a clean run would stall anyone on their first misread note.
 *
 * The window rolls rather than resetting after an advance. Clearing it would
 * mean five more exercises before the next nudge however well you were reading;
 * rolling lets the level track your accuracy continuously and settle wherever
 * you stop clearing the bar.
 */
export const DEFAULT_PROGRESSION: ProgressionConfig = {
  windowSize: 5,
  threshold: 0.8,
  step: 0.1,
};

export interface ProgressionState {
  /** Mean accuracy over the window so far, or null before anything is played. */
  accuracy: number | null;
  /** Exercises completed towards the next decision. */
  completed: number;
  needed: number;
  /** True once the window is full and the threshold met. */
  ready: boolean;
  atCeiling: boolean;
}

export function progressionState(
  level: number,
  recent: readonly number[],
  config: ProgressionConfig = DEFAULT_PROGRESSION,
): ProgressionState {
  const window = recent.slice(-config.windowSize);
  const accuracy =
    window.length === 0 ? null : window.reduce((sum, value) => sum + value, 0) / window.length;
  const atCeiling = level >= MAX_LEVEL;
  return {
    accuracy,
    completed: window.length,
    needed: config.windowSize,
    ready:
      !atCeiling &&
      window.length >= config.windowSize &&
      accuracy !== null &&
      accuracy >= config.threshold,
    atCeiling,
  };
}

/**
 * The level after taking `recent` into account. Returns the same level when the
 * window is not yet full or the average falls short, so the caller can apply the
 * result unconditionally.
 */
export function advanceLevel(
  level: number,
  recent: readonly number[],
  config: ProgressionConfig = DEFAULT_PROGRESSION,
): number {
  return progressionState(level, recent, config).ready
    ? clampLevel(level + config.step)
    : clampLevel(level);
}
