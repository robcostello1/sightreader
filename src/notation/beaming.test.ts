// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { StaveNote } from 'vexflow/bravura';
import { beamBar } from './beaming';

const eighth = () => new StaveNote({ keys: ['c/4'], duration: '8' });
const quarter = () => new StaveNote({ keys: ['c/4'], duration: 'q' });
const rest = () => new StaveNote({ keys: ['b/4'], duration: '8r' });

/** Note counts of each beam produced, in order. */
function beamSizes(notes: StaveNote[], groups: (number | undefined)[]): number[] {
  return beamBar(notes, groups).map((beam) => beam.getNotes().length);
}

describe('beamBar', () => {
  it('beams a triplet as three, never split across the beat', () => {
    // The reported bug: generateBeams grouped these 2 + 2, joining the
    // triplet's last note to the one after it.
    const notes = [eighth(), eighth(), eighth(), eighth()];
    expect(beamSizes(notes, [0, 0, 0, undefined])).toEqual([3]);
  });

  it('keeps a tuplet separate from the run either side of it', () => {
    const notes = Array.from({ length: 7 }, eighth);
    expect(beamSizes(notes, [undefined, undefined, 1, 1, 1, undefined, undefined])).toEqual([
      2, 3, 2,
    ]);
  });

  it('beams consecutive tuplets independently', () => {
    const notes = Array.from({ length: 6 }, eighth);
    expect(beamSizes(notes, [0, 0, 0, 1, 1, 1])).toEqual([3, 3]);
  });

  it('leaves a tuplet of quarter notes unbeamed, bracket only', () => {
    const notes = [quarter(), quarter(), quarter()];
    expect(beamSizes(notes, [0, 0, 0])).toEqual([]);
  });

  it('does not beam a tuplet containing a rest', () => {
    const notes = [eighth(), rest(), eighth()];
    expect(beamSizes(notes, [0, 0, 0])).toEqual([]);
  });

  it('beams ordinary runs as VexFlow normally would', () => {
    const notes = Array.from({ length: 4 }, eighth);
    expect(beamSizes(notes, [undefined, undefined, undefined, undefined])).toEqual([2, 2]);
  });
});
