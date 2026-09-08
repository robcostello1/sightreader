import { describe, expect, it } from 'vitest';
import { CLICK_SHADOW_MS, MIN_SUSTAIN_MS, restEvidence } from './rest';
import { scoreWindow } from './score';
import { DEFAULT_SCORING } from '../config/levels';
import { midiToHz } from '../lib/pitch';
import type { NoteWindow, PitchSample } from '../lib/types';

const HOP = 512 / 44.1;
const CONFIG = { ...DEFAULT_SCORING, penaliseSustainThroughRest: true };

/** A stream of frames over `ms`, each given whatever the shaper says. */
function stream(ms: number, shape: (at: number, index: number) => Partial<PitchSample>): PitchSample[] {
  const samples: PitchSample[] = [];
  for (let i = 0, at = 0; at < ms; i++, at = i * HOP) {
    samples.push({ hz: null, confidence: 0, timestamp: at, ...shape(at, i) });
  }
  return samples;
}

const silence = (ms: number) => stream(ms, () => ({ hz: null, confidence: 0.1 }));
const ringing = (ms: number, midi = 60) =>
  stream(ms, () => ({ hz: midiToHz(midi), confidence: 0.95 }));

/** Confident but never on one note: a chair, a pedal, a hand on the strings. */
const noise = (ms: number) =>
  stream(ms, (_, i) => ({ hz: midiToHz(48 + ((i * 7) % 24)), confidence: 0.9 }));

/** The metronome: a short confident burst where the click is. */
function click(ms: number, at: number): PitchSample[] {
  return stream(ms, (t) => (t >= at && t < at + 40 ? { hz: 1000, confidence: 0.95 } : { hz: null, confidence: 0.1 }));
}

describe('what a rest heard', () => {
  it('hears nothing in silence', () => {
    const evidence = restEvidence(silence(600), CONFIG);
    expect(evidence.sounding).toBe(false);
    expect(evidence.longestMs).toBe(0);
  });

  it('hears a note left ringing, which is the thing it is for', () => {
    expect(restEvidence(ringing(600), CONFIG).sounding).toBe(true);
  });

  it('does not hear the metronome, which the app played itself', () => {
    const samples = click(600, 200);
    expect(restEvidence(samples, CONFIG, [200]).sounding).toBe(false);
    // And would have, without being told where the click was.
    expect(restEvidence(samples, CONFIG, []).longestMs).toBeLessThan(MIN_SUSTAIN_MS);
  });

  it('does not hear a click that rings a little past its own length', () => {
    const shadow = CLICK_SHADOW_MS.after;
    const samples = stream(600, (t) =>
      t >= 200 && t < 200 + shadow ? { hz: 1000, confidence: 0.95 } : { hz: null, confidence: 0.1 },
    );
    expect(restEvidence(samples, CONFIG, [200]).sounding).toBe(false);
  });

  it('does not hear noise, however loud and confident it is', () => {
    const evidence = restEvidence(noise(600), CONFIG);
    expect(evidence.considered).toBeGreaterThan(20);
    expect(evidence.sounding).toBe(false);
  });

  it('does not hear a scrape that settles for a moment and moves on', () => {
    const samples = stream(600, (t) =>
      t >= 100 && t < 180
        ? { hz: midiToHz(55), confidence: 0.9 }
        : t >= 180 && t < 260
          ? { hz: midiToHz(62), confidence: 0.9 }
          : { hz: null, confidence: 0.1 },
    );
    expect(restEvidence(samples, CONFIG).sounding).toBe(false);
  });

  it('hears a note that wavers a little, since a real one does', () => {
    const samples = stream(600, (_, i) => ({
      hz: midiToHz(60) * (1 + (i % 3) * 0.004),
      confidence: 0.9,
    }));
    expect(restEvidence(samples, CONFIG).sounding).toBe(true);
  });

  it('decides nothing about a rest too short to judge', () => {
    const evidence = restEvidence(ringing(MIN_SUSTAIN_MS - 40), CONFIG);
    expect(evidence.tooShort).toBe(true);
    expect(evidence.sounding).toBe(false);
  });

  it('ignores what it cannot hear confidently', () => {
    const quiet = stream(600, () => ({ hz: midiToHz(60), confidence: 0.4 }));
    expect(restEvidence(quiet, CONFIG).sounding).toBe(false);
  });
});

describe('scoring a rest', () => {
  const window = (index = 0): NoteWindow => ({
    index,
    note: { midi: null, value: 0.25, idiomId: 'test', instance: 0 },
    startMs: 0,
    endMs: 600,
    scoreFromMs: 0,
  });

  it('passes a rest that was kept', () => {
    const result = scoreWindow(window(), silence(600), CONFIG);
    expect(result.passed).toBe(true);
    expect(result.verdict).toBe('pass');
  });

  it('fails a note held through it', () => {
    const result = scoreWindow(window(), ringing(600), CONFIG);
    expect(result.passed).toBe(false);
    expect(result.verdict).toBe('wrong-pitch');
  });

  it('passes a rest the metronome played through', () => {
    expect(scoreWindow(window(), click(600, 300), CONFIG, [300]).passed).toBe(true);
  });

  it('passes a rest with noise in it', () => {
    expect(scoreWindow(window(), noise(600), CONFIG).passed).toBe(true);
  });

  it('judges nothing where the policy is switched off', () => {
    const lenient = { ...DEFAULT_SCORING, penaliseSustainThroughRest: false };
    expect(scoreWindow(window(), ringing(600), lenient).passed).toBe(true);
  });

  it('marks a rest too short to judge unscorable rather than passing it', () => {
    const short: NoteWindow = { ...window(), endMs: 80 };
    const result = scoreWindow(short, ringing(80), CONFIG);
    expect(result.verdict).toBe('unscorable');
  });
});
