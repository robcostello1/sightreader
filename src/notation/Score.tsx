import { useEffect, useRef, useState } from 'react';
import {
  Accidental,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Tuplet,
  Voice,
  VoiceMode,
  // Only the Bravura font, not every music font the default entry bundles.
} from 'vexflow/bravura';
import { beamBar } from './beaming';
import { verdictColours, type VerdictColours } from './colours';
import { layoutExercise, midiToVexKey, type NotatedNote } from './layout';
import { NO_SOURCE, mergeRests } from './rests';
import {
  instrumentById,
  soundingToWritten,
  staffModeFor,
  type InstrumentDefinition,
  type PositionDefinition,
} from '../config/instruments';
import { transposeKey } from '../lib/key';
import type { Exercise, Midi, NoteResult } from '../lib/types';
import type { MusicalKey } from '../lib/key';

/**
 * Where a rest sits, by clef. A rest is placed by staff position rather than by
 * pitch, so the same key that centres it on a treble staff floats it well above
 * a bass one.
 */
const REST_KEYS: Record<string, string> = {
  treble: 'b/4',
  bass: 'd/3',
  alto: 'c/4',
};

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

/**
 * Vertical budget. Guitar's written range in open position runs from E3, three
 * ledger lines below the staff, up to G#5 just above it — so the staff needs
 * headroom above and considerably more below, or the low strings get clipped.
 */
const STAVE_TOP = 40;
/** Vertical pitch between systems when the music wraps onto several lines. */
const SYSTEM_HEIGHT = 175;
/** A grand staff is two staves and needs room for both, plus their ledger lines. */
const GRAND_SYSTEM_HEIGHT = 300;
/** Treble stave top to bass stave top. */
const GRAND_STAFF_GAP = 120;
/** Where the hands divide. Middle C and above is the right hand's. */
const MIDDLE_C = 60;
const FALLBACK_WIDTH = 720;
/** Horizontal room a single note needs before it starts colliding. */
const WIDTH_PER_NOTE = 34;
/**
 * And the most it should get. Filling the width with a sparse bar pushes its
 * notes so far apart that they stop reading as a phrase — a two-note bar spread
 * over a whole line is harder to follow than a compact one.
 */
const MAX_WIDTH_PER_NOTE = 64;
const BAR_PADDING = 26;
const MARGIN = 12;

/**
 * Space the leading bar of a system spends on its clef, key signature and time
 * signature — none of which is available to notes. A key signature grows with
 * its accidental count, so this is measured rather than fixed.
 */
function leadingModifierWidth(accidentals: number, withTimeSignature: boolean): number {
  return 46 + 11 * Math.abs(accidentals) + (withTimeSignature ? 28 : 0);
}

/**
 * Which hand a tuplet group is written in: wherever most of it sounds, and the
 * first note's hand when it is even.
 *
 * A group divided at middle C would otherwise be printed twice, a bracket over
 * the two notes in one hand and another over the one in the other. It is one
 * triplet, so it gets one bracket, and a note or two crosses onto the other
 * staff with a ledger line — which is what a printed part does.
 */
function tupletStaves(
  notes: readonly NotatedNote[],
  instrument: InstrumentDefinition,
): Map<number, 'treble' | 'bass'> {
  const counts = new Map<number, { treble: number; bass: number; first: 'treble' | 'bass' }>();
  for (const notated of notes) {
    if (notated.tuplet === undefined || notated.midi === null) continue;
    const side = handFor(notated.midi, instrument);
    const entry = counts.get(notated.tuplet.group) ?? { treble: 0, bass: 0, first: side };
    entry[side]++;
    counts.set(notated.tuplet.group, entry);
  }
  return new Map(
    [...counts].map(([group, { treble, bass, first }]) => [
      group,
      treble === bass ? first : treble > bass ? 'treble' : 'bass',
    ]),
  );
}

