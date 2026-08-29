import { useEffect, useRef, useState } from 'react';
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
import { layoutExercise, midiToVexKey, soundingToWritten, type NotatedNote } from './layout';
import type { Exercise, NoteResult } from '../lib/types';

/** Rest position on the staff, by convention around the middle line. */
const REST_KEY = 'b/4';

/**
 * VexFlow hardcodes these into the SVG — black glyphs, #444 stave lines — and
 * neither context styles nor Stave.setStyle reliably displaces them. Rewriting
 * the attributes after drawing is the one mechanism that covers everything, and
 * it leaves the explicit verdict colours below untouched.
 */
const VEXFLOW_DEFAULT_COLOURS = new Set(['black', '#444', '#444444']);

function followPageColour(root: Element): void {
  for (const element of root.querySelectorAll('[fill],[stroke]')) {
    for (const attribute of ['fill', 'stroke'] as const) {
      const value = element.getAttribute(attribute);
      if (value && VEXFLOW_DEFAULT_COLOURS.has(value.toLowerCase())) {
        element.setAttribute(attribute, 'currentColor');
      }
    }
  }
}

const COLOURS = {
  pass: '#2e9e5b',
  fail: '#d1495b',
  unclear: '#c77b18',
  active: '#2f6fed',
  idle: 'currentColor',
} as const;

/**
 * Vertical budget. Guitar's written range in open position runs from E3, three
 * ledger lines below the staff, up to G#5 just above it — so the staff needs
 * headroom above and considerably more below, or the low strings get clipped.
 */
const STAVE_TOP = 40;
const HEIGHT = 210;
const FALLBACK_WIDTH = 720;

export interface ScoreProps {
  exercise: Exercise;
  /** Per-note verdicts, indexed as in exercise.notes. Absent notes stay unscored. */
  results?: readonly NoteResult[];
  /** Index of the note currently being played, for the live cursor. */
  activeIndex?: number;
  /** Fixed width; when omitted the score fills its container. */
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
  // Sounding pitch in, written pitch on the page — see GUITAR_WRITTEN_OFFSET.
  const spelled = isRest ? null : midiToVexKey(soundingToWritten(notated.midi!));

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
export function Score({ exercise, results, activeIndex, width }: ScoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);

  // Fill the container so bars are not cramped on a wide screen. jsdom has no
  // ResizeObserver, so tests fall back to the fixed width.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setMeasured(Math.max(320, Math.floor(entry.contentRect.width)));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const renderWidth = width ?? measured ?? FALLBACK_WIDTH;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();

    const bars = layoutExercise(exercise);
    const renderer = new Renderer(host, Renderer.Backends.SVG);
    renderer.resize(renderWidth, HEIGHT);
    const context = renderer.getContext();

    // The first bar carries the clef and time signature, so it needs more room.
    const firstExtra = 60;
    const barWidth = (renderWidth - 20 - firstExtra) / bars.length;

    const drawn = new Map<number, StaveNote[]>();
    let x = 10;

    for (const [barIndex, bar] of bars.entries()) {
      const currentWidth = barWidth + (barIndex === 0 ? firstExtra : 0);
      const stave = new Stave(x, STAVE_TOP, currentWidth);
      // '8vb' is what makes the treble clef mean guitar pitch rather than
      // concert pitch an octave higher.
      if (barIndex === 0) {
        stave
          .addClef('treble', undefined, '8vb')
          .addTimeSignature(exercise.timeSignature.join('/'));
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

      // Beams and tuplets must be constructed BEFORE the voice is drawn.
      // Building a Beam is what tells its notes to suppress their own flags —
      // do it afterwards and every beamed note renders a beam *and* a flag.
      const beams = Beam.generateBeams(notes);

      const groups = new Map<number, { notes: StaveNote[]; num: number; inSpaceOf: number }>();
      bar.notes.forEach((notated, i) => {
        if (!notated.tuplet) return;
        const { group, num, inSpaceOf } = notated.tuplet;
        const entry = groups.get(group) ?? { notes: [], num, inSpaceOf };
        entry.notes.push(notes[i]);
        groups.set(group, entry);
      });
      const tuplets = [...groups.values()]
        .filter((group) => group.notes.length === group.num)
        .map(
          (group) =>
            new Tuplet(group.notes, { numNotes: group.num, notesOccupied: group.inSpaceOf }),
        );

      new Formatter().joinVoices([voice]).format([voice], currentWidth - 40);
      voice.draw(context, stave);
      for (const beam of beams) beam.setContext(context).draw();
      for (const tuplet of tuplets) tuplet.setContext(context).draw();
    }

    // Ties join the fragments of any note that crossed a bar line.
    for (const fragments of drawn.values()) {
      for (let i = 0; i < fragments.length - 1; i++) {
        new StaveTie({ firstNote: fragments[i], lastNote: fragments[i + 1] })
          .setContext(context)
          .draw();
      }
    }

    followPageColour(host);
  }, [exercise, results, activeIndex, renderWidth]);

  return <div ref={hostRef} className="score" aria-label="Notated exercise" />;
}
