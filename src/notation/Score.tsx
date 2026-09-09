import { useEffect, useRef, useState } from 'react';
import {
  Accidental,
  Dot,
  Formatter,
  Stave,
  StaveConnector,
  Renderer,
  StaveNote,
  StaveTie,
  TickContext,
  Tuplet,
  Voice,
  VoiceMode,
  // Only the Bravura font, not every music font the default entry bundles.
} from 'vexflow/bravura';
import type { RenderContext } from 'vexflow/bravura';
import { beamBar } from './beaming';
import { verdictColours, type VerdictColours } from './colours';
import {
  explicitAccidental,
  layoutExercise,
  midiToVexKey,
  octaveShiftFor,
  octaveSignLabel,
  type NotatedNote,
} from './layout';
import { mergeRests } from './rests';
import { handFor, notesForStaff } from './hands';
import {
  instrumentById,
  soundingToWritten,
  staffModeFor,
  type InstrumentDefinition,
  type PositionDefinition,
} from '../config/instruments';
import { notatedValue } from '../lib/duration';
import { transposeKey } from '../lib/key';
import { NOTE_VALUES, type Exercise, type Midi, type NoteResult } from '../lib/types';
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
 * Headroom above the first staff, on top of the four ledger lines' worth
 * VexFlow already reserves.
 *
 * Twelve once, which was eighty pixels of empty page below a bar of plain
 * crotchets and not enough for a triplet: the bracket over a note at the top of
 * the written range sits twenty-five pixels above the staff, and VexFlow
 * centres the number on the bracket line, another nine above that. Both fell
 * outside the drawing and were cut off by its top edge.
 */
const STAVE_TOP = 40;
/**
 * Vertical pitch between systems when the music wraps onto several lines.
 *
 * A hundred and seventy-five once, of which the lowest mark ever drawn reached
 * 122 — fifty-three pixels of every line were blank by construction. A staff
 * with its ledger lines and an 8vb under it is 122; the rest is the air that
 * separates one line from the next, and thirty of that is plenty.
 */
const SYSTEM_HEIGHT = 152;
/** A grand staff is two staves and needs room for both, plus their ledger lines. */
const GRAND_SYSTEM_HEIGHT = 250;
/**
 * How far down its own marks a system can actually reach, measured across the
 * generator's whole output — the rest of its height is the air before the next
 * one. Only the last system on a page has no next one, so only its share of
 * that air is worth reclaiming, and the drawing ends where its music does.
 */
const SYSTEM_INK = 122;
const GRAND_SYSTEM_INK = 248;
/**
 * Treble stave top to bass stave top: eighty pixels of air between them.
 *
 * Tightened to sixty once, which was too far — a right hand written under its
 * own staff reaches into the gap, and at sixty it reached into the left hand's
 * notes.
 */
const GRAND_STAFF_GAP = 120;
const FALLBACK_WIDTH = 720;
/**
 * How room grows with a note's length.
 *
 * Engraving spaces notes neither equally nor in proportion to their length. A
 * minim is wider than a crotchet but nowhere near twice as wide, and the usual
 * rule is a factor of the square root of two per halving. Spaced in strict
 * proportion a bar of semibreves wastes half a line and a run of semiquavers is
 * unreadable; spaced equally, the long notes read as the quick ones.
 *
 * The square root of the length is what that rule says, and 0.5 is what this
 * was. Measured on the page it came out at 1.26 rather than 1.41, because
 * VexFlow gives every note a minimum of its own whatever its length, and that
 * fixed part of a bar's width falls hardest on the bar with the most notes in
 * it. Allotting on a slightly steeper curve pays that back: 0.6 measures 1.35
 * to 1.41 between a crotchet and a quaver, which is the ratio the rule is
 * after.
 */
const SPACING_EXPONENT = 0.6;
/**
 * The least room a crotchet's worth of music may be given, and so — by the
 * curve — the least any note may be given.
 *
 * A line that cannot afford this for every bar on it is holding too much
 * music, and the answer is to break it sooner rather than to set it tighter.
 * That is what keeps the ratios: squeezing is the thing that destroys them,
 * because it never falls evenly on every bar.
 */
const MIN_WIDTH_PER_CROTCHET = 22;
/**
 * How far the drawing may be reduced to fit the page, and the room it is fitting.
 *
 * A phone column is three hundred-odd pixels. Engraved at its own width a grand
 * staff runs to about 790 pixels of music where 576 are visible, so two thirds
 * of exercises had to be scrolled — and following a moving cursor down a
 * scrolling page is the one thing a sight-reading page must not ask for. Drawn
 * wider and scaled to the column instead, everything shrinks together, staves
 * and noteheads and spacing alike, so the reduction costs size but no
 * proportion.
 *
 * It is only ever taken as far as it needs to go. Reducing an exercise that
 * already fits buys nothing and costs legibility, which is what a page of
 * eight notes shrunk to two thirds looked like. Half again is as far as it
 * goes: past that the staff is too small to read at a music stand, and the
 * honest answer is to scroll after all.
 */
