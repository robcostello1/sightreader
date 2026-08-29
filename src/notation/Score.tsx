import { useEffect, useRef } from 'react';
import {
  Accidental,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Tuplet,
  Voice,
  VoiceMode,
  // Only the Bravura font, not every music font the default entry bundles.
} from 'vexflow/bravura';
import { layoutExercise, midiToVexKey, type NotatedNote } from './layout';
import type { Exercise, NoteResult } from '../lib/types';

/** Rest position on the staff, by convention around the middle line. */
const REST_KEY = 'b/4';

const COLOURS = {
  pass: '#2e9e5b',
  fail: '#d1495b',
  unclear: '#c77b18',
  active: '#2f6fed',
  idle: 'currentColor',
} as const;

export interface ScoreProps {
  exercise: Exercise;
  /** Per-note verdicts, indexed as in exercise.notes. Absent notes stay unscored. */
  results?: readonly NoteResult[];
  /** Index of the note currently being played, for the live cursor. */
  activeIndex?: number;
  width?: number;
}

function colourFor(
  sourceIndex: number,
  results: readonly NoteResult[] | undefined,
  activeIndex: number | undefined,
): string {
  if (activeIndex === sourceIndex) return COLOURS.active;
  const result = results?.find((r) => r.index === sourceIndex);
  if (!result) return COLOURS.idle;
  if (result.passed) return COLOURS.pass;
  return result.verdict === 'unclear' ? COLOURS.unclear : COLOURS.fail;
}

function buildNote(notated: NotatedNote): StaveNote {
  const isRest = notated.midi === null;
  const spelled = isRest ? null : midiToVexKey(notated.midi!);

  const note = new StaveNote({
    keys: [spelled?.key ?? REST_KEY],
    duration: isRest ? `${notated.code}r` : notated.code,
  });

  if (spelled?.accidental) note.addModifier(new Accidental(spelled.accidental), 0);
  for (let i = 0; i < notated.dots; i++) Dot.buildAndAttach([note], { all: true });

  return note;
}

/**
 * Renders a generated exercise as standard notation, colouring each note once
 * its window has been scored. VexFlow does the engraving; layoutExercise has
 * already done the bar splitting it expects.
 */
export function Score({ exercise, results, activeIndex, width = 720 }: ScoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();

    const bars = layoutExercise(exercise);
    const renderer = new Renderer(host, Renderer.Backends.SVG);
    const height = 160;
    renderer.resize(width, height);
    const context = renderer.getContext();

    // The first bar carries the clef and time signature, so it needs more room.
    const firstExtra = 60;
    const barWidth = (width - 20 - firstExtra) / bars.length;

    const drawn = new Map<number, StaveNote[]>();
    let x = 10;

    for (const [barIndex, bar] of bars.entries()) {
      const currentWidth = barWidth + (barIndex === 0 ? firstExtra : 0);
      const stave = new Stave(x, 20, currentWidth);
      if (barIndex === 0) {
        stave.addClef('treble').addTimeSignature(exercise.timeSignature.join('/'));
      }
      stave.setContext(context).draw();
      x += currentWidth;

      const notes = bar.notes.map((notated) => {
        const note = buildNote(notated);
        const colour = colourFor(notated.sourceIndex, results, activeIndex);
        note.setStyle({ fillStyle: colour, strokeStyle: colour });
        const existing = drawn.get(notated.sourceIndex) ?? [];
        existing.push(note);
        drawn.set(notated.sourceIndex, existing);
        return note;
      });
      if (notes.length === 0) continue;

      const voice = new Voice({
        numBeats: exercise.timeSignature[0],
        beatValue: exercise.timeSignature[1],
      });
      // Soft mode: a bar can be short while an exercise is still being built up.
      voice.setMode(VoiceMode.SOFT);
      voice.addTickables(notes);

      new Formatter().joinVoices([voice]).format([voice], currentWidth - 40);
      voice.draw(context, stave);

      // Beams and tuplet brackets are grouped per bar.
      for (const beam of Beam.generateBeams(notes)) beam.setContext(context).draw();

      const groups = new Map<number, StaveNote[]>();
      bar.notes.forEach((notated, i) => {
        if (notated.tuplet === undefined) return;
        const group = groups.get(notated.tuplet) ?? [];
        group.push(notes[i]);
        groups.set(notated.tuplet, group);
      });
      for (const group of groups.values()) {
        if (group.length === 3) new Tuplet(group).setContext(context).draw();
      }
    }

    // Ties join the fragments of any note that crossed a bar line.
    for (const fragments of drawn.values()) {
      for (let i = 0; i < fragments.length - 1; i++) {
        new StaveTie({ firstNote: fragments[i], lastNote: fragments[i + 1] })
          .setContext(context)
          .draw();
      }
    }
  }, [exercise, results, activeIndex, width]);

  return <div ref={hostRef} className="score" aria-label="Notated exercise" />;
}
