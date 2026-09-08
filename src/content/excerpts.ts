import type { ImportedMeasure, ImportedNote, ImportedScore } from './musicxml';
import { toNotated } from '../lib/duration';
import { KEYS, type MusicalKey } from '../lib/key';
import type { Exercise, Midi, NoteValue } from '../lib/types';

/**
 * Which line of the music an excerpt is: the tune, the bass under it, or a
 * figure that uses both hands and belongs to neither.
 */
export type Line = 'lead' | 'bass' | 'mixed';

export interface ExcerptNote {
  midi: Midi | null;
  value: NoteValue;
}

export interface Excerpt {
  /** Where it came from, so a human reviewing it can find it again. */
  source: string;
  firstMeasure: string;
  measures: number;
  line: Line;
  /** How sure the classifier is, 0–1. Low is what a human should look at first. */
  confidence: number;
  timeSignature: [number, number];
  fifths: number;
  notes: ExcerptNote[];
  /** Why it might not be usable: chords flattened, voice crossing staves. */
  notesDropped: number;
  spansStaves: boolean;
  /** Whether every length in it is a symbol the app can actually draw. */
  notatable: boolean;
}

/** The key signature MusicXML's `fifths` names, as the app spells keys. */
export function keyOfFifths(fifths: number): MusicalKey {
  return KEYS.find((key) => key.accidentals === fifths) ?? KEYS[0];
}

/**
 * An excerpt as the rest of the app reads music, so the review page can draw it
 * with the same notation the lessons use. Tempo is the reviewer's business, not
 * the source's.
 */
export function excerptToExercise(excerpt: Excerpt, bpm = 60): Exercise {
  const key = keyOfFifths(excerpt.fifths);
  const sounded = excerpt.notes.filter((note) => note.midi !== null).map((note) => note.midi!);
  const low = sounded.length > 0 ? Math.min(...sounded) : 60;
  return {
    notes: excerpt.notes.map((note, index) => ({
      midi: note.midi,
      value: note.value,
      idiomId: 'excerpt',
      instance: index,
    })),
    keyCenter: Math.floor(low / 12) * 12 + key.tonic,
    key,
    timeSignature: excerpt.timeSignature,
    bpm,
  };
}

/** One staff's notes, chords flattened to the outer voice — top up, bottom down. */
function monophonic(measures: readonly ImportedMeasure[], staff: number): {
  notes: ExcerptNote[];
  dropped: number;
} {
  const notes: ExcerptNote[] = [];
  let dropped = 0;
  for (const measure of measures) {
    const onStaff = measure.notes.filter((note) => note.staff === staff);
    // Group by onset: everything struck together is one chord to flatten.
    const byOnset = new Map<number, ImportedNote[]>();
    for (const note of onStaff) {
      const found = byOnset.get(note.onset) ?? [];
      found.push(note);
      byOnset.set(note.onset, found);
    }
    for (const onset of [...byOnset.keys()].sort((a, b) => a - b)) {
      const together = byOnset.get(onset)!;
      const pitched = together.filter((note) => note.midi !== null);
      if (pitched.length === 0) {
        // A rest is a rest whichever voice wrote it; take the longest.
        notes.push({ midi: null, value: Math.max(...together.map((n) => n.value)) });
        continue;
      }
      dropped += pitched.length - 1;
      // The tune is the top of the right hand and the bottom of the left, which
      // is where a reader's eye goes on each staff.
      const chosen = pitched.reduce((best, note) =>
        staff === 1
          ? note.midi! > best.midi!
            ? note
            : best
          : note.midi! < best.midi!
            ? note
            : best,
      );
      notes.push({ midi: chosen.midi, value: chosen.value });
    }
  }
  return { notes, dropped };
}

/** Whether one voice writes on both staves — a figure spanning the hands. */
function crossesStaves(measures: readonly ImportedMeasure[]): boolean {
  const staffByVoice = new Map<string, Set<number>>();
  for (const measure of measures) {
    for (const note of measure.notes) {
      const found = staffByVoice.get(note.voice) ?? new Set<number>();
      found.add(note.staff);
      staffByVoice.set(note.voice, found);
    }
  }
  return [...staffByVoice.values()].some((staves) => staves.size > 1);
}

export interface ExcerptOptions {
  /** Measures per excerpt. Short: this is a sight-reading exercise, not a piece. */
  bars?: number;
  /** How far to step between excerpts, in measures. */
  stride?: number;
  /** Name the excerpts are attributed to. */
  source: string;
}

/**
 * Cuts a score into excerpts, one per staff, classified by which line they are.
 *
 * The classification is a first guess for a human to correct — see the review
 * page. It is deliberately shallow: which staff a line came from, whether a
 * voice crossed between them, and how much of a chord had to be thrown away to
 * make a single line of it.
 */
export function excerptsFrom(score: ImportedScore, options: ExcerptOptions): Excerpt[] {
  const bars = options.bars ?? 4;
  const stride = options.stride ?? bars;
  const excerpts: Excerpt[] = [];

  for (let start = 0; start + bars <= score.measures.length; start += stride) {
    const window = score.measures.slice(start, start + bars);
    const spansStaves = crossesStaves(window);
    const staves = score.staves >= 2 ? [1, 2] : [1];

    for (const staff of staves) {
      const { notes, dropped } = monophonic(window, staff);
      if (notes.every((note) => note.midi === null)) continue;

      const sounded = notes.filter((note) => note.midi !== null).length;
      const line: Line = spansStaves ? 'mixed' : staff === 1 ? 'lead' : 'bass';
      excerpts.push({
        source: options.source,
        firstMeasure: window[0].number,
        measures: bars,
        line,
        // Sure of a line that needed no chord flattened and stayed on its staff;
        // less so the more of the music had to be thrown away to get it.
        confidence: spansStaves ? 0.2 : Math.max(0, 1 - dropped / Math.max(1, sounded)),
        timeSignature: window[0].timeSignature,
        fifths: window[0].fifths,
        notes,
        notesDropped: dropped,
        spansStaves,
        notatable: notes.every((note) => toNotated(note.value) !== null),
      });
    }
  }

  return excerpts;
}
