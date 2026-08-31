/**
 * Build order step 3: tempo + count-in scheduler. Owns t0 (the count-in's
 * reference timestamp) and turns an Exercise into NoteWindows on the
 * AudioContext clock. Also drives the metronome click.
 */
export {
  beatDurationMs,
  buildSchedule,
  countInBarsFor,
  isCompound,
  noteDurationMs,
  windowAt,
} from './schedule';
export type { ClickEvent, Schedule, ScheduleOptions } from './schedule';
export { ACCENT_HZ, CLICK_HZ, CLICK_MS, isClickBleed, scheduleClicks } from './metronome';
export type { MetronomeOptions, ScheduledClicks } from './metronome';