const MIN_ENGRAVING_SCALE = 0.66;
/**
 * The room the music is fitted into, mirroring the score area's own height in
 * index.css — 36rem on a phone, and about that on a desk once the controls and
 * the cards below have taken theirs.
 */
const PAGE_BUDGET = 576;
/**
 * And the most it should get. Filling the width with a sparse bar pushes its
 * notes so far apart that they stop reading as a phrase — a two-note bar spread
 * over a whole line is harder to follow than a compact one.
 */
const MAX_WIDTH_PER_CROTCHET = 46;
const BAR_PADDING = 26;
/**
 * The octave sign is drawn here rather than with VexFlow's TextBracket.
 *
 * TextBracket lays its dashed line out from the measured width and height of
 * its own label, and measuring text needs a font engine. Under jsdom there
 * isn't one: the height comes back NaN once the label has been rendered, every
 * coordinate derived from it follows, and the dash loop — which walks towards a
 * target it compares with `>=` — never reaches NaN and runs until the SVG path
 * string exhausts the string length limit. So a single 8va took the notation
 * tests from 3 seconds to 337 and failed 27 of them.
 *
 * Drawing it here needs no measurement at all. The label is placed at the
 * passage's first notehead and the line starts a fixed distance after it, which
 * is all the geometry an octave sign has.
 */
const OCTAVE_SIGN_LINE = 1;
/** Room left for the label before the dashed line starts, in pixels. */
const OCTAVE_LABEL_WIDTH: Record<number, number> = { 1: 20, 2: 30 };
/** Length of the hook that closes the sign over its last note. */
const OCTAVE_HOOK = 8;
const OCTAVE_DASH = [4, 3];
/**
 * Blank page either side of the music.
 *
 * Twelve once, which on a phone is seven per cent of the column spent on
 * nothing, on top of the page's own padding outside the drawing. The staff
 * needs a little air so its barlines do not sit against the edge, and four is
 * enough for that.
 */
const MARGIN = 4;

/**
 * Space the leading bar of a system spends on its clef, key signature and time
 * signature — none of which is available to notes. A key signature grows with
 * its accidental count, so this is measured rather than fixed.
 */
/** Swaps VexFlow's fixed width for a viewBox, so the drawing fits whatever room it has. */
function fitToContainer(host: HTMLElement, width: number, height: number): void {
  const svg = host.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  // Inline, because VexFlow's own width is inline and a stylesheet cannot outrank it.
  svg.style.width = '100%';
  svg.style.height = 'auto';
}

/**
 * What the clef, key and time signature take out of a bar, measured rather than
 * estimated.
 *
 * It used to be `46 + 11 per accidental + 28 for the time signature`, which is
 * close but not equal to what VexFlow lays out — and the difference all lands
 * on the first bar of every line, since that is the only bar carrying them. Fed
 * an estimate that ran high, the first bar kept the surplus as note room: a bar
 * of quavers at the head of a line came out roomier per note than a bar of
 * crotchets after it, which is the wrong way round however the notes are
 * spaced.
 *
 * A throwaway stave is cheap and knows the answer exactly.
 */
function measureLeading(
  clef: string,
  annotation: string | undefined,
  keyName: string,
  timeSignature: string | null,
): number {
  const probe = new Stave(0, 0, 500);
  probe.addClef(clef, undefined, annotation).addKeySignature(keyName);
  if (timeSignature !== null) probe.addTimeSignature(timeSignature);
  return probe.getNoteStartX() - probe.getX();
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
  /**
   * Sounding pitch currently being heard, drawn faintly over the note being
   * played so the gap between what is written and what is coming out is visible
   * on the staff itself. Already steadied — see useSteadyPitch — because a
   * ghost that flickers with the detector would be worse than none.
   */
  heardMidi?: Midi | null;
  /** Fixed width; when omitted the score fills its container. */
  width?: number;
}

/**
 * Filled stand-ins for the hollow noteheads, by duration code.
 *
 * The ghost takes the shape of the note it covers but is always filled: hollow
 * and translucent leaves a faint ring that is hard to place against a stave
 * line, and the ghost is stating a pitch, not a duration — which is the same
 * reason its stem and flag are hidden.
 *
 * SMuFL U+E0FA and U+E0FB, written out because VexFlow does not re-export its
 * glyph table and a SMuFL codepoint is fixed by the standard. There is no
 * filled breve in SMuFL, so a breve borrows the filled semibreve — the nearest
 * head that exists, and the same width.
 */
