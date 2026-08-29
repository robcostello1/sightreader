import type { Midi } from './types';

/** Semitones above C for each letter name. */
const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

export interface MusicalKey {
  /** VexFlow key signature name, e.g. 'Bb'. */
  name: string;
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  /** Sharps as positive, flats as negative. Magnitude is the difficulty. */
  accidentals: number;
}

/**
 * Ordered by how many accidentals the signature carries, which is the order a
 * learner meets them. Guitar-friendly keys are favoured within each count:
 * sharp keys before their flat equivalents, since open strings sit in them.
 */
export const KEYS: MusicalKey[] = [
  { name: 'C', tonic: 0, accidentals: 0 },
  { name: 'G', tonic: 7, accidentals: 1 },
  { name: 'F', tonic: 5, accidentals: -1 },
  { name: 'D', tonic: 2, accidentals: 2 },
  { name: 'Bb', tonic: 10, accidentals: -2 },
  { name: 'A', tonic: 9, accidentals: 3 },
  { name: 'Eb', tonic: 3, accidentals: -3 },
  { name: 'E', tonic: 4, accidentals: 4 },
  { name: 'Ab', tonic: 8, accidentals: -4 },
  { name: 'B', tonic: 11, accidentals: 5 },
  { name: 'Db', tonic: 1, accidentals: -5 },
];

export function keyByName(name: string): MusicalKey {
  const found = KEYS.find((key) => key.name === name);
  if (!found) throw new Error(`unknown key: ${name}`);
  return found;
}

export interface SpelledNote {
  /** Letter name, 'A'–'G'. */
  letter: string;
  /** -2..2 semitones; -1 is a flat, 1 a sharp. */
  alter: number;
  octave: number;
}

/**
 * Letter and alteration for each degree of a key's scale.
 *
 * Built by walking letters upwards from the tonic and asking what alteration
 * each needs to land on the major scale — which is why F major yields B flat
 * rather than A sharp. Spelling has to follow the key, not the MIDI number.
 */
function scaleSpelling(key: MusicalKey): Map<number, { letter: string; alter: number }> {
  const tonicLetter = LETTERS.indexOf(
    (key.name[0] as (typeof LETTERS)[number]) ?? 'C',
  );
  const spelling = new Map<number, { letter: string; alter: number }>();

  for (let degree = 0; degree < 7; degree++) {
    const letterIndex = (tonicLetter + degree) % 7;
    const letter = LETTERS[letterIndex];
    const wanted = (key.tonic + MAJOR_STEPS[degree]) % 12;
    const natural = NATURAL_SEMITONES[letterIndex];
    // Shortest signed distance from the natural letter to the wanted pitch.
    const alter = ((wanted - natural + 18) % 12) - 6;
    spelling.set(wanted, { letter, alter });
  }
  return spelling;
}

const SPELLING_CACHE = new Map<string, Map<number, { letter: string; alter: number }>>();

function spellingFor(key: MusicalKey) {
  let cached = SPELLING_CACHE.get(key.name);
  if (!cached) {
    cached = scaleSpelling(key);
    SPELLING_CACHE.set(key.name, cached);
  }
  return cached;
}

/**
 * Spells a MIDI note within a key. Notes outside the scale borrow the
 * neighbouring letter — sharpened from below in sharp keys, flattened from
 * above in flat keys — so chromatic passing tones read the way the key implies.
 */
export function spellInKey(midi: Midi, key: MusicalKey): SpelledNote {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const diatonic = spellingFor(key).get(pitchClass);

  if (diatonic) {
    return { ...diatonic, octave: octaveFor(midi, diatonic.letter, diatonic.alter) };
  }

  const useFlats = key.accidentals < 0;
  const neighbour = spellingFor(key).get(((pitchClass + (useFlats ? 1 : -1)) % 12 + 12) % 12);
  if (neighbour) {
    const alter = neighbour.alter + (useFlats ? -1 : 1);
    return { letter: neighbour.letter, alter, octave: octaveFor(midi, neighbour.letter, alter) };
  }

  // Unreachable for the twelve keys above, but a sane fallback beats a throw.
  return { letter: 'C', alter: 0, octave };
}

/**
 * Octave number for a spelled note. Derived from the letter's natural pitch, not
 * the MIDI number, so B#3 stays in octave 3 rather than jumping to 4.
 */
function octaveFor(midi: Midi, letter: string, alter: number): number {
  const natural = NATURAL_SEMITONES[LETTERS.indexOf(letter as (typeof LETTERS)[number])];
  return Math.round((midi - alter - natural) / 12) - 1;
}

/** Renders a spelled note as it should read on screen, e.g. "Bb3". */
export function formatSpelled({ letter, alter, octave }: SpelledNote): string {
  const accidental = alter === 0 ? '' : alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
  return `${letter}${accidental}${octave}`;
}

export function isInKey(midi: Midi, key: MusicalKey): boolean {
  return spellingFor(key).has(((midi % 12) + 12) % 12);
}

/** Every key whose signature carries at most `max` accidentals. */
export function keysUpTo(max: number): MusicalKey[] {
  return KEYS.filter((key) => Math.abs(key.accidentals) <= max);
}
