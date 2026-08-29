/**
 * Build order step 6: procedural exercise generator. Instantiates idioms
 * against a region pool under the local-interval constraint, with weighted
 * starting-pitch selection favouring the extremes of the range.
 */
export { generateExercise } from './generate';
export type { GenerateOptions } from './generate';
export { startPitchWeight, validPlacements } from './placement';
export type { PlacementConstraints } from './placement';
export { mulberry32, pick, randomInt, weightedPick } from './rng';
export type { Rng } from './rng';
