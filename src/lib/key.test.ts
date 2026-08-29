import { describe, expect, it } from 'vitest';
import { KEYS, isInKey, keyByName, keysUpTo, spellInKey } from './key';

const spell = (midi: number, key: string) => {
  const s = spellInKey(midi, keyByName(key));
  return `${s.letter}${s.alter === -1 ? 'b' : s.alter === 1 ? '#' : ''}${s.octave}`;
};

describe('key catalogue', () => {
  it('is ordered by how many accidentals the signature carries', () => {
    const counts = KEYS.map((k) => Math.abs(k.accidentals));
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it('filters by difficulty', () => {
    expect(keysUpTo(0).map((k) => k.name)).toEqual(['C']);
    expect(keysUpTo(1).map((k) => k.name)).toEqual(['C', 'G', 'F']);
    expect(keysUpTo(2).map((k) => k.name)).toEqual(['C', 'G', 'F', 'D', 'Bb']);
  });
});

describe('spellInKey', () => {
  it('spells C major with no alterations', () => {
    expect([60, 62, 64, 65, 67, 69, 71].map((m) => spell(m, 'C'))).toEqual([
      'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
    ]);
  });

  it('spells F major with a B flat, not an A sharp', () => {
    // The whole point of spelling by key rather than by MIDI number.
    expect(spell(70, 'F')).toBe('Bb4');
    expect(spell(70, 'G')).toBe('A#4');
  });

  it('spells sharp keys with sharps', () => {
    expect([66, 61].map((m) => spell(m, 'D'))).toEqual(['F#4', 'C#4']);
  });

  it('spells flat keys with flats', () => {
    expect([70, 63].map((m) => spell(m, 'Bb'))).toEqual(['Bb4', 'Eb4']);
  });

  it('spells chromatic notes in the direction the key implies', () => {
    // Not in C major: a sharp key borrows from below, a flat key from above.
    expect(spell(61, 'C')).toBe('C#4');
    expect(spell(61, 'F')).toBe('Db4');
  });

  it('keeps octave numbers tied to the letter, not the MIDI number', () => {
    expect(spell(60, 'C')).toBe('C4');
    expect(spell(59, 'C')).toBe('B3');
  });

  it('spells every chromatic pitch in every key without throwing', () => {
    for (const key of KEYS) {
      for (let midi = 40; midi <= 84; midi++) {
        const spelled = spellInKey(midi, key);
        expect(spelled.letter).toMatch(/^[A-G]$/);
        expect(Math.abs(spelled.alter)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('round-trips: the spelled note names the pitch it was given', () => {
    const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    for (const key of KEYS) {
      for (let midi = 40; midi <= 84; midi++) {
        const { letter, alter, octave } = spellInKey(midi, key);
        expect((octave + 1) * 12 + natural[letter] + alter).toBe(midi);
      }
    }
  });
});

describe('isInKey', () => {
  it('knows the scale of each key', () => {
    expect(isInKey(70, keyByName('F'))).toBe(true); // Bb
    expect(isInKey(70, keyByName('C'))).toBe(false);
    expect(isInKey(66, keyByName('G'))).toBe(true); // F#
  });
});
