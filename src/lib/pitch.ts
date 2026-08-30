import type { Midi } from './types';

const A4_MIDI = 69;
const A4_HZ = 440;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToHz(midi: Midi, a4 = A4_HZ): number {
  return a4 * 2 ** ((midi - A4_MIDI) / 12);
}

export function hzToMidi(hz: number, a4 = A4_HZ): number {
  return A4_MIDI + 12 * Math.log2(hz / a4);
}

/** Signed distance in cents from `hz` to the nearest equal-tempered semitone. */
export function centsOffset(hz: number, a4 = A4_HZ): number {
  const exact = hzToMidi(hz, a4);
  return (exact - Math.round(exact)) * 100;
}

/** Cents between a detected frequency and a target MIDI note. */
export function centsFromTarget(hz: number, target: Midi, a4 = A4_HZ): number {
  return (hzToMidi(hz, a4) - target) * 100;
}

/**
 * Whether a detected frequency counts as the target note. Tolerance is
 * deliberately wide: intonation, embouchure, a bent string and pitch-detector
 * jitter all bias readings, and the occupancy model already filters noise by
 * majority.
 */
export function matchesTarget(hz: number, target: Midi, toleranceCents = 50): boolean {
  return Math.abs(centsFromTarget(hz, target)) <= toleranceCents;
}

/** Nearest equal-tempered semitone to a detected frequency. */
export function nearestMidi(hz: number, a4 = A4_HZ): Midi {
  return Math.round(hzToMidi(hz, a4));
}

/**
 * Parses a scientific pitch name such as "Bb3" or "F#5". Accepts flats and
 * sharps so instrument ranges can be written the way they are spoken.
 */
export function nameToMidi(name: string): Midi {
  const parsed = /^([A-Ga-g])([#b]*)(-?\d+)$/.exec(name.trim());
  if (!parsed) throw new Error(`unparseable pitch name: ${name}`);
  const [, letter, accidentals, octave] = parsed;
  const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter.toUpperCase()]!;
  const alter = [...accidentals].reduce((sum, c) => sum + (c === '#' ? 1 : -1), 0);
  return (Number(octave) + 1) * 12 + natural + alter;
}

export function midiToName(midi: Midi): string {
  const name = SHARP_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}