function handFor(midi: Midi, instrument: InstrumentDefinition): 'treble' | 'bass' {
  return soundingToWritten(midi, instrument) >= MIDDLE_C ? 'treble' : 'bass';
}

/**
 * One staff's view of a bar: the notes that belong to it, with the other
 * staff's notes standing in as rests so both voices span the same bar.
 */
function notesForStaff(
  notes: readonly NotatedNote[],
  side: 'treble' | 'bass',
  instrument: InstrumentDefinition,
): NotatedNote[] {
  const tuplets = tupletStaves(notes, instrument);
  return notes.map((notated) => {
    if (notated.midi === null) return notated; // a rest is a rest in both hands
    const belongs =
      (notated.tuplet && tuplets.get(notated.tuplet.group)) ?? handFor(notated.midi, instrument);
    // Not this staff's note at all, so it answers to no result and no cursor —
    // it is only here so both voices count the same ticks.
    return belongs === side
      ? notated
      : { ...notated, midi: null, tiedToNext: false, sourceIndex: NO_SOURCE };
  });
}

export interface ScoreProps {
  exercise: Exercise;
  /** Decides the clef, the written octave and the written key. */
  instrument?: InstrumentDefinition;
  position?: PositionDefinition | null;
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
  colours: VerdictColours,
): string {
  if (activeIndex === sourceIndex) return colours.active;
  const result = results?.find((r) => r.index === sourceIndex);
  if (!result) return colours.idle;
  if (result.passed) return colours.pass;
  return result.verdict === 'unclear' ? colours.unclear : colours.fail;
}

function buildNote(
  notated: NotatedNote,
  key: MusicalKey,
  instrument: InstrumentDefinition,
  clef: string,
): StaveNote {
  const isRest = notated.midi === null;
  // Sounding pitch in, written pitch on the page.
  const spelled = isRest
    ? (REST_KEYS[clef] ?? REST_KEYS.treble)
    : midiToVexKey(soundingToWritten(notated.midi!, instrument), key);

  const note = new StaveNote({
    keys: [spelled],
    duration: isRest ? `${notated.code}r` : notated.code,
    // Without this a bass or alto staff would place every note as if it were
    // treble — the same line means a different pitch on each clef.
    clef,
  });

  for (let i = 0; i < notated.dots; i++) Dot.buildAndAttach([note], { all: true });

  return note;
}

/**
 * Renders a generated exercise as standard notation, colouring each note once
 * its window has been scored. VexFlow does the engraving; layoutExercise has
 * already done the bar splitting it expects.
 */
