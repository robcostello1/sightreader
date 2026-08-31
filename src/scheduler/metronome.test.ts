import { describe, expect, it } from 'vitest';
import { ACCENT_HZ, CLICK_HZ, isClickBleed } from './metronome';
import { midiToHz } from '../lib/pitch';
import type { ClickEvent } from './schedule';
import type { PitchSample } from '../lib/types';

const clicks: ClickEvent[] = [
  { timeMs: 1000, accent: true, phase: 'exercise' },
  { timeMs: 2000, accent: false, phase: 'exercise' },
];

const sample = (hz: number | null, timestamp: number): PitchSample => ({
  hz,
  confidence: 0.95,
  timestamp,
});

describe('isClickBleed', () => {
  it('knows its own click, on the beat and at its own pitch', () => {
    expect(isClickBleed(sample(CLICK_HZ, 2005), clicks)).toBe(true);
    expect(isClickBleed(sample(ACCENT_HZ, 1005), clicks)).toBe(true);
  });

  it('allows for the trip out of the speaker and back, and no longer', () => {
    expect(isClickBleed(sample(CLICK_HZ, 2060), clicks)).toBe(true);
    expect(isClickBleed(sample(CLICK_HZ, 2400), clicks)).toBe(false);
    // Nothing before the click has heard it.
    expect(isClickBleed(sample(CLICK_HZ, 1990), clicks)).toBe(false);
  });

  it('takes the accent for the accent, not for the plain click', () => {
    // The two are a fifth apart, so neither may stand in for the other.
    expect(isClickBleed(sample(CLICK_HZ, 1005), clicks)).toBe(false);
    expect(isClickBleed(sample(ACCENT_HZ, 2005), clicks)).toBe(false);
  });

  it('catches the octave errors a pure tone provokes', () => {
    expect(isClickBleed(sample(CLICK_HZ * 2, 2005), clicks)).toBe(true);
    expect(isClickBleed(sample(CLICK_HZ / 2, 2005), clicks)).toBe(true);
  });

  it('leaves the player alone, on the beat and off it', () => {
    // Matching the moment alone would blind the display on every beat, which is
    // exactly where the player's own attack falls.
    expect(isClickBleed(sample(midiToHz(60), 2005), clicks)).toBe(false);
    // A note a whole tone from the click is the player's, click or no click.
    expect(isClickBleed(sample(CLICK_HZ * 2 ** (2 / 12), 2005), clicks)).toBe(false);
  });

  it('has nothing to say about an unvoiced frame', () => {
    expect(isClickBleed(sample(null, 2005), clicks)).toBe(false);
  });

  it('lets everything through when the metronome has dropped out', () => {
    // Past a certain level the click stops carrying the exercise, and then
    // there is no click to mistake anything for.
    expect(isClickBleed(sample(CLICK_HZ, 2005), [])).toBe(false);
  });
});