const FILLED_HEAD: Record<string, string> = {
  '1/2': '\uE0FA',
  w: '\uE0FA',
  h: '\uE0FB',
};

/**
 * Where a ghost note can be pinned: the note being played fixes the horizontal
 * position, and the staves of its bar are what it might be drawn on. Both
 * staves are kept because the heard pitch decides which one it belongs to,
 * which need not be the staff the written note is on.
 */
interface HeardAnchor {
  /** Tick position rather than absolute x, so it transfers between staves. */
  tickX: number;
  /** The played note's duration, so the ghost takes the same notehead shape. */
  code: string;
  staves: Map<'treble' | 'bass' | 'single', Stave>;
  /** Octave sign in force on each staff of that bar, so the guide matches it. */
  octaveShifts: Map<'treble' | 'bass' | 'single', number>;
}

/**
 * Everything the guide layer needs from the last engraving of the score.
 *
 * The guide is drawn on a layer of its own rather than into the score, because
 * the score is redrawn whole every time a note is scored or the cursor moves —
 * several times a bar. An element that is destroyed and rebuilt that often can
 * neither fade nor travel; one that outlives the redraws can do both.
 */
interface GuidePlan {
  anchor: HeardAnchor | null;
  width: number;
  height: number;
  /** Container width over drawn width: 1 unless the music had to be shrunk. */
  scale: number;
  grand: boolean;
  singleClef: string;
  writtenKey: MusicalKey;
  colour: string;
}

/**
 * Past this far, a move is not a move. The music wrapping to the next line puts
 * the next note at the other end and a line lower, and sliding the whole way
 * across the page reads as a mistake rather than as travel.
 */
const GUIDE_JUMP_PX = 140;

/**
 * An octave sign over or under a passage: the label, a dashed line to the last
 * notehead, and a hook turning down onto it.
 */
function drawOctaveSign(
  context: RenderContext,
  stave: Stave,
  ends: { start: StaveNote; stop: StaveNote },
  shift: number,
  colour: string,
): void {
  const label = octaveSignLabel(shift);
  if (label === null) return;
  const above = shift > 0;
  const y = above
    ? stave.getYForTopText(OCTAVE_SIGN_LINE)
    : stave.getYForBottomText(OCTAVE_SIGN_LINE);
  const startX = ends.start.getAbsoluteX();
  const endX = ends.stop.getAbsoluteX() + ends.stop.getGlyphWidth();
  // Everything downstream is arithmetic on these two, so a note that never got
  // a tick context would otherwise draw a line to nowhere.
  if (!Number.isFinite(startX) || !Number.isFinite(endX) || !Number.isFinite(y)) return;

  context.save();
  context.setFont('Times', 13, 'normal', 'italic');
  context.setFillStyle(colour);
  context.setStrokeStyle(colour);
  context.fillText(`${label.text}${label.superscript}`, startX, y);

  const lineFrom = startX + (OCTAVE_LABEL_WIDTH[Math.abs(shift)] ?? 20);
  // Too short for a line and the label alone says it, which is what an engraver
  // does over a single note.
  if (endX > lineFrom) {
    Renderer.drawDashedLine(context, lineFrom, y - 4, endX, y - 4, OCTAVE_DASH);
    const hook = above ? OCTAVE_HOOK : -OCTAVE_HOOK;
    Renderer.drawDashedLine(context, endX, y - 4, endX, y - 4 + hook, OCTAVE_DASH);
  }
  context.restore();
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
  octaveShift = 0,
  barRest = false,
): StaveNote {
  const isRest = notated.midi === null;
  // Sounding pitch in, written pitch on the page — displaced by any octave sign
  // covering this bar, which is what puts the passage back beside the staff.
  const spelled = isRest
    ? (REST_KEYS[clef] ?? REST_KEYS.treble)
    : midiToVexKey(soundingToWritten(notated.midi!, instrument) - 12 * octaveShift, key);

  const note = new StaveNote({
    keys: [spelled],
    // The dots belong in the duration as well as on the page: Dot.buildAndAttach
    // draws them but does not lengthen the note, and a voice of notes an eighth
    // short of their written value put the two hands out of line with each other.
    duration: `${notated.code}${'d'.repeat(notated.dots)}${isRest ? 'r' : ''}`,
    // Without this a bass or alto staff would place every note as if it were
    // treble — the same line means a different pitch on each clef.
    clef,
  });

  for (let i = 0; i < notated.dots; i++) Dot.buildAndAttach([note], { all: true });

  // A rest standing for a whole bar is centred in it, as printed music does.
  if (isRest && barRest) note.setCenterAlignment(true);

  return note;
}

