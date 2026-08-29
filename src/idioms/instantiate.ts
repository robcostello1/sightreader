import { degreeToMidi } from './scale';
import type {
  ExerciseNote,
  Idiom,
  Midi,
  NoteValue,
  ScaleDegree,
} from '../lib/types';

export interface IdiomPlacement {
  idiom: Idiom;
  /** Degree the idiom is anchored on, relative to the key centre. */
  startDegree: ScaleDegree;
  keyCenter: Midi;
  /**
   * Note value for one beat of the idiom's relative rhythm. This is the dial
   * that renders the same shape at a different density: a triad at whole notes
   * and the same triad at quavers are one idiom, not two.
   */
  unitValue: NoteValue;
}

/** Concrete pitches an idiom would produce, rests omitted. */
export function placementPitches(placement: IdiomPlacement): Midi[] {
  const { idiom, startDegree, keyCenter } = placement;
  return idiom.events.flatMap((event) =>
    event.degree === null
      ? []
      : [degreeToMidi(keyCenter, startDegree + event.degree, event.alteration ?? 0)],
  );
}

export function instantiateIdiom(placement: IdiomPlacement, instance = 0): ExerciseNote[] {
  const { idiom, startDegree, keyCenter, unitValue } = placement;
  return idiom.events.map((event) => ({
    midi:
      event.degree === null
        ? null
        : degreeToMidi(keyCenter, startDegree + event.degree, event.alteration ?? 0),
    value: event.beats * unitValue,
    idiomId: idiom.id,
    instance,
  }));
}

/**
 * Largest jump between consecutive pitches, in semitones.
 *
 * Measured per placement rather than per idiom, because a diatonic third is
 * three semitones in some positions and four in others — the local movement
 * constraint has to be checked where the idiom actually lands.
 */
export function maxLocalInterval(placement: IdiomPlacement): number {
  const pitches = placementPitches(placement);
  let largest = 0;
  for (let i = 1; i < pitches.length; i++) {
    largest = Math.max(largest, Math.abs(pitches[i] - pitches[i - 1]));
  }
  return largest;
}

export function placementRange(placement: IdiomPlacement): { low: Midi; high: Midi } {
  const pitches = placementPitches(placement);
  return { low: Math.min(...pitches), high: Math.max(...pitches) };
}

/** Total duration in whole-note units, for fitting idioms into bars. */
export function idiomDuration(idiom: Idiom, unitValue: NoteValue): NoteValue {
  return idiom.events.reduce((total, event) => total + event.beats, 0) * unitValue;
}
