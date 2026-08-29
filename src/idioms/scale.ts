import type { Midi, ScaleDegree } from '../lib/types';

/** Semitone offsets of the major scale degrees. */
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;

/**
 * Degrees are unbounded in both directions: -1 is the leading tone below the
 * tonic, 7 is the octave. Idioms are stored as degree offsets precisely so the
 * same shape can be dropped anywhere without rewriting it.
 */
export function degreeToSemitones(degree: ScaleDegree): number {
  const octave = Math.floor(degree / 7);
  const index = degree - octave * 7;
  return octave * 12 + MAJOR_SCALE[index];
}

export function degreeToMidi(keyCenter: Midi, degree: ScaleDegree, alteration = 0): Midi {
  return keyCenter + degreeToSemitones(degree) + alteration;
}

/** Whether a pitch belongs to the key, used to keep accidentals deliberate. */
export function isDiatonic(keyCenter: Midi, midi: Midi): boolean {
  const offset = (((midi - keyCenter) % 12) + 12) % 12;
  return MAJOR_SCALE.includes(offset as (typeof MAJOR_SCALE)[number]);
}
