import { describe, expect, it } from 'vitest';
import {
  beatDurationMs,
  buildSchedule,
  countInBarsFor,
  noteDurationMs,
  windowAt,
} from './schedule';
import { NOTE_VALUES } from '../lib/types';
import type { Exercise, ExerciseNote } from '../lib/types';
import { keyByName } from '../lib/key';

const note = (value: number, midi: number | null = 60): ExerciseNote => ({
  midi,
  value,
  idiomId: 'test',
  instance: 0,
});

function exercise(notes: ExerciseNote[], bpm = 60): Exercise {
  return { notes, keyCenter: 60, key: keyByName('C'), timeSignature: [4, 4], bpm };
}

const OPTIONS = {
  startMs: 1000,
  countInBars: 1,
  clickThroughExercise: false,
  attackGuardMs: 40,
};

describe('tempo maths', () => {
  it('derives beat length from bpm', () => {
    expect(beatDurationMs(60)).toBe(1000);
    expect(beatDurationMs(120)).toBe(500);
  });

  it('scales note values against the time signature denominator', () => {
    expect(noteDurationMs(NOTE_VALUES.quarter, 4, 60)).toBe(1000);
    expect(noteDurationMs(NOTE_VALUES.whole, 4, 60)).toBe(4000);
    expect(noteDurationMs(NOTE_VALUES.eighth, 4, 120)).toBe(250);
  });

  it('handles tuplets without a special case', () => {
    // A triplet quaver is a third of a crotchet, expressed as the fraction 1/12.
    expect(noteDurationMs(1 / 12, 4, 60)).toBeCloseTo(1000 / 3, 6);
  });
});

describe('countInBarsFor', () => {
  it('gives four pulses whatever the signature is worth', () => {
    // A bar is a different number of clicks in each: four in 4/4, three in 3/4,
    // and only two in 6/8 once it is counted in dotted crotchets.
    expect(countInBarsFor([4, 4])).toBe(1);
    expect(countInBarsFor([3, 4])).toBe(2);
    expect(countInBarsFor([6, 8])).toBe(2);
  });
});

describe('buildSchedule', () => {
  it('places t0 one full bar after the start', () => {
    const schedule = buildSchedule(exercise([note(NOTE_VALUES.whole)]), OPTIONS);
    // 4 beats of count-in at 60bpm.
    expect(schedule.t0).toBe(5000);
  });

  it('scales the count-in with the time signature', () => {
    const threeFour: Exercise = { ...exercise([note(NOTE_VALUES.whole)]), timeSignature: [3, 4] };
    expect(buildSchedule(threeFour, OPTIONS).t0).toBe(4000);
  });

  it('counts in two bars of 3/4, where one is only three pulses', () => {
    const threeFour: Exercise = { ...exercise([note(NOTE_VALUES.whole)]), timeSignature: [3, 4] };
    const derived = buildSchedule(threeFour, { ...OPTIONS, countInBars: undefined });
    // Six beats at 60bpm, and six clicks to settle into.
    expect(derived.t0 - derived.startMs).toBe(6000);
    expect(derived.clicks.filter((c) => c.phase === 'count-in')).toHaveLength(6);
  });

  it('lays windows end to end from t0 with no gaps', () => {
    const schedule = buildSchedule(
      exercise([note(NOTE_VALUES.half), note(NOTE_VALUES.quarter), note(NOTE_VALUES.quarter)]),
      OPTIONS,
    );
    expect(schedule.windows.map((w) => [w.startMs, w.endMs])).toEqual([
      [5000, 7000],
      [7000, 8000],
      [8000, 9000],
    ]);
    expect(schedule.endMs).toBe(9000);
  });

  it('excludes the attack guard from the head of each window', () => {
    const schedule = buildSchedule(exercise([note(NOTE_VALUES.quarter)]), OPTIONS);
    expect(schedule.windows[0].scoreFromMs).toBe(5040);
  });

  it('collapses the scoring zone rather than overrunning a very short window', () => {
    // Semiquaver at 240bpm is 62.5ms; a 100ms guard would otherwise run past the end.
    const fast = exercise([note(1 / 16)], 240);
    const schedule = buildSchedule(fast, { ...OPTIONS, attackGuardMs: 100 });
    const [window] = schedule.windows;
    expect(window.scoreFromMs).toBe(window.endMs);
  });

  it('keeps rests as windows so the scorer can check for silence', () => {
    const schedule = buildSchedule(
      exercise([note(NOTE_VALUES.quarter), note(NOTE_VALUES.quarter, null)]),
      OPTIONS,
    );
    expect(schedule.windows).toHaveLength(2);
    expect(schedule.windows[1].note.midi).toBeNull();
  });

  it('clicks every count-in beat, accenting the downbeat', () => {
    const schedule = buildSchedule(exercise([note(NOTE_VALUES.whole)]), OPTIONS);
    expect(schedule.clicks).toHaveLength(4);
    expect(schedule.clicks.map((c) => c.timeMs)).toEqual([1000, 2000, 3000, 4000]);
    expect(schedule.clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
    expect(schedule.clicks.every((c) => c.phase === 'count-in')).toBe(true);
  });

  it('continues clicking through the exercise only when the tier asks for it', () => {
    const twoBars = exercise([note(NOTE_VALUES.whole), note(NOTE_VALUES.whole)]);
    const off = buildSchedule(twoBars, OPTIONS);
    const on = buildSchedule(twoBars, { ...OPTIONS, clickThroughExercise: true });

    expect(off.clicks.filter((c) => c.phase === 'exercise')).toHaveLength(0);
    // 8 beats of exercise, and no click lands on the final boundary.
    expect(on.clicks.filter((c) => c.phase === 'exercise')).toHaveLength(8);
    expect(on.clicks.every((c) => c.timeMs < on.endMs)).toBe(true);
  });
});

describe('windowAt', () => {
  const schedule = buildSchedule(
    exercise([note(NOTE_VALUES.quarter), note(NOTE_VALUES.quarter)]),
    OPTIONS,
  );

  it('resolves a timestamp to its window', () => {
    expect(windowAt(schedule, 5500)?.index).toBe(0);
    expect(windowAt(schedule, 6500)?.index).toBe(1);
  });

  it('treats boundaries as belonging to the later window', () => {
    expect(windowAt(schedule, 6000)?.index).toBe(1);
  });

  it('returns null outside the exercise', () => {
    expect(windowAt(schedule, 4000)).toBeNull();
    expect(windowAt(schedule, 7000)).toBeNull();
  });
});
