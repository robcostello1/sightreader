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
 * deliberately wide: guitar intonation, bent strings and pitch-detector jitter
 * all bias readings, and the occupancy model already filters noise by majority.
 */
export function matchesTarget(hz: number, target: Midi, toleranceCents = 50): boolean {
  return Math.abs(centsFromTarget(hz, target)) <= toleranceCents;
}

export function midiToName(midi: Midi): string {
  const name = SHARP_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}
