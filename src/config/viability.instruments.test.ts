import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, positionById, soundingPool } from './instruments';
import { DEFAULT_VIABILITY, fastestViableBpmForPool, isViable, type ViabilityConfig } from './viability';
import { midiToHz } from '../lib/pitch';
import { NOTE_VALUES } from '../lib/types';

const CONFIG: ViabilityConfig = { ...DEFAULT_VIABILITY, enabled: true };
const gated = INSTRUMENTS.filter((instrument) => instrument.status === 'comingSoon');
const lowestOf = (id: string) => {
  const instrument = INSTRUMENTS.find((i) => i.id === id)!;
  return Math.min(...soundingPool(instrument, positionById(instrument, null)));
};

/**
 * Evidence for the question the spec leaves to the spike: does any instrument
 * fail this check across its *whole* range, at any tempo and value the
 * generator would reasonably produce?
 *
 * On the placeholder constants the answer is no, for all eight. Recorded as a
 * test rather than a claim, so the calibrated numbers either confirm it or
 * fail here and force the conversation.
 */
describe('what the check says about the blanket instrument gate', () => {
  it('lets every gated instrument play its lowest note at a moderate tempo', () => {
    // Even the tuba's D1, at 37Hz the lowest note in the catalogue.
    for (const instrument of gated) {
      const low = midiToHz(lowestOf(instrument.id));
      expect(isViable(low, NOTE_VALUES.quarter, 4, 120, CONFIG)).toBe(true);
      expect(isViable(low, NOTE_VALUES.eighth, 4, 120, CONFIG)).toBe(true);
    }
  });

  it('finds no instrument whose whole range fails, which is what the flag implies', () => {
    // The flag disables an instrument outright. This check would only justify
    // that for one that cannot be scored anywhere, at any value — and none of
    // the eight is that.
    for (const instrument of gated) {
      const pool = soundingPool(instrument, positionById(instrument, null));
      expect(fastestViableBpmForPool(pool, NOTE_VALUES.quarter, 4, CONFIG)).toBeGreaterThan(120);
    }
  });

  it('only bites at short values in the bottom of a low range', () => {
    // Which is the narrow thing it is for. Semiquavers on a tuba's lowest
    // notes fail at 120bpm; nothing else here does.
    const failing = gated.filter(
      (instrument) => !isViable(midiToHz(lowestOf(instrument.id)), NOTE_VALUES.sixteenth, 4, 120, CONFIG),
    );
    expect(failing.map((i) => i.id)).toEqual([
      'double-bass',
      'french-horn',
      'tuba',
      'bass-guitar',
    ]);
  });

  it('does not answer the question the flag was actually asking', () => {
    // §6a holds these back because detection is unproven below the guitar's
    // low E — octave errors and microphone roll-off, not cycle count. A note
    // can hold a thousand cycles and still be heard an octave out. Un-gating
    // on the strength of this check alone would be answering a different
    // question, so the flag stays until the spike speaks to that one.
    for (const instrument of gated) {
      expect(instrument.status).toBe('comingSoon');
    }
  });
});