export function Score({
  exercise,
  instrument = instrumentById('guitar'),
  position = null,
  results,
  activeIndex,
  width,
}: ScoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  /** Last system scrolled to, so the view moves on wrapping and not every frame. */
  const scrolledSystemRef = useRef<number | null>(null);

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

    const colours = verdictColours(host);
    // The page is in the instrument's key, not the concert one: a B flat
    // clarinet playing in concert C reads D major, and its accidentals have to
    // agree with the notes beside them.
    const writtenKey = transposeKey(
      exercise.key,
      -instrument.transposition.semitones,
      -instrument.transposition.letters,
    );
    const staffMode = staffModeFor(instrument, position);
    const grand = staffMode === 'grand';
    const systemHeight = grand ? GRAND_SYSTEM_HEIGHT : SYSTEM_HEIGHT;
    const singleClef =
      staffMode === 'bass' ? 'bass' : instrument.clef === 'alto' ? 'alto' : 'treble';
    // Only guitar carries the octave mark; other octave-transposing instruments
    // are conventionally written without one.
    const clefAnnotation = instrument.id === 'guitar' ? '8vb' : undefined;
    const bars = layoutExercise(exercise);

    // Width is driven by how many notes a bar holds. Giving every bar an equal
    // share crams the busy ones until their notes overlap the bar line.
    const barMinWidth = (bar: (typeof bars)[number]) =>
      BAR_PADDING + Math.max(1, bar.notes.length) * WIDTH_PER_NOTE;

    const available = renderWidth - MARGIN * 2;

    // Pack bars into systems, wrapping rather than shrinking past legibility.
    const systems: (typeof bars)[] = [];
    let current: typeof bars = [];
    let currentWidth = leadingModifierWidth(writtenKey.accidentals, true);
    for (const bar of bars) {
      const width = barMinWidth(bar);
      if (current.length > 0 && currentWidth + width > available) {
        systems.push(current);
        current = [];
        currentWidth = leadingModifierWidth(writtenKey.accidentals, false);
      }
      current.push(bar);
      currentWidth += width;
    }
    if (current.length > 0) systems.push(current);

    const renderer = new Renderer(host, Renderer.Backends.SVG);
    renderer.resize(renderWidth, STAVE_TOP + systems.length * systemHeight);
    const context = renderer.getContext();

    /** Fragments of each source note, per system, so ties stay within a line. */
    const drawn = new Map<number, { note: StaveNote; system: number }[]>();

    systems.forEach((system, systemIndex) => {
      const leading = leadingModifierWidth(writtenKey.accidentals, systemIndex === 0);
      const minWidths = system.map(barMinWidth);
      const maxWidths = system.map(
        (bar) => BAR_PADDING + Math.max(1, bar.notes.length) * MAX_WIDTH_PER_NOTE,
      );
      const totalMin = minWidths.reduce((sum, w) => sum + w, 0);
      // Every bar keeps its minimum; only what is left over is shared out, and
      // no bar grows past what its notes can use. A purely proportional split
      // starves a busy bar and stretches an empty one.
      const spare = Math.max(0, available - leading - totalMin);
      const y = STAVE_TOP + systemIndex * systemHeight;
      let x = MARGIN;

      system.forEach((bar, barIndex) => {
        const share = minWidths[barIndex] + (spare * minWidths[barIndex]) / totalMin;
        const width = Math.min(share, maxWidths[barIndex]) + (barIndex === 0 ? leading : 0);
        const first = barIndex === 0;
        const last = barIndex === system.length - 1;

        /** Builds and draws one staff of this bar; returns its voice for formatting. */
        const buildStaff = (clef: string, staveY: number, side: 'treble' | 'bass' | null) => {
          const stave = new Stave(x, staveY, width);
          // Every system restates the clef and key, as a printed score does.
          if (first) {
            stave.addClef(clef, undefined, clefAnnotation).addKeySignature(writtenKey.name);
            if (systemIndex === 0) stave.addTimeSignature(exercise.timeSignature.join('/'));
          }
          stave.setContext(context).draw();

          const forThisStaff =
            side === null ? bar.notes : notesForStaff(bar.notes, side, instrument);
          const source = mergeRests(forThisStaff, exercise.timeSignature);
          const notes = source.map((notated) => {
            const note = buildNote(notated, writtenKey, instrument, clef);
            const colour = colourFor(notated.sourceIndex, results, activeIndex, colours);
            note.setStyle({ fillStyle: colour, strokeStyle: colour });
            // Only sounding notes are tied; a stand-in rest on the other staff
            // shares a source index but is not the same note.
            if (notated.midi !== null) {
              const existing = drawn.get(notated.sourceIndex) ?? [];
              existing.push({ note, system: systemIndex });
              drawn.set(notated.sourceIndex, existing);
            }
            return note;
          });
          if (notes.length === 0) return null;

          const voice = new Voice({
            numBeats: exercise.timeSignature[0],
            beatValue: exercise.timeSignature[1],
          });
          // Soft mode: the final bar may be short while an exercise is built up.
          voice.setMode(VoiceMode.SOFT);
          voice.addTickables(notes);

          // VexFlow decides which accidentals are actually needed, given the key
          // signature and what has already been altered earlier in the bar.
          Accidental.applyAccidentals([voice], writtenKey.name);

          // Beams and tuplets must be constructed BEFORE the voice is drawn.
          // Building a Beam is what tells its notes to suppress their own flags.
          const beams = beamBar(notes, source, exercise.timeSignature);

          const groups = new Map<
            number,
            { notes: StaveNote[]; num: number; inSpaceOf: number; sounds: boolean }
          >();
          source.forEach((notated, i) => {
            if (!notated.tuplet) return;
            const { group, num, inSpaceOf } = notated.tuplet;
            const entry = groups.get(group) ?? { notes: [], num, inSpaceOf, sounds: false };
            entry.notes.push(notes[i]);
            // Stand-in rests keep their tuplet so both staves count the same
            // ticks, but a bracket over nothing but rests belongs to the other
            // hand — draw it there, not here.
            entry.sounds = entry.sounds || notated.midi !== null;
            groups.set(group, entry);
          });
          const tuplets = [...groups.values()]
            .filter((g) => g.sounds && g.notes.length === g.num)
            .map((g) => new Tuplet(g.notes, { numNotes: g.num, notesOccupied: g.inSpaceOf }));

          return { stave, voice, beams, tuplets };
        };

        const staves = grand
          ? [buildStaff('treble', y, 'treble'), buildStaff('bass', y + GRAND_STAFF_GAP, 'bass')]
          : [buildStaff(singleClef, y, null)];
        const built = staves.filter((entry) => entry !== null);
        x += width;
        if (built.length === 0) return;

        // Both hands are formatted together, so a note in one lines up with
        // whatever sounds against it in the other.
        const formatter = new Formatter();
        for (const entry of built) formatter.joinVoices([entry.voice]);
        // Format to the stave's own note area, not its raw width: the leading
        // bar spends real space on clef, key and time signature.
        const usable = built[0].stave.getNoteEndX() - built[0].stave.getNoteStartX();
        formatter.format(
          built.map((entry) => entry.voice),
          Math.max(20, usable - 10),
        );

        for (const entry of built) {
          entry.voice.draw(context, entry.stave);
          for (const beam of entry.beams) beam.setContext(context).draw();
          for (const tuplet of entry.tuplets) tuplet.setContext(context).draw();
        }

        // The brace and the joined barlines are what make two staves read as one
        // instrument rather than two parts.
        if (grand && built.length === 2) {
          const [top, bottom] = built;
          if (first) {
            new StaveConnector(top.stave, bottom.stave)
              .setType('brace')
              .setContext(context)
              .draw();
            new StaveConnector(top.stave, bottom.stave)
              .setType('singleLeft')
              .setContext(context)
              .draw();
          }
          new StaveConnector(top.stave, bottom.stave)
            .setType(last ? 'boldDoubleRight' : 'singleRight')
            .setContext(context)
            .draw();
        }
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

    // A long exercise scrolls inside its area. The line being played is put at
    // the top rather than centred, so the line after it is visible — a reader
    // needs to see what is coming, not just where they are.
    const scroller = host.parentElement;
    if (activeIndex === undefined) {
      scrolledSystemRef.current = null;
    } else if (scroller && scroller.scrollHeight > scroller.clientHeight) {
      const activeSystem = systems.findIndex((system) =>
        system.some((bar) => bar.notes.some((n) => n.sourceIndex === activeIndex)),
      );
      // Only when the music wraps to a new line; scrolling every frame would
      // restart the animation before it finished.
      if (activeSystem >= 0 && activeSystem !== scrolledSystemRef.current) {
        scrolledSystemRef.current = activeSystem;
        // Leaves the system's own STAVE_TOP as headroom, so ledger lines above
        // the staff are not clipped against the top edge.
        scroller.scrollTo({ top: activeSystem * systemHeight, behavior: 'smooth' });
      }
    }
  }, [exercise, instrument, position, results, activeIndex, renderWidth]);

  return <div ref={hostRef} className="score" aria-label="Notated exercise" />;
}
