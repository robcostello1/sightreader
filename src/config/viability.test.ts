import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIABILITY,
  fastestViableBpm,
  isViable,
  noteDurationMs,
  periodsAvailable,
  requiredPeriods,
  type ViabilityConfig,
} from './viability';
import { DEFAULT_SCORING } from './levels';
import { midiToHz, nameToMidi } from '../lib/pitch';
import { NOTE_VALUES } from '../lib/types';

/** The placeholders, but switched on, which is what the logic is tested at. */
const CONFIG: ViabilityConfig = { ...DEFAULT_VIABILITY, enabled: true };
const hz = (name: string) => midiToHz(nameToMidi(name));

describe('the configuration', () => {
  it('ships off, since the numbers are still guesses', () => {
    // Gating real exercises on a placeholder margin is either needlessly
    // restrictive or not restrictive enough, and there is no way to know which.
    expect(DEFAULT_VIABILITY.enabled).toBe(false);
  });

  it('lets everything through while it is off', () => {
    // A semiquaver on the lowest note of a piano at a tempo nothing could
    // score: still allowed, because the gate is not live.
    expect(isViable(hz('A0'), NOTE_VALUES.sixteenth, 4, 240, DEFAULT_VIABILITY)).toBe(true);
    expect(fastestViableBpm(hz('A0'), NOTE_VALUES.sixteenth, 4, DEFAULT_VIABILITY)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('skips the same window head the scorer does', () => {
    // Both are the attack transient, measured by the same spike. If one moves
    // and the other does not, that has to be a decision rather than a drift:
    // the generator would be gating on one number while the scorer used
    // another.
    expect(DEFAULT_VIABILITY.attackExclusionMs).toBe(DEFAULT_SCORING.attackGuardMs);
  });
});

describe('the formula', () => {
  it('measures a note in beats, not in whole notes', () => {
    // A quaver is half a beat in 4/4 and a whole beat in 6/8, so the same
    // symbol lasts twice as long in compound time.
    expect(noteDurationMs(NOTE_VALUES.quarter, 4, 60)).toBeCloseTo(1000, 6);
    expect(noteDurationMs(NOTE_VALUES.eighth, 4, 60)).toBeCloseTo(500, 6);
    expect(noteDurationMs(NOTE_VALUES.eighth, 8, 60)).toBeCloseTo(1000, 6);
  });

  it('counts cycles in what is left after the attack', () => {
    // 440Hz for a crotchet at 60bpm: 1000ms less the 40ms attack, at 2.27ms a
    // cycle, is a shade over 422 of them.
    expect(periodsAvailable(440, NOTE_VALUES.quarter, 4, 60, CONFIG)).toBeCloseTo(422.4, 1);
  });

  it('gives a note shorter than its own attack nothing to work with', () => {
    // Not a negative count: there is simply no window left.
    expect(periodsAvailable(440, NOTE_VALUES.sixteenth, 4, 600, CONFIG)).toBe(0);
  });

  it('applies the margin over the theoretical floor', () => {
    expect(requiredPeriods(CONFIG)).toBeCloseTo(4.5, 9);
  });
});

describe('what the gate actually rejects', () => {
  it('bites in the bass, where cycles are long', () => {
    // E1 is 41Hz: a period is 24ms, so 4.5 of them need 110ms of note on top
    // of the 40ms attack. A semiquaver at 200bpm in 4/4 lasts 75ms.
    expect(isViable(hz('E1'), NOTE_VALUES.sixteenth, 4, 200, CONFIG)).toBe(false);
    // The same note held for a crotchet is fine.
    expect(isViable(hz('E1'), NOTE_VALUES.quarter, 4, 200, CONFIG)).toBe(true);
  });

  it('barely troubles the treble, where they are short', () => {
    // A5 is 880Hz: 4.5 cycles take 5ms, so anything with 5ms left after its
    // attack passes — which at these values is anything at all.
    expect(isViable(hz('A5'), NOTE_VALUES.sixteenth, 4, 200, CONFIG)).toBe(true);
    expect(isViable(hz('A5'), NOTE_VALUES.sixteenth, 4, 300, CONFIG)).toBe(true);
  });

  it('runs out for every pitch once the note is shorter than its own attack', () => {
    // A semiquaver at 400bpm lasts 37.5ms and the attack alone is 40. Nothing
    // is left to count, however high the note — this is the pitch-independent
    // floor underneath the pitch-dependent one.
    for (const name of ['E1', 'E2', 'A5', 'C7']) {
      expect(isViable(hz(name), NOTE_VALUES.sixteenth, 4, 400, CONFIG)).toBe(false);
    }
  });

  it('is a ceiling on tempo, pitch and note value together', () => {
    // The same pitch and value, only faster, is where a passing note fails.
    const value = NOTE_VALUES.eighth;
    expect(isViable(hz('E2'), value, 4, 100, CONFIG)).toBe(true);
    expect(isViable(hz('E2'), value, 4, 400, CONFIG)).toBe(false);
  });
});

describe('fastestViableBpm', () => {
  it('is the tempo where the note stops passing', () => {
    for (const name of ['E1', 'E2', 'A3', 'A5']) {
      for (const value of [NOTE_VALUES.sixteenth, NOTE_VALUES.eighth, NOTE_VALUES.quarter]) {
        const limit = fastestViableBpm(hz(name), value, 4, CONFIG);
        expect(isViable(hz(name), value, 4, limit - 0.01, CONFIG)).toBe(true);
        expect(isViable(hz(name), value, 4, limit + 0.01, CONFIG)).toBe(false);
      }
    }
  });

  it('rises with the register', () => {
    const at = (name: string) => fastestViableBpm(hz(name), NOTE_VALUES.eighth, 4, CONFIG);
    expect(at('E2')).toBeGreaterThan(at('E1'));
    expect(at('E4')).toBeGreaterThan(at('E2'));
  });
});
