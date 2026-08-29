/**
 * Build order step 5: the idiom library — relative scale-degree patterns, so a
 * single shape can be instantiated in any key, at any starting degree, and at
 * any rhythmic density. See spec §4.
 */
export {
  ARPEGGIO_IDIOMS,
  CADENTIAL_IDIOMS,
  IDIOM_LIBRARY,
  INTERVAL_IDIOMS,
  SCALAR_IDIOMS,
  idiomById,
} from './library';
export {
  idiomDuration,
  instantiateIdiom,
  maxLocalInterval,
  placementPitches,
  placementRange,
} from './instantiate';
export type { IdiomPlacement } from './instantiate';
export { MAJOR_SCALE, degreeToMidi, degreeToSemitones, isDiatonic } from './scale';
