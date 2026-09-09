import { describe, expect, it } from 'vitest';
import { NO_SOURCE, drawnValue, mergeRests } from './rests';
import type { NotatedNote } from './layout';

const note = (code: string, dots = 0, sourceIndex = 0): NotatedNote => ({
  midi: 60,
  code,
  dots,
  tiedToNext: false,
  sourceIndex,
});

const rest = (code: string, dots = 0, sourceIndex = NO_SOURCE): NotatedNote => ({
  ...note(code, dots, sourceIndex),
  midi: null,
});

const triplet = (midi: number | null, group = 0): NotatedNote => ({
  midi,
  code: '8',
  dots: 0,
  tuplet: { group, num: 3, inSpaceOf: 2 },
  tiedToNext: false,
  sourceIndex: NO_SOURCE,
});

const shape = (notes: readonly NotatedNote[]) =>
  notes.map((n) => `${n.midi === null ? 'r' : 'n'}${n.code}${'.'.repeat(n.dots)}`);

const total = (notes: readonly NotatedNote[]) =>
  notes.reduce((sum, n) => sum + drawnValue(n), 0);

describe('mergeRests', () => {
  it('draws a silent bar as one rest', () => {
    expect(shape(mergeRests(Array(8).fill(rest('8')), [4, 4]))).toEqual(['rw']);
    expect(shape(mergeRests(Array(6).fill(rest('8')), [3, 4]))).toEqual(['rh.']);
  });

  it('keeps a rest off the middle of a common-time bar', () => {
    // Beats 1-3 silent: a dotted half rest would cover it in one symbol, but it
    // buries beat three, which is the beat the eye is looking for.
    const bar = [...Array(3).fill(rest('q')), note('q')];
    expect(shape(mergeRests(bar, [4, 4]))).toEqual(['rh', 'rq', 'nq']);
  });

  it('has no such qualm in three-four', () => {
    expect(shape(mergeRests([rest('q'), rest('q'), note('q')], [3, 4]))).toEqual(['rh', 'nq']);
  });

  it('starts a run on a boundary its own length divides', () => {
    // Silence from the second quaver to the end of beat two: a crotchet rest
    // there would sit off the beat, so the quaver comes first.
    const bar = [note('8'), rest('8'), rest('q'), note('h')];
    expect(shape(mergeRests(bar, [4, 4]))).toEqual(['n8', 'r8', 'rq', 'nh']);
  });

  it('merges a whole triplet group away when none of it sounds', () => {
    const bar = [triplet(null), triplet(null), triplet(null), note('h'), note('q')];
    const merged = mergeRests(bar, [4, 4]);
    // Three triplet quavers occupy a crotchet, which is one plain rest.
    expect(shape(merged)).toEqual(['rq', 'nh', 'nq']);
    expect(merged[0].tuplet).toBeUndefined();
  });

  it('leaves a part-sounding triplet alone', () => {
    // Two thirds of a crotchet is not a rest, so the fragments stay.
    const bar = [triplet(null), triplet(null), triplet(60), note('h'), note('q')];
    expect(shape(mergeRests(bar, [4, 4]))).toEqual(['r8', 'r8', 'n8', 'nh', 'nq']);
  });

  it('never changes how long the bar lasts', () => {
    const bars: NotatedNote[][] = [
      Array(8).fill(rest('8')),
      [note('8'), rest('8'), rest('q'), note('h')],
      [rest('q'), rest('8'), rest('8'), note('h')],
      [triplet(null), triplet(null), triplet(null), rest('q'), note('h')],
    ];
    for (const bar of bars) {
      expect(total(mergeRests(bar, [4, 4]))).toBeCloseTo(total(bar), 9);
    }
  });

  it('lets the cursor still find a rest the player is counting', () => {
    const bar = [note('q'), rest('8', 0, 4), rest('8'), note('h')];
    const merged = mergeRests(bar, [4, 4]);
    // Merged into one crotchet rest, which keeps the real rest's index — the
    // stand-in beside it never had one.
    expect(shape(merged)).toEqual(['nq', 'rq', 'nh']);
    expect(merged[1].sourceIndex).toBe(4);
  });
});

describe('rests in compound time', () => {
  const SIX_EIGHT: [number, number] = [6, 8];

  it('writes a crotchet rest on the second beat, not a dotted quaver and a semiquaver', () => {
    // A quaver note, then two quavers of silence, then a quaver note: the
    // silence starts three quavers in, which is the second beat. Measured
    // against the bar rather than the beat, a crotchet rest divides nothing
    // there and the run came out as ♪. + ♬ — see the screenshot on #26.
    const bar = [
      rest('q', 0, 0),
      note('8'),
      rest('8'),
      rest('8'),
      note('8'),
    ];
    expect(shape(mergeRests(bar, SIX_EIGHT))).toEqual(['rq', 'n8', 'rq', 'n8']);
  });

  it('keeps a whole beat as one dotted crotchet rest', () => {
    const bar = [note('8'), note('8'), note('8'), rest('8'), rest('8'), rest('8')];
    expect(shape(mergeRests(bar, SIX_EIGHT))).toEqual(['n8', 'n8', 'n8', 'rq.']);
  });

  it('never lets a rest run across a beat without filling whole ones', () => {
    // Silence from the second quaver to the fifth: two quavers of the first
    // beat and one of the second, which is two symbols and not one.
    const bar = [note('8'), rest('8'), rest('8'), rest('8'), note('8'), note('8')];
    const merged = mergeRests(bar, SIX_EIGHT);
    expect(shape(merged)).toEqual(['n8', 'rq', 'r8', 'n8', 'n8']);
    expect(total(merged)).toBeCloseTo(6 / 8, 9);
  });

  it('leaves simple time counting from its own beat', () => {
    // Two quavers of silence from the second quaver of 4/4 is still a quaver
    // rest and a quaver rest: a crotchet rest there would cross a beat.
    const bar = [note('8'), rest('8'), rest('8'), note('8'), note('q'), note('q')];
    expect(shape(mergeRests(bar, [4, 4]))).toEqual(['n8', 'r8', 'r8', 'n8', 'nq', 'nq']);
  });
});
