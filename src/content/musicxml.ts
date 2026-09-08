import type { Midi, NoteValue } from '../lib/types';

/**
 * A MusicXML score, reduced to what a sight-reading exercise needs.
 *
 * Deliberately not a faithful model of MusicXML: dynamics, slurs, articulation,
 * lyrics, layout and repeats are all dropped. What survives is pitch, length,
 * which staff a note is on and which voice it belongs to — everything the
 * excerpt pipeline reads and nothing else.
 */
export interface ImportedNote {
  /** Sounding pitch, or null for a rest. */
  midi: Midi | null;
  /** Length as a fraction of a whole note, as the rest of the app measures it. */
  value: NoteValue;
  /** Whole notes from the start of the measure. */
  onset: number;
  /** 1 for the upper staff of a piano part, 2 for the lower. */
  staff: number;
  voice: string;
  /** Part of a chord: sounds with the note before it rather than after. */
  chord: boolean;
  /** Continues the note before it rather than being struck. */
  tied: boolean;
}

export interface ImportedMeasure {
  /** As numbered in the score, which is not always its index. */
  number: string;
  timeSignature: [number, number];
  /** Sharps positive, flats negative, as MusicXML's `fifths`. */
  fifths: number;
  notes: ImportedNote[];
}

export interface ImportedScore {
  title: string | null;
  composer: string | null;
  /** Whatever the file claims, which is not the same as what is true. */
  rights: string | null;
  staves: number;
  measures: ImportedMeasure[];
}

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const text = (parent: Element, tag: string): string | null =>
  parent.querySelector(`:scope > ${tag}`)?.textContent?.trim() ?? null;

const number = (parent: Element, tag: string, fallback: number): number => {
  const found = text(parent, tag);
  const value = found === null ? Number.NaN : Number(found);
  return Number.isFinite(value) ? value : fallback;
};

/** MusicXML pitch to MIDI. Octave 4 is middle C's, as everywhere else. */
function pitchToMidi(pitch: Element): Midi | null {
  const step = text(pitch, 'step');
  if (step === null || !(step in STEPS)) return null;
  const octave = number(pitch, 'octave', 4);
  const alter = number(pitch, 'alter', 0);
  return (octave + 1) * 12 + STEPS[step] + alter;
}

/**
 * Reads a parsed MusicXML document into the shape above.
 *
 * Takes a Document rather than a string so the caller decides where the parser
 * comes from: the browser's own in the app, jsdom's in a script or a test.
 * Only the first part is read — this corpus is piano, and a part is a player.
 */
export function parseMusicXml(document: Document): ImportedScore {
  const part = document.querySelector('part');
  if (!part) throw new Error('no <part> in this document: not a partwise MusicXML score');

  const identification = document.querySelector('identification');
  const creator = document.querySelector('identification > creator[type="composer"]');
  const score: ImportedScore = {
    title: document.querySelector('work > work-title')?.textContent?.trim() ?? null,
    composer: creator?.textContent?.trim() ?? null,
    rights: identification?.querySelector(':scope > rights')?.textContent?.trim() ?? null,
    staves: 1,
    measures: [],
  };

  // Carried across measures: MusicXML states them once and means them until
  // they change.
  let divisions = 1;
  let timeSignature: [number, number] = [4, 4];
  let fifths = 0;

  for (const measure of part.querySelectorAll(':scope > measure')) {
    const attributes = measure.querySelector(':scope > attributes');
    if (attributes) {
      divisions = number(attributes, 'divisions', divisions);
      score.staves = Math.max(score.staves, number(attributes, 'staves', 1));
      const time = attributes.querySelector(':scope > time');
      if (time) {
        timeSignature = [number(time, 'beats', 4), number(time, 'beat-type', 4)];
      }
      const key = attributes.querySelector(':scope > key');
      if (key) fifths = number(key, 'fifths', fifths);
    }

    /** Divisions are per quarter note; the app counts fractions of a whole one. */
    const toValue = (duration: number) => duration / (divisions * 4);

    const notes: ImportedNote[] = [];
    // MusicXML is a cursor over one timeline: <backup> winds it back so the
    // other staff can be written from the same point, and every staff after
    // the first depends on it.
    let cursor = 0;
    let previousOnset = 0;
    for (const element of measure.children) {
      if (element.tagName === 'backup') {
        cursor = Math.max(0, cursor - toValue(number(element, 'duration', 0)));
        continue;
      }
      if (element.tagName === 'forward') {
        cursor += toValue(number(element, 'duration', 0));
        continue;
      }
      if (element.tagName !== 'note') continue;

      const chord = element.querySelector(':scope > chord') !== null;
      const value = toValue(number(element, 'duration', 0));
      const pitch = element.querySelector(':scope > pitch');
      const onset = chord ? previousOnset : cursor;
      notes.push({
        midi: pitch ? pitchToMidi(pitch) : null,
        value,
        onset,
        staff: number(element, 'staff', 1),
        voice: text(element, 'voice') ?? '1',
        chord,
        // A tie stop is a continuation; a tie start is struck like any note.
        tied: element.querySelector(':scope > tie[type="stop"]') !== null,
      });
      if (!chord) {
        previousOnset = cursor;
        cursor += value;
      }
    }

    score.measures.push({
      number: measure.getAttribute('number') ?? String(score.measures.length + 1),
      timeSignature,
      fifths,
      notes,
    });
  }

  return score;
}
