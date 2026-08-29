// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { StaveNote } from 'vexflow/bravura';
import { beamBar } from './beaming';

const eighth = () => new StaveNote({ keys: ['c/4'], duration: '8' });
const quarter = () => new StaveNote({ keys: ['c/4'], duration: 'q' });
const rest = () => new StaveNote({ keys: ['b/4'], duration: '8r' });

/** Note counts of each beam produced, in order. */
function beamSizes(
  notes: StaveNote[],
  groups: (number | undefined)[],
  timeSignature: [number, number] = [4, 4],
): number[] {
  return beamBar(notes, groups, timeSignature).map((beam) => beam.getNotes().length);
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

  it('beams ordinary runs in beats', () => {
    const notes = Array.from({ length: 4 }, eighth);
    expect(beamSizes(notes, [undefined, undefined, undefined, undefined])).toEqual([2, 2]);
  });

  it('beams compound time in threes', () => {
    // 6/8 is felt in two dotted-crotchet beats, so quavers group 3 + 3 — the
    // whole point of the signature, and wrong if beamed like 4/4.
    const notes = Array.from({ length: 6 }, eighth);
    const none = Array.from({ length: 6 }, () => undefined);
    expect(beamSizes(notes, none, [6, 8])).toEqual([3, 3]);
    expect(beamSizes(notes, none, [4, 4])).toEqual([2, 2, 2]);
  });

  it('beams 3/4 in crotchet beats', () => {
    const notes = Array.from({ length: 6 }, eighth);
    const none = Array.from({ length: 6 }, () => undefined);
    expect(beamSizes(notes, none, [3, 4])).toEqual([2, 2, 2]);
  });
});
