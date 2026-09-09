import { describe, expect, it } from 'vitest';
import { flashQuestion, type QuestionKind } from './questions';
import { mulberry32 } from '../generator/rng';

const ask = (seed: number, kind?: QuestionKind) =>
  flashQuestion({ rng: mulberry32(seed), kind });

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe('a flash question', () => {
  it('always has exactly one right answer among its options', () => {
    for (const seed of SEEDS) {
      const question = ask(seed);
      const matches = question.options.filter((option) => option.id === question.answer);
      expect(matches, `seed ${seed}`).toHaveLength(1);
    }
  });

  it('shows a pattern short enough to take in at a glance', () => {
    for (const seed of SEEDS) {
      const { shown } = ask(seed);
      expect(shown.notes.length).toBeGreaterThan(1);
      expect(shown.notes.length).toBeLessThanOrEqual(6);
    }
  });

  it('is the same question twice from the same seed', () => {
    expect(JSON.stringify(ask(7))).toBe(JSON.stringify(ask(7)));
  });

  describe('which pattern was it', () => {
    it('offers the pattern that was shown, and three others', () => {
      for (const seed of SEEDS) {
        const question = ask(seed, 'which-pattern');
        expect(question.options).toHaveLength(4);
        const right = question.options.find((o) => o.id === question.answer)!;
        expect(right.exercise!.notes.map((n) => n.midi)).toEqual(
          question.shown.notes.map((n) => n.midi),
        );
      }
    });

    it('makes every wrong option a near miss, not an obvious one', () => {
      for (const seed of SEEDS) {
        const question = ask(seed, 'which-pattern');
        const shown = question.shown.notes.map((n) => n.midi);
        for (const option of question.options) {
          if (option.id === question.answer) continue;
          const notes = option.exercise!.notes;
          const pitches = notes.map((n) => n.midi);
          // Same rhythm, same length: only the pitches move.
          expect(pitches).toHaveLength(shown.length);
          expect(notes.map((n) => n.value)).toEqual(question.shown.notes.map((n) => n.value));

          const differing = pitches.filter((midi, i) => midi !== shown[i]);
          expect(differing.length, `seed ${seed}`).toBeGreaterThan(0);

          // One of exactly three kinds of miss: the same notes reordered, one
          // note out by a step or two, or the whole shape a step out.
          const sorted = (list: (number | null)[]) => [...list].sort().join(',');
          const reordered = sorted(pitches) === sorted(shown);
          const oneOut =
            differing.length === 1 &&
            pitches.every((midi, i) => Math.abs((midi ?? 0) - (shown[i] ?? 0)) <= 2);
          const shifted =
            pitches.every((midi, i) => (midi ?? 0) - (shown[i] ?? 0) === 1) ||
            pitches.every((midi, i) => (midi ?? 0) - (shown[i] ?? 0) === -1);
          expect(reordered || oneOut || shifted, `seed ${seed}: ${pitches.join(',')}`).toBe(true);
        }
      }
    });

    it('never offers the same pattern twice', () => {
      for (const seed of SEEDS) {
        const shapes = ask(seed, 'which-pattern').options.map((option) =>
          JSON.stringify(option.exercise!.notes.map((n) => n.midi)),
        );
        expect(new Set(shapes).size, `seed ${seed}`).toBe(shapes.length);
      }
    });
  });

  describe('naming a note', () => {
    it('answers with the note that was actually first', () => {
      for (const seed of SEEDS) {
        const question = ask(seed, 'first-note');
        const first = question.shown.notes.find((note) => note.midi !== null)!.midi!;
        expect(question.answer).toBe(question.options.find((o) => o.id === question.answer)!.label);
        expect(['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']).toContain(
          question.answer,
        );
        expect(question.answer).toBe(
          ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][first % 12],
        );
      }
    });

    it('names the highest note, which is not always the last', () => {
      for (const seed of SEEDS) {
        const question = ask(seed, 'highest-note');
        const highest = Math.max(
          ...question.shown.notes.filter((n) => n.midi !== null).map((n) => n.midi!),
        );
        expect(question.answer).toBe(
          ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][highest % 12],
        );
      }
    });

    it('offers no two options with the same name', () => {
      for (const seed of SEEDS) {
        const ids = ask(seed, 'last-note').options.map((option) => option.id);
        expect(new Set(ids).size, `seed ${seed}`).toBe(ids.length);
      }
    });
  });

  describe('which way it went', () => {
    it('reads the last note against the first', () => {
      for (const seed of SEEDS) {
        const question = ask(seed, 'direction');
        const sounded = question.shown.notes.filter((n) => n.midi !== null).map((n) => n.midi!);
        const expected =
          sounded.at(-1)! > sounded[0] ? 'up' : sounded.at(-1)! < sounded[0] ? 'down' : 'same';
        expect(question.answer).toBe(expected);
      }
    });
  });
});
