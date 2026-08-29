/**
 * Build order step 3: tempo + count-in scheduler. Owns t0 (the count-in's
 * reference timestamp) and turns an Exercise into NoteWindows on the
 * AudioContext clock. Also drives the metronome click.
 */
export {
  beatDurationMs,
  buildSchedule,
  detectFalseStart,
  noteDurationMs,
  windowAt,
} from './schedule';
export type { ClickEvent, Schedule, ScheduleOptions } from './schedule';
export { scheduleClicks } from './metronome';
export type { MetronomeOptions, ScheduledClicks } from './metronome';
