import { describe, expect, it } from 'vitest';
import { CADENTIAL_IDIOMS, IDIOM_LIBRARY, idiomById } from './library';
import {
  idiomDuration,
  instantiateIdiom,
  maxLocalInterval,
  placementRange,
} from './instantiate';
import { degreeToMidi, degreeToSemitones, isDiatonic } from './scale';
import { midiToName } from '../lib/pitch';
import { NOTE_VALUES } from '../lib/types';
import type { IdiomPlacement } from './instantiate';

const C4 = 60;

const place = (id: string, startDegree = 0, unitValue = NOTE_VALUES.quarter): IdiomPlacement => ({
  idiom: idiomById(id)!,
  startDegree,
  keyCenter: C4,
  unitValue,
});

describe('scale degrees', () => {
  it('maps the major scale', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(degreeToSemitones)).toEqual([0, 2, 4, 5, 7, 9, 11, 12]);
  });

  it('extends below the tonic', () => {
    expect(degreeToSemitones(-1)).toBe(-1); // leading tone below
    expect(degreeToSemitones(-7)).toBe(-12);
  });

  it('names degrees in C major correctly', () => {
    expect([0, 2, 4].map((d) => midiToName(degreeToMidi(C4, d)))).toEqual(['C4', 'E4', 'G4']);
  });

  it('knows which pitches sit in the key', () => {
    expect(isDiatonic(C4, 62)).toBe(true); // D
    expect(isDiatonic(C4, 61)).toBe(false); // C#
  });
});

describe('idiom library', () => {
  it('has unique ids and no empty idioms', () => {
    const ids = IDIOM_LIBRARY.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(IDIOM_LIBRARY.every((i) => i.events.length > 0)).toBe(true);
  });

  it('covers every category the tier dials can ask for', () => {
    expect(new Set(IDIOM_LIBRARY.map((i) => i.category))).toEqual(
      new Set(['scalar', 'arpeggio', 'interval', 'cadential']),
    );
  });

  it('ends every cadential idiom on its anchor degree', () => {
    // Placing one on the tonic is what lands the phrase there.
    for (const idiom of CADENTIAL_IDIOMS) {
      expect(idiom.events[idiom.events.length - 1].degree).toBe(0);
    }
  });
});

describe('instantiateIdiom', () => {
  it('renders a triad as concrete pitches', () => {
    const notes = instantiateIdiom(place('triad-up'));
    expect(notes.map((n) => n.midi && midiToName(n.midi))).toEqual(['C4', 'E4', 'G4']);
  });

  it('transposes to any starting degree', () => {
    const notes = instantiateIdiom(place('triad-up', 4)); // on the dominant
    expect(notes.map((n) => n.midi && midiToName(n.midi))).toEqual(['G4', 'B4', 'D5']);
  });

  it('renders the same shape at different densities', () => {
    const slow = instantiateIdiom(place('run-up-4', 0, NOTE_VALUES.whole));
    const fast = instantiateIdiom(place('run-up-4', 0, NOTE_VALUES.eighth));
    expect(slow.map((n) => n.midi)).toEqual(fast.map((n) => n.midi));
    expect(slow.map((n) => n.value)).toEqual([1, 1, 1, 1]);
    expect(fast.map((n) => n.value)).toEqual([0.125, 0.125, 0.125, 0.125]);
  });

  it('carries the idiom id through for diagnostics', () => {
    expect(instantiateIdiom(place('turn')).every((n) => n.idiomId === 'turn')).toBe(true);
  });

  it('scales relative beats into note values', () => {
    // run-up-3 ends on a two-beat note.
    expect(instantiateIdiom(place('run-up-3')).map((n) => n.value)).toEqual([0.25, 0.25, 0.5]);
  });

  it('lands a cadential idiom on the tonic', () => {
    const notes = instantiateIdiom(place('cadence-step-down', 0));
    expect(notes[notes.length - 1].midi).toBe(C4);
  });
});

describe('placement constraints', () => {
  it('measures the largest consecutive leap in semitones', () => {
    expect(maxLocalInterval(place('run-up-4'))).toBe(2); // steps only
    expect(maxLocalInterval(place('repeated-note'))).toBe(0);
    expect(maxLocalInterval(place('leap-fourth-step-back'))).toBe(5);
  });

  it('measures intervals where the idiom actually lands, not in the abstract', () => {
    // Major triad on the tonic (C-E-G) leaps 4; the diminished triad on the
    // leading tone (B-D-F) never exceeds 3. Same idiom, different constraint.
    expect(maxLocalInterval(place('triad-up', 0))).toBe(4);
    expect(maxLocalInterval(place('triad-up', 6))).toBe(3);
  });

  it('reports the pitch range a placement occupies', () => {
    expect(placementRange(place('triad-up'))).toEqual({ low: 60, high: 67 });
  });

  it('computes duration for fitting idioms into bars', () => {
    // run-up-4 is four beats; at crotchets that is one 4/4 bar.
    expect(idiomDuration(idiomById('run-up-4')!, NOTE_VALUES.quarter)).toBe(1);
  });
});
