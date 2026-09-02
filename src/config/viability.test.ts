import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIABILITY,
  isViable,
  noteDurationMs,
  periodsAvailable,
  requiredPeriods,
  shortestViableValue,
  type ViabilityConfig,
} from './viability';
import { DEFAULT_SCORING } from './levels';
import { midiToHz, nameToMidi } from '../lib/pitch';
import { NOTE_VALUES } from '../lib/types';

const CONFIG = DEFAULT_VIABILITY;
const OFF: ViabilityConfig = { ...DEFAULT_VIABILITY, enabled: false };
const hz = (name: string) => midiToHz(nameToMidi(name));

describe('the configuration', () => {
  it('is on, because nothing else is protecting the player now', () => {
    // The blunt limits it replaced — a tempo cap and six disabled instruments —
    // are gone, so this is the only thing between a player and a note nothing
    // can score.
    expect(DEFAULT_VIABILITY.enabled).toBe(true);
  });

  it('can still be switched off in one place', () => {
    expect(isViable(hz('A0'), NOTE_VALUES.sixteenth, 4, 240, OFF)).toBe(true);
    expect(shortestViableValue([nameToMidi('C4')], 4, 240, OFF)).toBe(NOTE_VALUES.sixteenth);
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

describe('the three ways a note can be unscoreable', () => {
  it('rejects a frequency the detector cannot resolve, however long it is held', () => {
    // A 2048-sample frame at 44.1kHz spans 46ms, and a pitch needs 1.5 cycles
    // inside one frame to be named — holding the note longer puts no more of it
    // in there. The piano's bottom three keys are under that.
    for (const name of ['A0', 'B0']) {
      expect(hz(name)).toBeLessThan(CONFIG.resolutionFloorHz);
      expect(isViable(hz(name), NOTE_VALUES.whole, 4, 60, CONFIG)).toBe(false);
    }
    // A semitone higher and the same whole note is fine.
    expect(isViable(hz('C1'), NOTE_VALUES.whole, 4, 60, CONFIG)).toBe(true);
  });

  it('rejects a frequency above the band, where readings come back an octave flat', () => {
    // The mirror of the floor: past ~13 samples per period the peak an octave
    // down is the better-resolved one, so a note up there is confidently wrong
    // rather than merely noisy. A piccolo's top notes live here.
    for (const name of ['A7', 'C8']) {
      expect(hz(name)).toBeGreaterThan(CONFIG.resolutionCeilingHz);
      expect(isViable(hz(name), NOTE_VALUES.whole, 4, 60, CONFIG)).toBe(false);
    }
    expect(isViable(hz('G#7'), NOTE_VALUES.whole, 4, 60, CONFIG)).toBe(true);
  });

  it('rejects a note with too few cycles of itself, which bites in the bass', () => {
    // A2 is 110Hz: 4.5 cycles need 41ms on top of the 40ms attack.
    expect(isViable(hz('A2'), NOTE_VALUES.quarter, 4, 200, CONFIG)).toBe(true);
    expect(isViable(hz('A2'), NOTE_VALUES.sixteenth, 4, 200, CONFIG)).toBe(false);
  });

  it('rejects a note with too few detector frames, whatever its pitch', () => {
    // The rule the tempo cap used to enforce, applied per note instead. The
    // detector reports once per hop however high the note, so this one is
    // pitch-independent: a semiquaver at 240bpm is 62ms, and four frames need
    // 46ms on top of the attack.
    for (const name of ['A2', 'A5', 'C7']) {
      expect(isViable(hz(name), NOTE_VALUES.sixteenth, 4, 240, CONFIG, DEFAULT_SCORING)).toBe(false);
      // The same note at a longer value passes.
      expect(isViable(hz(name), NOTE_VALUES.quarter, 4, 240, CONFIG, DEFAULT_SCORING)).toBe(true);
    }
  });

  it('leaves the treble alone at ordinary tempos', () => {
    expect(isViable(hz('A5'), NOTE_VALUES.sixteenth, 4, 120, CONFIG, DEFAULT_SCORING)).toBe(true);
  });
});

describe('shortestViableValue', () => {
  const pool = (low: string, high: string) => {
    const from = nameToMidi(low);
    return Array.from({ length: nameToMidi(high) - from + 1 }, (_, i) => from + i);
  };

  it('answers with a note length rather than a tempo', () => {
    // The per-range question is "how short can a note be down here", not "how
    // fast may you play" — nothing stops the player choosing 240bpm.
    const value = shortestViableValue(pool('E1', 'G3'), 4, 240, CONFIG, DEFAULT_SCORING);
    expect(value).toBeGreaterThan(NOTE_VALUES.sixteenth);
  });

  it('answers from the lowest note it could write, not the lowest note there is', () => {
    // The piano's bottom keys are under the resolution floor, so they are absent
    // from every exercise whatever their length. Letting them set the range's
    // shortest value would report null for an instrument that plays perfectly
    // well an octave up.
    const grand = pool('A0', 'G3');
    expect(shortestViableValue(grand, 4, 120, CONFIG, DEFAULT_SCORING)).not.toBeNull();
    // A range that is entirely below the floor has nothing to say.
    expect(shortestViableValue(pool('A0', 'B0'), 4, 120, CONFIG, DEFAULT_SCORING)).toBeNull();
  });

  it('asks less of a high range than a low one', () => {
    const flute = shortestViableValue(pool('C4', 'C7'), 4, 120, CONFIG, DEFAULT_SCORING)!;
    const cello = shortestViableValue(pool('C2', 'C5'), 4, 120, CONFIG, DEFAULT_SCORING)!;
    expect(flute).toBeLessThanOrEqual(cello);
  });

  it('gets shorter as the tempo drops', () => {
    const bass = pool('C2', 'C4');
    const fast = shortestViableValue(bass, 4, 240, CONFIG, DEFAULT_SCORING)!;
    const slow = shortestViableValue(bass, 4, 60, CONFIG, DEFAULT_SCORING)!;
    expect(slow).toBeLessThan(fast);
  });

  it('has nothing to say about an empty range', () => {
    expect(shortestViableValue([], 4, 120, CONFIG)).toBeNull();
  });
});
