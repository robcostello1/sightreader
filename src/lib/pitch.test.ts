import { describe, expect, it } from 'vitest';
import { centsFromTarget, hzToMidi, matchesTarget, midiToHz, midiToName } from './pitch';

describe('pitch conversion', () => {
  it('round-trips A440', () => {
    expect(midiToHz(69)).toBe(440);
    expect(hzToMidi(440)).toBe(69);
  });

  it('names the guitar open strings', () => {
    expect([40, 45, 50, 55, 59, 64].map(midiToName)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  });

  it('measures cents against a target', () => {
    expect(centsFromTarget(midiToHz(64), 64)).toBeCloseTo(0);
    expect(centsFromTarget(midiToHz(64.25), 64)).toBeCloseTo(25);
  });

  it('accepts a slightly sharp string within tolerance', () => {
    expect(matchesTarget(midiToHz(64.3), 64)).toBe(true);
    expect(matchesTarget(midiToHz(64.8), 64)).toBe(false);
  });
});
