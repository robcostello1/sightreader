// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { StaveNote, Stem } from 'vexflow/bravura';
import { beamBar } from './beaming';
import type { NotatedNote } from './layout';

const eighth = () => new StaveNote({ keys: ['c/4'], duration: '8' });
const quarter = () => new StaveNote({ keys: ['c/4'], duration: 'q' });
const sixteenth = () => new StaveNote({ keys: ['c/4'], duration: '16' });
const high = () => new StaveNote({ keys: ['c/6'], duration: '8' });
const rest = () => new StaveNote({ keys: ['b/4'], duration: '8r' });

/** The notes beamBar reads lengths and tuplet membership from. */
function sourceFor(notes: StaveNote[], groups: (number | undefined)[]): NotatedNote[] {
  return notes.map((note, i) => ({
    midi: note.isRest() ? null : 60,
    code: note.getDuration(),
    dots: 0,
    tuplet: groups[i] === undefined ? undefined : { group: groups[i]!, num: 3, inSpaceOf: 2 },
    tiedToNext: false,
    sourceIndex: i,
  }));
}

/** Note counts of each beam produced, in order. */
function beamSizes(
  notes: StaveNote[],
  groups: (number | undefined)[],
  timeSignature: [number, number] = [4, 4],
): number[] {
  return beamBar(notes, sourceFor(notes, groups), timeSignature).map(
    (beam) => beam.getNotes().length,
  );
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

  it('beams quavers in common time four to a beam', () => {
    const four = Array.from({ length: 4 }, eighth);
    expect(beamSizes(four, Array(4).fill(undefined))).toEqual([4]);
    const bar = Array.from({ length: 8 }, eighth);
    expect(beamSizes(bar, Array(8).fill(undefined))).toEqual([4, 4]);
  });

  it('never beams quavers across the middle of a common-time bar', () => {
    // Beats 2, 3 and 4 as quavers: the first pair belongs to the first half of
    // the bar, and joining it to the rest would bury beat three.
    const notes = [quarter(), ...Array.from({ length: 6 }, eighth)];
    expect(beamSizes(notes, Array(7).fill(undefined))).toEqual([2, 4]);
  });

  it('points stems the way the run does, not the way its first note does', () => {
    // A beam over notes above the staff went stems-up, which also flipped the
    // tuplet numeral upside down beneath it.
    const [tuplet] = beamBar(
      Array.from({ length: 3 }, high),
      sourceFor(Array.from({ length: 3 }, high), [0, 0, 0]),
      [4, 4],
    );
    expect(tuplet.getStemDirection()).toBe(Stem.DOWN);

    const notes = Array.from({ length: 4 }, high);
    const [plain] = beamBar(notes, sourceFor(notes, Array(4).fill(undefined)), [4, 4]);
    expect(plain.getStemDirection()).toBe(Stem.DOWN);
  });

  it('breaks a half-bar beam where a rest falls', () => {
    const notes = [eighth(), rest(), eighth(), eighth()];
    expect(beamSizes(notes, Array(4).fill(undefined))).toEqual([2]);
  });

  it('keeps semiquavers in beats', () => {
    // Four to a beam is a quaver convention; semiquavers are written by beat,
    // and eight under one beam would be unreadable.
    const notes = Array.from({ length: 8 }, sixteenth);
    expect(beamSizes(notes, Array(8).fill(undefined))).toEqual([4, 4]);
  });

  it('falls back to beats for a run that starts off the half bar', () => {
    // A triplet of quavers occupies beat one, so the run after it starts a
    // quarter of the way through the bar — where half-bar groups would land on
    // nothing, since VexFlow counts them from the first note it is given.
    const notes = Array.from({ length: 7 }, eighth);
    const groups = [0, 0, 0, undefined, undefined, undefined, undefined];
    expect(beamSizes(notes, groups)).toEqual([3, 2, 2]);
  });

  it('beams compound time in threes', () => {
    // 6/8 is felt in two dotted-crotchet beats, so quavers group 3 + 3 — the
    // whole point of the signature, and wrong if beamed like 4/4.
    const notes = Array.from({ length: 6 }, eighth);
    const none = Array.from({ length: 6 }, () => undefined);
    expect(beamSizes(notes, none, [6, 8])).toEqual([3, 3]);
    // The same six quavers in common time fill the first half bar and spill
    // two into the second.
    expect(beamSizes(notes, none, [4, 4])).toEqual([4, 2]);
  });

  it('beams 3/4 in crotchet beats', () => {
    const notes = Array.from({ length: 6 }, eighth);
    const none = Array.from({ length: 6 }, () => undefined);
    expect(beamSizes(notes, none, [3, 4])).toEqual([2, 2, 2]);
  });
});
