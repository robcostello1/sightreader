import { describe, expect, it } from 'vitest';
import { octaveShiftFor, octaveSignLabel } from './layout';
import { nameToMidi } from '../lib/pitch';

const written = (...names: string[]) => names.map(nameToMidi);

describe('octaveShiftFor', () => {
  it('leaves an ordinary passage alone', () => {
    // Two ledger lines either side is still read at a glance, so nothing inside
    // that gets a sign — which is almost every exercise.
    expect(octaveShiftFor('treble', written('C4', 'E4', 'G4'))).toBe(0);
    expect(octaveShiftFor('treble', written('A3', 'C6'))).toBe(0);
    expect(octaveShiftFor('bass', written('C2', 'E4'))).toBe(0);
  });

  it('lifts a high passage onto an 8va, and a very high one onto 15ma', () => {
    expect(octaveShiftFor('treble', written('D6', 'F6'))).toBe(1);
    expect(octaveShiftFor('treble', written('E7'))).toBe(2);
  });

  it('drops a low passage onto an 8vb, and a very low one onto 15mb', () => {
    expect(octaveShiftFor('bass', written('B1', 'G1'))).toBe(-1);
    // C1 displaced an octave lands on C2, exactly the edge of comfort, so one
    // octave is enough. B0 is the first note that needs two.
    expect(octaveShiftFor('bass', written('C1'))).toBe(-1);
    expect(octaveShiftFor('bass', written('B0'))).toBe(-2);
  });

  it('never displaces further than 15ma, which is as far as a sign goes', () => {
    expect(octaveShiftFor('treble', written('C8'))).toBe(2);
    expect(octaveShiftFor('bass', written('A0'))).toBe(-2);
  });

  it('judges a passage by its extreme, so one bar carries one sign', () => {
    // The whole point of deciding per bar: a phrase crossing the threshold gets
    // a single sign rather than flicking in and out of one note by note.
    const passage = written('A5', 'C6', 'E6', 'C6');
    expect(octaveShiftFor('treble', passage)).toBe(1);
    // And every note of it is then drawn an octave down, still on the staff.
    for (const midi of passage) {
      expect(midi - 12).toBeGreaterThanOrEqual(nameToMidi('A3'));
      expect(midi - 12).toBeLessThanOrEqual(nameToMidi('C6'));
    }
  });

  it('has nothing to say about rests alone, or an unknown clef', () => {
    expect(octaveShiftFor('treble', [])).toBe(0);
    expect(octaveShiftFor('tab', written('C8'))).toBe(0);
  });
});

describe('octaveSignLabel', () => {
  it('names each displacement the way a score does', () => {
    expect(octaveSignLabel(0)).toBeNull();
    expect(octaveSignLabel(1)).toEqual({ text: '8', superscript: 'va' });
    expect(octaveSignLabel(-1)).toEqual({ text: '8', superscript: 'vb' });
    expect(octaveSignLabel(2)).toEqual({ text: '15', superscript: 'ma' });
    expect(octaveSignLabel(-2)).toEqual({ text: '15', superscript: 'mb' });
  });
});
