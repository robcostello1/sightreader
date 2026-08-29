import type { NoteValue } from './types';

/** Undotted note values, longest first, as fractions of a whole note. */
export const STANDARD_VALUES: NoteValue[] = [2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625];

/** VexFlow duration code for each standard value. */
const CODES = new Map<NoteValue, string>([
  [2, '1/2'],
  [1, 'w'],
  [0.5, 'h'],
  [0.25, 'q'],
  [0.125, '8'],
  [0.0625, '16'],
  [0.03125, '32'],
  [0.015625, '64'],
]);

export interface NotatedValue {
  /** VexFlow duration code, e.g. 'q'. */
  code: string;
  /** 0, 1 or 2 augmentation dots. */
  dots: number;
}

const EPSILON = 1e-9;

/**
 * Resolves a duration to a single notatable symbol, dots included, or null if no
 * single symbol covers it. A dot adds half the value, a second dot another
 * quarter — so a value is notatable alone only at 1x, 1.5x or 1.75x a standard.
 */
export function toNotated(value: NoteValue): NotatedValue | null {
  for (const base of STANDARD_VALUES) {
    const code = CODES.get(base)!;
    for (const dots of [0, 1, 2]) {
      const multiplier = dots === 0 ? 1 : dots === 1 ? 1.5 : 1.75;
      if (Math.abs(value - base * multiplier) < EPSILON) return { code, dots };
    }
  }
  return null;
}

/**
 * Greedily splits a duration into standard values. Used to fill leftover space
 * with rests that can actually be drawn, rather than leaving a note at some
 * arbitrary length no symbol represents.
 */
export function decompose(value: NoteValue): NoteValue[] {
  const parts: NoteValue[] = [];
  let remaining = value;
  for (const standard of STANDARD_VALUES) {
    while (remaining >= standard - EPSILON) {
      parts.push(standard);
      remaining -= standard;
    }
    if (remaining < EPSILON) break;
  }
  return parts;
}

export function isNotatable(value: NoteValue): boolean {
  return toNotated(value) !== null;
}
