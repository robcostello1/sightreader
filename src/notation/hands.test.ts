import { describe, expect, it } from 'vitest';
import { notesForStaff } from './hands';
import { instrumentById } from '../config/instruments';
import { toNotated } from '../lib/duration';
import type { NotatedNote } from './layout';

const piano = instrumentById('piano');

/** A bar's worth of notated notes, given as [midi, value] pairs. */
const bar = (pairs: [number | null, number][]): NotatedNote[] =>
  pairs.map(([midi, value], index) => {
    const notated = toNotated(value);
    if (notated === null) throw new Error(`not a notatable value: ${value}`);
    return { midi, ...notated, tiedToNext: false, sourceIndex: index };
  });

const sounding = (notes: NotatedNote[]) => notes.map((note) => note.midi);

describe('splitting a bar between the hands', () => {
  it('sends the odd note across rather than stranding it on its own staff', () => {
    // The reported case: one semiquaver under middle C at the head of a beat
    // otherwise written in the treble.
    const notes = bar([
      [55, 1 / 16],
      [61, 1 / 16],
      [60, 1 / 8],
      [72, 1 / 8],
    ]);
    expect(sounding(notesForStaff(notes, 'treble', piano, [6, 8]))).toEqual([55, 61, 60, 72]);
    expect(sounding(notesForStaff(notes, 'bass', piano, [6, 8]))).toEqual([null, null, null, null]);
  });

  it('leaves a note the majority cannot reach where it is', () => {
    // C5 is an octave clear of middle C; dragging it into the bass to follow
    // the beat would cost four ledger lines to save one rest.
    const notes = bar([
      [48, 1 / 8],
      [72, 1 / 8],
      [50, 1 / 8],
    ]);
    expect(sounding(notesForStaff(notes, 'treble', piano, [6, 8]))).toEqual([null, 72, null]);
    expect(sounding(notesForStaff(notes, 'bass', piano, [6, 8]))).toEqual([48, null, 50]);
  });

  it('leaves a beat evenly divided between the hands where it falls', () => {
    const notes = bar([
      [55, 1 / 8],
      [64, 1 / 8],
    ]);
    expect(sounding(notesForStaff(notes, 'treble', piano, [6, 8]))).toEqual([null, 64]);
    expect(sounding(notesForStaff(notes, 'bass', piano, [6, 8]))).toEqual([55, null]);
  });

  it('decides each beat on its own', () => {
    // Beat one in the bass, beat two in the treble: a hand change, not an
    // outlier, and it must survive.
    const notes = bar([
      [48, 1 / 8],
      [50, 1 / 8],
      [52, 1 / 8],
      [72, 1 / 8],
      [74, 1 / 8],
      [76, 1 / 8],
    ]);
    expect(sounding(notesForStaff(notes, 'bass', piano, [6, 8]))).toEqual([
      48, 50, 52, null, null, null,
    ]);
  });

  it('counts a common-time beat as the crotchet it is', () => {
    const notes = bar([
      [59, 1 / 8],
      [72, 1 / 8],
      [74, 1 / 4],
      [76, 1 / 4],
      [77, 1 / 4],
    ]);
    // Beat one is 59 against 72 — even, so the B below middle C stays in the
    // bass rather than being dragged up by the rest of the bar.
    expect(sounding(notesForStaff(notes, 'bass', piano, [4, 4]))).toEqual([
      59, null, null, null, null,
    ]);
  });
});
