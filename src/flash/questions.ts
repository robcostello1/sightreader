import { IDIOM_LIBRARY, instantiateIdiom, type IdiomPlacement } from '../idioms';
import { pick, type Rng } from '../generator/rng';
import { keyByName, type MusicalKey } from '../lib/key';
import { NOTE_VALUES, type Exercise, type ExerciseNote, type Midi } from '../lib/types';

/**
 * What the player is asked about a pattern they have just been shown.
 *
 * Recognition, not decoding: the pattern is on screen for a moment and then
 * gone, so what can be asked of it is what a reader takes in at a glance —
 * which shape it was, where it started and ended, and which way it went.
 */
export type QuestionKind = 'which-pattern' | 'first-note' | 'last-note' | 'highest-note' | 'direction';

export interface Option {
  id: string;
  /** Drawn as notation where the answer is a pattern, and as words otherwise. */
  exercise?: Exercise;
  label?: string;
}

export interface FlashQuestion {
  kind: QuestionKind;
  prompt: string;
  /** The pattern that was flashed. */
  shown: Exercise;
  options: Option[];
  answer: string;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const nameOf = (midi: Midi) => NOTE_NAMES[((midi % 12) + 12) % 12];

function exerciseOf(notes: ExerciseNote[], key: MusicalKey, keyCenter: Midi): Exercise {
  return { notes, keyCenter, key, timeSignature: [4, 4], bpm: 60 };
}

/** The same shape, one note moved a step — the near miss a glance would forgive. */
function nudge(notes: ExerciseNote[], at: number, by: number): ExerciseNote[] {
  return notes.map((note, index) =>
    index === at && note.midi !== null ? { ...note, midi: note.midi + by } : note,
  );
}

/** The same shape backwards, which reads as the same rhythm going the other way. */
function reverse(notes: ExerciseNote[]): ExerciseNote[] {
  const pitches = notes.map((note) => note.midi).reverse();
  return notes.map((note, index) => ({ ...note, midi: pitches[index] }));
}

export interface FlashOptions {
  rng: Rng;
  /** Where the pattern sits. Defaults to the octave above middle C. */
  keyCenter?: Midi;
  key?: MusicalKey;
  kind?: QuestionKind;
}

/**
 * Builds one flash question from the idiom library.
 *
 * Distractors are near misses by construction: the same idiom with one note
 * moved a step, or the same shape reversed. A wrong option that is obviously
 * wrong teaches nothing — the point is to make the eye read the shape rather
 * than the first note and the contour.
 */
export function flashQuestion(options: FlashOptions): FlashQuestion {
  const { rng } = options;
  const key = options.key ?? keyByName('C');
  const keyCenter = options.keyCenter ?? 60;
  const idiom = pick(rng, IDIOM_LIBRARY);
  const placement: IdiomPlacement = {
    idiom,
    startDegree: Math.floor(rng() * 3),
    keyCenter,
    unitValue: NOTE_VALUES.quarter,
  };
  const notes = instantiateIdiom(placement).map((note) => ({ ...note, idiomId: 'flash' }));
  const shown = exerciseOf(notes, key, keyCenter);
  const sounded = notes.filter((note) => note.midi !== null).map((note) => note.midi!);

  const kind: QuestionKind =
    options.kind ??
    pick(rng, ['which-pattern', 'first-note', 'last-note', 'highest-note', 'direction']);

  if (kind === 'which-pattern') {
    /*
     * Near misses, best first, deduplicated against the pattern and each other.
     * Some shapes are their own reverse — an upper neighbour is 0, 1, 0 — so a
     * variant that comes back identical is dropped rather than offered as a
     * wrong answer that is right.
     */
    const last = notes.length - 1;
    const middle = Math.max(0, Math.floor(notes.length / 2));
    const variants = [
      reverse(notes),
      nudge(notes, 0, 1),
      nudge(notes, last, -1),
      nudge(notes, middle, 1),
      nudge(notes, middle, -1),
      nudge(notes, 0, -1),
      nudge(notes, last, 1),
      notes.map((note) => (note.midi === null ? note : { ...note, midi: note.midi + 1 })),
    ];
    const seen = new Set([signature(notes)]);
    const wrong: Option[] = [];
    for (const variant of variants) {
      const id = signature(variant);
      if (seen.has(id)) continue;
      seen.add(id);
      wrong.push({ id: `wrong-${wrong.length}`, exercise: exerciseOf(variant, key, keyCenter) });
      if (wrong.length === 3) break;
    }
    return {
      kind,
      prompt: 'Which pattern was it?',
      shown,
      options: shuffle(rng, [{ id: 'right', exercise: shown }, ...wrong]),
      answer: 'right',
    };
  }

  if (kind === 'direction') {
    const first = sounded[0];
    const last = sounded[sounded.length - 1];
    const answer = last > first ? 'up' : last < first ? 'down' : 'same';
    return {
      kind,
      prompt: 'Where did it end, against where it started?',
      shown,
      options: [
        { id: 'up', label: 'Higher' },
        { id: 'down', label: 'Lower' },
        { id: 'same', label: 'The same note' },
      ],
      answer,
    };
  }

  const target =
    kind === 'first-note'
      ? sounded[0]
      : kind === 'last-note'
        ? sounded[sounded.length - 1]
        : Math.max(...sounded);
  const prompt =
    kind === 'first-note'
      ? 'Which note did it start on?'
      : kind === 'last-note'
        ? 'Which note did it end on?'
        : 'What was its highest note?';

  // Neighbours a step or two away: naming the note has to mean reading it.
  const near = [target - 2, target - 1, target + 1, target + 2].filter(
    (midi) => nameOf(midi) !== nameOf(target),
  );
  const wrong = shuffle(rng, near).slice(0, 3);
  return {
    kind,
    prompt,
    shown,
    options: shuffle(rng, [target, ...wrong]).map((midi) => ({
      id: nameOf(midi),
      label: nameOf(midi),
    })),
    answer: nameOf(target),
  };
}

/** What makes one pattern different from another: its pitches, in order. */
function signature(notes: readonly ExerciseNote[]): string {
  return notes.map((note) => note.midi ?? 'r').join(',');
}

/** Fisher-Yates on the caller's stream, so a seeded question is reproducible. */
function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