/**
 * The tuplets a staff's notes belong to, built and attached.
 *
 * Building one is what divides its notes' ticks — three quavers in the space of
 * two — so it must happen before the notes reach a voice: a voice adds up what
 * it is given when it is given it, and a triplet reduced afterwards leaves the
 * voice a third of a beat too long and the two hands disagreeing about where
 * the next beat is.
 *
 * `sounds` marks the groups this staff actually plays. A group that reaches
 * this staff as nothing but the other hand's stand-in rests still needs its
 * ticks divided, but its bracket belongs over the hand that plays it.
 */
function tupletsFor(
  source: readonly NotatedNote[],
  notes: StaveNote[],
): { all: Tuplet[]; sounding: Tuplet[] } {
  const groups = new Map<
    number,
    { notes: StaveNote[]; num: number; inSpaceOf: number; sounds: boolean }
  >();
  source.forEach((notated, i) => {
    if (!notated.tuplet) return;
    const { group, num, inSpaceOf } = notated.tuplet;
    const entry = groups.get(group) ?? { notes: [], num, inSpaceOf, sounds: false };
    entry.notes.push(notes[i]);
    entry.sounds = entry.sounds || notated.midi !== null;
    groups.set(group, entry);
  });

  const all: Tuplet[] = [];
  const sounding: Tuplet[] = [];
  for (const group of groups.values()) {
    // Short of its full count, the group was merged into one rest already
    // carrying the whole of its length — dividing that again would halve it.
    if (group.notes.length !== group.num) continue;
    const tuplet = new Tuplet(group.notes, {
      numNotes: group.num,
      notesOccupied: group.inSpaceOf,
    });
    all.push(tuplet);
    if (group.sounds) sounding.push(tuplet);
  }
  return { all, sounding };
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
  heardMidi = null,
  width,
}: ScoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const staffRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  /** Last system scrolled to, so the view moves on wrapping and not every frame. */
  const scrolledSystemRef = useRef<number | null>(null);
  /** The exercise last drawn, so a new one can be recognised and scrolled back to. */
  const engravedRef = useRef<Exercise | null>(null);
  /** What the last engraving left behind for the guide layer to draw against. */
  const planRef = useRef<GuidePlan | null>(null);
  /** Where the guide is now, so a move can start from where the eye left it. */
  const guideAtRef = useRef<{ x: number; y: number } | null>(null);
  // The guide is redrawn when the plan changes as well as when the pitch does —
  // the note under it moves on every beat. A ref alone cannot say when that
  // happened, so the engraving counts itself.
  const [engraving, setEngraving] = useState(0);

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

  /** The column the drawing is displayed in. */
  const containerWidth = width ?? measured ?? FALLBACK_WIDTH;

  useEffect(() => {
    const host = hostRef.current;
    const staff = staffRef.current;
    if (!host || !staff) return;
    staff.replaceChildren();

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

    /**
     * The measured leading, cached: only two answers exist per engraving, one
     * for the line that carries the time signature and one for the rest.
     */
    const leadingCache = new Map<boolean, number>();
    const leadingModifierWidth = (withTimeSignature: boolean) => {
      const found = leadingCache.get(withTimeSignature);
      if (found !== undefined) return found;
      // The treble stave of a grand staff is the one the notes are formatted
      // to, so it is the one whose modifiers decide the room they have.
      const width = measureLeading(
        grand ? 'treble' : singleClef,
        clefAnnotation,
        writtenKey.name,
        withTimeSignature ? exercise.timeSignature.join('/') : null,
      );
      leadingCache.set(withTimeSignature, width);
      return width;
    };

    /**
     * What VexFlow says a bar needs, in pixels of note area.
     *
     * Asked rather than guessed. A per-note estimate cannot know about
     * accidentals, dots, beamed sixteenths or two hands sharing one bar, and
     * where it guessed low the formatter drew the notes on top of each other.
     * Throwaway voices, built and measured and dropped; the drawing pass builds
     * its own.
     */
    const measured = new Map<(typeof bars)[number], number>();
    const minNoteWidth = (bar: (typeof bars)[number]) => {
      const found = measured.get(bar);
      if (found !== undefined) return found;
      const sides: ('treble' | 'bass' | null)[] = grand ? ['treble', 'bass'] : [null];
      const voices: Voice[] = [];
      for (const side of sides) {
        const forThisStaff =
          side === null
            ? bar.notes
            : notesForStaff(bar.notes, side, instrument, exercise.timeSignature);
        const source = mergeRests(forThisStaff, exercise.timeSignature);
        if (source.length === 0) continue;
        const clef = side === null ? singleClef : side;
        const octaveShift = octaveShiftFor(
          clef,
          source
            .filter((notated) => notated.midi !== null)
            .map((notated) => soundingToWritten(notated.midi!, instrument)),
        );
        const voice = new Voice({
          numBeats: exercise.timeSignature[0],
          beatValue: exercise.timeSignature[1],
        });
        voice.setMode(VoiceMode.SOFT);
        const notes = source.map((notated) =>
          buildNote(notated, writtenKey, instrument, clef, octaveShift, source.length === 1),
        );
        tupletsFor(source, notes);
        voice.addTickables(notes);
        Accidental.applyAccidentals([voice], writtenKey.name);
        voices.push(voice);
      }
      if (voices.length === 0) {
        measured.set(bar, 0);
        return 0;
      }
      const formatter = new Formatter();
      // One call, not one per voice: joinVoices is what makes the voices share
      // tick contexts, and a voice joined alone is measured alone.
      formatter.joinVoices(voices);
      const width = formatter.preCalculateMinTotalWidth(voices);
      measured.set(bar, width);
      return width;
    };

    /**
     * What one bar's notes ask for, in crotchets' worth of room.
     *
     * A crotchet counts one, a quaver 0.71 and a minim 1.41, by the curve
     * above. Summed over the bar this is the width the bar wants relative to
     * its neighbours — so a bar of eight quavers asks for 5.7 against a bar of
     * four crotchets' 4, and comes out the wider of the two without coming out
     * twice as wide.
     */
    const barDemand = (bar: (typeof bars)[number]) =>
      Math.max(
        SPACING_EXPONENT,
        bar.notes.reduce((sum, note) => {
          const written = notatedValue(note);
          // A tuplet's notes are shorter than they are written: three quavers
          // in the time of two are each two thirds of a quaver, and three of
          // them rightly ask for more room than the crotchet they replace.
          const sounded = note.tuplet
            ? (written * note.tuplet.inSpaceOf) / note.tuplet.num
            : written;
          return sum + (sounded / NOTE_VALUES.quarter) ** SPACING_EXPONENT;
        }, 0),
      );
    /**
     * The tightest a line may be set, and what its music adds up to.
     *
     * One density for the whole line — pixels per crotchet's worth of music —
     * because that is the only way a crotchet stays wider than a quaver in the
     * bar next door as well as its own. Bars used to be given a share each and
     * any that fell under the floor its notes needed was lifted to it out of
     * its neighbours' share, which is precisely how a dense bar of quavers
     * ended up roomier than the sparse bar of crotchets beside it.
     *
     * So the floor is a property of the line, not of a bar in it: the bar that
     * needs the most room per crotchet sets the density for all of them, and
     * every bar is that density times what its own notes ask for. Nothing is
     * taken from anything else, and the ratios hold across the line.
     */
    const lineFloor = (system: (typeof bars)[number][]) => {
      let density = MIN_WIDTH_PER_CROTCHET;
      let demand = 0;
      for (const bar of system) {
        const asked = barDemand(bar);
        demand += asked;
        density = Math.max(density, minNoteWidth(bar) / asked);
      }
      return { density, demand };
    };
    /** What a line costs at that density, bar padding and clef included. */
    const lineWidth = (system: (typeof bars)[number][], first: boolean) => {
      const { density, demand } = lineFloor(system);
      return (
        leadingModifierWidth(first) +
        system.length * BAR_PADDING +
        density * demand
      );
    };
    /**
     * Breaks the bars into lines for a given engraving width, and says how tall
     * and wide the result comes out.
     *
     * A function of the width because the width is not known yet: how much
     * music a line holds is what decides how many lines there are, which is
     * what decides whether the page fits. The bar measurements it leans on are
     * cached across calls, so trying a handful of widths costs little.
     */
    const layoutAt = (engraved: number) => {
      const available = engraved - MARGIN * 2;
      /*
       * A line takes another bar for as long as it can still afford to set
       * every bar on it at the tightest density any of them needs.
       *
       * That is the whole line-breaking rule now. A bar was measured on its own
       * before, against a figure it would like rather than one it could live
       * with, so a line could accept a bar it then had to squeeze — and the
       * squeezing came out of whichever bars could take it. Asking what the
       * line as a whole would cost, before committing to it, is what turns an
       * overcrowded line into two readable ones.
       */
      const systems: (typeof bars)[] = [];
      let current: typeof bars = [];
      for (const bar of bars) {
        if (current.length > 0 && lineWidth([...current, bar], systems.length === 0) > available) {
          systems.push(current);
          current = [];
        }
        current.push(bar);
      }
      if (current.length > 0) systems.push(current);

      // And where even one bar alone does not fit, draw at the width it needs
      // and let the viewBox scale it: small is legible, cut off is not.
      const needed = Math.max(
        ...systems.map((system, index) => lineWidth(system, index === 0)),
      );
      const drawWidth = Math.max(engraved, needed + MARGIN * 2);
      const height =
        STAVE_TOP + (systems.length - 1) * systemHeight + (grand ? GRAND_SYSTEM_INK : SYSTEM_INK);
      return {
        systems,
        drawWidth,
        height,
        /** What the drawing measures once scaled to the column it is shown in. */
        shownHeight: (height * containerWidth) / drawWidth,
      };
    };

    /*
     * Engrave at the column's own width if the music fits in it, and only widen
     * — which is to say, only shrink what the reader sees — until it does.
     *
     * Widening is what buys bars per line: a line that holds four bars instead
     * of two halves the number of lines, and the drawing scaled down to the
     * column is shorter for it even though nothing was cut. Applied to every
     * exercise alike it also shrank the ones that already fitted, which is a
     * loss and nothing else. Stepped like this, a short exercise is drawn full
     * size and a long one is reduced exactly as far as fitting requires.
     */
    let plan = layoutAt(containerWidth);
    for (let scale = 0.95; plan.shownHeight > PAGE_BUDGET && scale >= MIN_ENGRAVING_SCALE; scale -= 0.05) {
      const wider = layoutAt(containerWidth / scale);
      // A width that buys nothing is not worth the size it costs.
      if (wider.shownHeight >= plan.shownHeight) continue;
      plan = wider;
    }
    const { systems, drawWidth } = plan;
    const drawAvailable = drawWidth - MARGIN * 2;

    const renderHeight = plan.height;
    const renderer = new Renderer(staff, Renderer.Backends.SVG);
    renderer.resize(drawWidth, renderHeight);
    fitToContainer(staff, drawWidth, renderHeight);
    const context = renderer.getContext();

    /** Fragments of each source note, per system, so ties stay within a line. */
    const drawn = new Map<number, { note: StaveNote; system: number }[]>();
    /** Where the heard-note ghost goes, once the note being played is formatted. */
    let heardAnchor: HeardAnchor | null = null;

    systems.forEach((system, systemIndex) => {
      const leading = leadingModifierWidth(systemIndex === 0);
      const demands = system.map(barDemand);
      const { density: tightest, demand: totalDemand } = lineFloor(system);
      /*
       * One density for the whole line, and every bar is that density times
       * what its notes ask for.
       *
       * A line settled bar by bar cannot hold the curve across bar lines: the
       * spare width was shared equally before, and since a busy bar starts from
       * a much higher floor it stayed wider than its share of the music, so at
       * a wide window a crotchet ended up no roomier than a quaver. Deciding
       * one figure for the line and multiplying instead keeps a crotchet the
       * square root of two wider than a quaver wherever either of them is.
       *
       * It is also what makes a narrow screen work. Less room lowers the
       * density and nothing else, so the whole line closes up together and the
       * long notes stay long relative to the short ones — rather than the
       * differences between them being squeezed out first.
       */
      const roomForNotes = drawAvailable - leading - system.length * BAR_PADDING;
      /*
       * Fill the line, but never tighter than its tightest bar can bear and
       * never looser than notes still read as a phrase.
       */
      const density = Math.max(
        tightest,
        Math.min(MAX_WIDTH_PER_CROTCHET, Math.max(0, roomForNotes) / totalDemand),
      );
      const y = STAVE_TOP + systemIndex * systemHeight;
      let x = MARGIN;

      system.forEach((bar, barIndex) => {
        const width =
          BAR_PADDING + density * demands[barIndex] + (barIndex === 0 ? leading : 0);
        const first = barIndex === 0;
        const last = barIndex === system.length - 1;

        /** Builds and draws one staff of this bar; returns its voice for formatting. */
        const buildStaff = (clef: string, staveY: number, side: 'treble' | 'bass' | null) => {
          // Boxed rather than a plain local: it is assigned inside the map
          // below, which TypeScript's flow analysis does not follow.
          const found: { active: StaveNote | null; code: string } = { active: null, code: 'q' };
          const stave = new Stave(x, staveY, width);
          // Every system restates the clef and key, as a printed score does.
          if (first) {
            stave.addClef(clef, undefined, clefAnnotation).addKeySignature(writtenKey.name);
            if (systemIndex === 0) stave.addTimeSignature(exercise.timeSignature.join('/'));
          }
          stave.setContext(context).draw();

          const forThisStaff =
            side === null
            ? bar.notes
            : notesForStaff(bar.notes, side, instrument, exercise.timeSignature);
          const source = mergeRests(forThisStaff, exercise.timeSignature);
          // One sign for the whole bar of this staff — see octaveShiftFor.
          const octaveShift = octaveShiftFor(
            clef,
            source
              .filter((notated) => notated.midi !== null)
              .map((notated) => soundingToWritten(notated.midi!, instrument)),
          );
          const notes = source.map((notated) => {
            const note = buildNote(
              notated,
              writtenKey,
              instrument,
              clef,
              octaveShift,
              source.length === 1,
            );
            const colour = colourFor(notated.sourceIndex, results, activeIndex, colours);
            note.setStyle({ fillStyle: colour, strokeStyle: colour });
            if (notated.sourceIndex === activeIndex && found.active === null) {
              found.active = note;
              found.code = notated.code;
            }
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

          // Before the voice, which is what makes its arithmetic come out.
          const tuplets = tupletsFor(source, notes);

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

          // Beams must be constructed BEFORE the voice is drawn: building one
          // is what tells its notes to suppress their own flags.
          const beams = beamBar(notes, source, exercise.timeSignature);

          // The sign spans the sounding notes; a rest at either end is not part
          // of the passage and a bracket reaching over it reads as a mistake.
          const sounding = notes.filter((_, i) => source[i].midi !== null);
          const ends =
            octaveShift !== 0 && sounding.length > 0
              ? { start: sounding[0], stop: sounding[sounding.length - 1] }
              : null;
          return {
            stave,
            voice,
            beams,
            tuplets: tuplets.sounding,
            ends,
            side,
            octaveShift,
            active: found.active,
            code: found.code,
          };
        };

        const staves = grand
          ? [buildStaff('treble', y, 'treble'), buildStaff('bass', y + GRAND_STAFF_GAP, 'bass')]
          : [buildStaff(singleClef, y, null)];
        const built = staves.filter((entry) => entry !== null);
        x += width;
        if (built.length === 0) return;

        // Both hands are formatted together, so a note in one lines up with
        // whatever sounds against it in the other. That alignment is what one
        // joinVoices call buys — joined one at a time they share no tick
        // context, and the same beat lands at two different x.
        const formatter = new Formatter();
        formatter.joinVoices(built.map((entry) => entry.voice));
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
          // After the voice: the sign is positioned from where its notes ended
          // up, which formatting decides.
          if (entry.ends) {
            drawOctaveSign(context, entry.stave, entry.ends, entry.octaveShift, colours.idle);
          }
        }

        // Formatting is what gives a note an x, so the ghost's position can only
        // be taken now. A note split across a bar line has a fragment in more
        // than one bar; the first is where the note is actually struck.
        const activeEntry = built.find((entry) => entry.active !== null);
        if (activeEntry?.active && heardAnchor === null) {
          heardAnchor = {
            tickX: activeEntry.active.getTickContext().getX(),
            code: activeEntry.code,
            staves: new Map(built.map((entry) => [entry.side ?? 'single', entry.stave])),
            octaveShifts: new Map(built.map((entry) => [entry.side ?? 'single', entry.octaveShift])),
          };
        }

        /*
         * The joined barlines are what make two staves read as one instrument
         * rather than two parts.
         *
         * A brace used to stand outside them. VexFlow draws it to the left of
         * where the stave starts, so it needs page margin to live in, and the
         * margin is down to four pixels — a phone has none to spare and the
         * brace was drawn mostly outside the picture and clipped. It says the
         * same thing the barline down the left already says, so it is gone
         * rather than paid for.
         */
        if (grand && built.length === 2) {
          const [top, bottom] = built;
          if (first) {
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

    // What the guide layer needs to place a notehead over the note being
    // played. Handed over rather than drawn here: see GuidePlan.
    planRef.current = {
      anchor: heardAnchor,
      width: drawWidth,
      height: renderHeight,
      // So the guide travels in the units the eye sees, not the ones VexFlow drew in.
      scale: containerWidth / drawWidth,
      grand,
      singleClef,
      writtenKey,
      colour: colours.idle,
    };
    setEngraving((count) => count + 1);

    followPageColour(staff);

    // A long exercise scrolls inside its area. The line being played is put at
    // the top rather than centred, so the line after it is visible — a reader
    // needs to see what is coming, not just where they are.
    const scroller = host.parentElement;
    // A new exercise starts at its first line, wherever the last one was read to.
    if (exercise !== engravedRef.current) {
      engravedRef.current = exercise;
      scrolledSystemRef.current = null;
      // Set rather than animated: the first line should be there already, not
      // arriving.
      if (scroller) scroller.scrollTop = 0;
    }
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
    // renderWidth is a function of containerWidth, so the column alone is what
    // this watches: a narrower phone re-scales the drawing without re-engraving it.
  }, [exercise, instrument, position, results, activeIndex, containerWidth]);

  // The guide note, on its own layer over the staff. Drawn whenever the pitch
  // heard changes or the score is re-engraved under it.
  useEffect(() => {
    const layer = guideRef.current;
    const plan = planRef.current;
    if (!layer) return;

    const anchor = plan?.anchor ?? null;
    // Nothing being heard, or nothing being played to lay it over. The drawing
    // is left where it is and only faded out, so a note that comes back within
    // the fade returns rather than restarting.
    if (heardMidi === null || plan === null || anchor === null) {
      layer.classList.remove('is-shown');
      guideAtRef.current = null;
      return;
    }

    const { grand, singleClef, writtenKey, colour } = plan;
    const written = soundingToWritten(heardMidi, instrument);
    const side = grand ? handFor(heardMidi, instrument) : 'single';
    const stave = anchor.staves.get(side) ?? anchor.staves.values().next().value;
    if (!stave) return;

    const clef = grand ? side : singleClef;
    // Displaced with the bar it sits over, or a guide under an 8va passage
    // would be drawn an octave away from the note it is guiding.
    const shift = anchor.octaveShifts.get(side) ?? 0;
    // The played note's own duration, so the guide takes that note's notehead
    // and reads as it moved rather than as some other symbol. Its stem and flag
    // are hidden and its head is always filled: the rhythm is the page's to
    // state. The ledger lines stay, since without them a pitch well off the
    // staff cannot be read at all.
    const ghost = new StaveNote({
      keys: [midiToVexKey(written - 12 * shift, writtenKey)],
      duration: anchor.code,
      clef,
    });
    // Before anything measures it: swapping the glyph changes the width.
    const filled = FILLED_HEAD[anchor.code];
    if (filled) for (const head of ghost.noteHeads) head.setText(filled);

    const accidental = explicitAccidental(written, writtenKey);
    if (accidental) ghost.addModifier(new Accidental(accidental), 0);
    // The page's own colour, not a verdict one. A guide tinted like a scored
    // note would read as a judgement, and one tinted like the active note would
    // vanish into it at the moment it matters most — when the two agree and it
    // is sitting exactly on top.
    ghost.setStyle({ fillStyle: colour, strokeStyle: colour });
    // After the note's own style, which a StaveNote hands down to its stem.
    ghost.setStemStyle({ fillStyle: 'none', strokeStyle: 'none' });
    ghost.setFlagStyle({ fillStyle: 'none', strokeStyle: 'none' });

    // Its own tick context, positioned at the played note's: the two staves of a
    // grand staff start their notes at slightly different x, so sharing the tick
    // position lands the guide under the note even when the heard pitch belongs
    // to the other hand.
    new TickContext().addTickable(ghost).preFormat().setX(anchor.tickX);
    ghost.setStave(stave);

    layer.replaceChildren();
    const renderer = new Renderer(layer, Renderer.Backends.SVG);
    renderer.resize(plan.width, plan.height);
    fitToContainer(layer, plan.width, plan.height);
    const context = renderer.getContext();
    context.openGroup('heard-note');
    // setStave took the score's context; this layer has its own.
    ghost.setContext(context).draw();
    context.closeGroup();
    followPageColour(layer);

    const to = { x: ghost.getAbsoluteX(), y: ghost.getYs()[0] };
    const from = guideAtRef.current;
    guideAtRef.current = to;

    // Slide from wherever it already was, rather than reappearing somewhere
    // else: the layer is drawn at the destination, offset back to where the eye
    // last had it, and then let go of. A pitch that has only just arrived has
    // nowhere to travel from and simply fades in.
    const dx = from === null ? 0 : (from.x - to.x) * plan.scale;
    const dy = from === null ? 0 : (from.y - to.y) * plan.scale;
    const travels = Math.abs(dx) <= GUIDE_JUMP_PX && Math.abs(dy) <= GUIDE_JUMP_PX;
    layer.classList.toggle('is-still', !travels || (dx === 0 && dy === 0));
    if (travels && (dx !== 0 || dy !== 0)) {
      layer.style.transform = `translate(${dx}px, ${dy}px)`;
      // Read a laid-out value so the offset is a state to leave, not one the
      // browser folds into the same frame as the line below.
      void layer.offsetHeight;
    }
    layer.style.transform = '';
    layer.classList.add('is-shown');
  }, [heardMidi, engraving, instrument]);

  return (
    <div ref={hostRef} className="score" aria-label="Notated exercise">
      <div ref={staffRef} />
      <div ref={guideRef} className="guide-note" aria-hidden />
    </div>
  );
}
