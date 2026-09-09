import { describe, expect, it } from 'vitest';
import { CADENTIAL_IDIOMS, IDIOM_LIBRARY, RHYTHMIC_IDIOMS, idiomById } from './library';
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
      new Set(['scalar', 'arpeggio', 'interval', 'cadential', 'rhythmic']),
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

describe('the rhythmic idioms', () => {
  it('are all marked to be met on their own first', () => {
    for (const idiom of RHYTHMIC_IDIOMS) {
      expect(idiom.rhythmFirst, idiom.id).toBe(true);
      expect(idiom.category).toBe('rhythmic');
    }
    // And nothing else is: the flag is what the rhythm-only mode selects on.
    for (const idiom of IDIOM_LIBRARY.filter((i) => i.category !== 'rhythmic')) {
      expect(idiom.rhythmFirst, idiom.id).toBeUndefined();
    }
  });

  it('keep their pitches plain, since the rhythm is the lesson', () => {
    for (const idiom of RHYTHMIC_IDIOMS) {
      const degrees = idiom.events.map((event) => event.degree ?? 0);
      const span = Math.max(...degrees) - Math.min(...degrees);
      expect(span, idiom.id).toBeLessThanOrEqual(3);
    }
  });

  it('are uneven, which is the whole of what they teach', () => {
    for (const idiom of RHYTHMIC_IDIOMS) {
      const lengths = new Set(idiom.events.map((event) => event.beats));
      expect(lengths.size, idiom.id).toBeGreaterThan(1);
    }
  });

  it('shuffles two to one, which is a beat of three split in two', () => {
    const shuffles = RHYTHMIC_IDIOMS.filter((idiom) => idiom.id.startsWith('shuffle'));
    expect(shuffles.length).toBeGreaterThan(0);
    for (const idiom of shuffles) {
      // And only where a beat divides in three to begin with. Written into
      // common time the same proportions are a syncopation, not a shuffle.
      expect(idiom.meter, idiom.id).toBe('compound');
      for (let i = 0; i + 1 < idiom.events.length; i += 2) {
        expect(idiom.events[i].beats / idiom.events[i + 1].beats, idiom.id).toBe(2);
      }
    }
  });

  it('fits every one inside a bar at some density', () => {
    // Total beats times the smallest unit value has to leave room in 3/4, the
    // shortest bar the app writes.
    for (const idiom of RHYTHMIC_IDIOMS) {
      const beats = idiom.events.reduce((sum, event) => sum + event.beats, 0);
      expect(beats * (1 / 16), idiom.id).toBeLessThanOrEqual(3 / 4);
    }
  });
});

describe('how large a figure may be written', () => {
  it('keeps an anticipation at the scale it is played on', () => {
    // A quaver arriving early against a crotchet beat, or a semiquaver against
    // a quaver. At minims the same proportions are just long notes.
    for (const id of ['anticipation', 'anticipated-cadence']) {
      expect(idiomById(id)!.maxUnit, id).toBe(NOTE_VALUES.eighth);
    }
  });

  it('caps the syncopations too, and leaves the shapes alone', () => {
    for (const idiom of RHYTHMIC_IDIOMS.filter((i) => i.id.startsWith('syncopation'))) {
      expect(idiom.maxUnit, idiom.id).toBe(NOTE_VALUES.quarter);
    }
    for (const idiom of IDIOM_LIBRARY.filter((i) => i.category !== 'rhythmic')) {
      expect(idiom.maxUnit, idiom.id).toBeUndefined();
    }
  });
});
