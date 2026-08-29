/**
 * Build order step 4: windowed occupancy scorer. Consumes the PitchSample
 * stream against scheduled NoteWindows and emits binary pass/fail NoteResults.
 */
export { expectedSampleCount, scoreExercise, scoreWindow, summarise } from './score';
export type { ExerciseSummary } from './score';
