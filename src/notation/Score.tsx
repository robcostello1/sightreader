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
import type { MusicalKey } from '../lib/key';

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
/** Vertical pitch between systems when the music wraps onto several lines. */
const SYSTEM_HEIGHT = 175;
const FALLBACK_WIDTH = 720;
/** Horizontal room a single note needs before it starts colliding. */
const WIDTH_PER_NOTE = 34;
const BAR_PADDING = 26;
/** Clef, key signature and time signature on the first bar of a line. */
const FIRST_BAR_EXTRA = 90;
const MARGIN = 12;

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

function buildNote(notated: NotatedNote, key: MusicalKey): StaveNote {
  const isRest = notated.midi === null;
  // Sounding pitch in, written pitch on the page — see GUITAR_WRITTEN_OFFSET.
  const spelled = isRest ? REST_KEY : midiToVexKey(soundingToWritten(notated.midi!), key);

  const note = new StaveNote({
    keys: [spelled],
    duration: isRest ? `${notated.code}r` : notated.code,
  });

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

    // Width is driven by how many notes a bar holds. Giving every bar an equal
    // share crams the busy ones until their notes overlap the bar line.
    const barMinWidth = (bar: (typeof bars)[number]) =>
      BAR_PADDING + Math.max(1, bar.notes.length) * WIDTH_PER_NOTE;

    // Pack bars into systems, wrapping rather than shrinking past legibility.
    const systems: (typeof bars)[] = [];
    let current: typeof bars = [];
    let currentWidth = FIRST_BAR_EXTRA;
    for (const bar of bars) {
      const width = barMinWidth(bar);
      if (current.length > 0 && currentWidth + width > renderWidth - MARGIN * 2) {
        systems.push(current);
        current = [];
        currentWidth = FIRST_BAR_EXTRA;
      }
      current.push(bar);
      currentWidth += width;
    }
    if (current.length > 0) systems.push(current);

    const renderer = new Renderer(host, Renderer.Backends.SVG);
    renderer.resize(renderWidth, STAVE_TOP + systems.length * SYSTEM_HEIGHT);
    const context = renderer.getContext();

    /** Fragments of each source note, per system, so ties stay within a line. */
    const drawn = new Map<number, { note: StaveNote; system: number }[]>();

    systems.forEach((system, systemIndex) => {
      const available = renderWidth - MARGIN * 2 - FIRST_BAR_EXTRA;
      const minWidths = system.map(barMinWidth);
      const totalMin = minWidths.reduce((sum, w) => sum + w, 0);
      const y = STAVE_TOP + systemIndex * SYSTEM_HEIGHT;
      let x = MARGIN;

      system.forEach((bar, barIndex) => {
        // Distribute the line's width in proportion to each bar's content.
        const share = (minWidths[barIndex] / totalMin) * available;
        const width = share + (barIndex === 0 ? FIRST_BAR_EXTRA : 0);

        const stave = new Stave(x, y, width);
        // Every system restates the clef and key, as a printed score does.
        if (barIndex === 0) {
          stave.addClef('treble', undefined, '8vb').addKeySignature(exercise.key.name);
          if (systemIndex === 0) stave.addTimeSignature(exercise.timeSignature.join('/'));
        }
        stave.setContext(context).draw();
        x += width;

        const notes = bar.notes.map((notated) => {
          const note = buildNote(notated, exercise.key);
          const colour = colourFor(notated.sourceIndex, results, activeIndex);
          note.setStyle({ fillStyle: colour, strokeStyle: colour });
          const existing = drawn.get(notated.sourceIndex) ?? [];
          existing.push({ note, system: systemIndex });
          drawn.set(notated.sourceIndex, existing);
          return note;
        });
        if (notes.length === 0) return;

        const voice = new Voice({
          numBeats: exercise.timeSignature[0],
          beatValue: exercise.timeSignature[1],
        });
        // Soft mode: the final bar may be short while an exercise is built up.
        voice.setMode(VoiceMode.SOFT);
        voice.addTickables(notes);

        // VexFlow decides which accidentals are actually needed, given the key
        // signature and what has already been altered earlier in the bar. Adding
        // them by hand would restate what the signature already says.
        Accidental.applyAccidentals([voice], exercise.key.name);

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

        new Formatter().joinVoices([voice]).format([voice], width - BAR_PADDING - 20);
        voice.draw(context, stave);
        for (const beam of beams) beam.setContext(context).draw();
        for (const tuplet of tuplets) tuplet.setContext(context).draw();
      });
    });

    // Ties join the fragments of a note split across a bar line. A fragment that
    // lands on the next system is left untied — VexFlow's tie assumes one stave.
    for (const fragments of drawn.values()) {
      for (let i = 0; i < fragments.length - 1; i++) {
        if (fragments[i].system !== fragments[i + 1].system) continue;
        new StaveTie({ firstNote: fragments[i].note, lastNote: fragments[i + 1].note })
          .setContext(context)
          .draw();
      }
    }

    followPageColour(host);
  }, [exercise, results, activeIndex, renderWidth]);

  return <div ref={hostRef} className="score" aria-label="Notated exercise" />;
}
