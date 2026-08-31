import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, positionById, soundingPool } from './instruments';
import { DEFAULT_SCORING } from './levels';
import { DEFAULT_VIABILITY, isViable, shortestViableValue } from './viability';
import { midiToHz, midiToName } from '../lib/pitch';
import { NOTE_VALUES } from '../lib/types';

const CONFIG = DEFAULT_VIABILITY;
const poolFor = (id: string) => {
  const instrument = INSTRUMENTS.find((i) => i.id === id)!;
  return soundingPool(instrument, positionById(instrument, null));
};

/**
 * What replaced the blanket instrument flag, checked against the instruments
 * that used to carry it.
 */
describe('the low instruments, now that none of them is held back', () => {
  const formerlyGated = [
    'cello',
    'double-bass',
    'bass-clarinet-bb',
    'bassoon',
    'baritone-sax',
    'french-horn',
    'tuba',
    'bass-guitar',
  ];

  it('every one of them is playable', () => {
    for (const id of formerlyGated) {
      expect(INSTRUMENTS.find((i) => i.id === id)!.status).toBe('available');
    }
  });

  it('every one of them has notes worth writing at a walking tempo', () => {
    // Which is what makes the blanket flag the wrong shape: none of these
    // failed everywhere, they failed in a corner.
    for (const id of formerlyGated) {
      expect(shortestViableValue(poolFor(id), 4, 120, CONFIG, DEFAULT_SCORING)).not.toBeNull();
    }
  });

  it('loses only the bottom of the bottom, to the resolution floor', () => {
    // Under about 43Hz the detector cannot resolve a pitch at all, so those
    // notes are absent however long they are held. It costs the four
    // instruments that reach that low a few semitones each, not a range.
    const lost: Record<string, string[]> = {};
    for (const id of formerlyGated) {
      const unresolvable = poolFor(id).filter((midi) => midiToHz(midi) < CONFIG.resolutionFloorHz);
      if (unresolvable.length > 0) lost[id] = unresolvable.map(midiToName);
    }
    expect(lost).toEqual({
      'double-bass': ['E1'],
      'french-horn': ['E1'],
      tuba: ['D1', 'D#1', 'E1'],
      'bass-guitar': ['E1'],
    });
    // One semitone off a bass, three off a tuba. Recovering them means a longer
    // detector frame for low registers, which is a detector change rather than
    // a constant — see ViabilityConfig.resolutionFloorHz.
  });

  it('keeps the short values away from the low register, which is the point', () => {
    // A tuba may be played at any tempo; at speed it is given longer notes.
    const tuba = poolFor('tuba');
    expect(shortestViableValue(tuba, 4, 60, CONFIG, DEFAULT_SCORING)).toBeLessThan(
      shortestViableValue(tuba, 4, 240, CONFIG, DEFAULT_SCORING)!,
    );
  });

  it('leaves a high instrument free of all of it', () => {
    const piccolo = poolFor('piccolo');
    expect(shortestViableValue(piccolo, 4, 120, CONFIG, DEFAULT_SCORING)).toBe(
      NOTE_VALUES.sixteenth,
    );
    expect(
      isViable(midiToHz(Math.min(...piccolo)), NOTE_VALUES.sixteenth, 4, 120, CONFIG, DEFAULT_SCORING),
    ).toBe(true);
  });
});
