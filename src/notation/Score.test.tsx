// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Score } from './Score';
import { VERDICT_FALLBACKS } from './colours';
import { generateExercise } from '../generator';
import { NOTE_VALUES } from '../lib/types';
import { keyByName } from '../lib/key';
import { instrumentById, positionById } from '../config/instruments';
import type { Exercise, NoteResult } from '../lib/types';

afterEach(cleanup);

const simple: Exercise = {
  notes: [
    { midi: 60, value: NOTE_VALUES.quarter, idiomId: 'test', instance: 0 },
    { midi: 62, value: NOTE_VALUES.quarter, idiomId: 'test', instance: 0 },
    { midi: null, value: NOTE_VALUES.quarter, idiomId: 'test', instance: 0 },
    { midi: 64, value: NOTE_VALUES.quarter, idiomId: 'test', instance: 0 },
  ],
  keyCenter: 60,
  key: keyByName('C'),
  timeSignature: [4, 4],
  bpm: 60,
};

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg rendered');
  return svg;
}

/** Every notehead VexFlow drew for the exercise itself, in order. */
function playedHeads(container: HTMLElement): { x: number; y: number }[] {
  return [...container.querySelectorAll('.vf-stavenote')]
    .filter((note) => !note.closest('.vf-heard-note'))
    .flatMap((note) => [...note.querySelectorAll('.vf-notehead text')])
    .map((glyph) => ({
      x: Number(glyph.getAttribute('x')),
      y: Number(glyph.getAttribute('y')),
    }));
}

/** The glyphs of the heard-note ghost: its head, plus any accidental. */
function ghostGlyphs(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('.vf-heard-note .vf-notehead text')];
}

function ghostHead(container: HTMLElement): { x: number; y: number } {
  const glyphs = ghostGlyphs(container);
  if (glyphs.length === 0) throw new Error('no ghost drawn');
  // The head is drawn first; an accidental is placed to its left afterwards.
  return { x: Number(glyphs[0].getAttribute('x')), y: Number(glyphs[0].getAttribute('y')) };
}

describe('Score', () => {
  it('draws a stave with notes', () => {
    const { container } = render(<Score exercise={simple} />);
    const svg = svgOf(container);
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('renders every level without throwing', () => {
    // The real value of this test: VexFlow misuse surfaces here rather than in
    // a browser. Covers accidentals, rests, dotted values, tuplets and ties.
    // Across all ten levels: accidentals, rests, dotted values, tuplets, ties,
    // and every key signature the ramp admits.
    for (let level = 1; level <= 10; level++) {
      for (let seed = 1; seed <= 12; seed++) {
        const exercise = generateExercise({ level, seed });
        expect(() => render(<Score exercise={exercise} />)).not.toThrow();
        cleanup();
      }
    }
  });

  it('renders level 1, whose notes are whole notes and breves', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const exercise = generateExercise({ level: 1, seed });
      expect(() => render(<Score exercise={exercise} />)).not.toThrow();
      cleanup();
    }
  });

  it('draws nothing in a hardcoded colour, so both themes work', () => {
    // VexFlow defaults to black glyphs and #444 stave lines, which disappear on
    // a dark background. Everything must defer to the page's text colour.
    const markup = render(<Score exercise={simple} />).container.innerHTML;
    expect(markup).not.toMatch(/(fill|stroke)="black"/);
    expect(markup).not.toMatch(/(fill|stroke)="#444"/);
    expect(markup).toContain('currentColor');
  });

  it('renders guitar pitch an octave above where it sounds', () => {
    const lowE: Exercise = {
      ...simple,
      notes: [{ midi: 40, value: NOTE_VALUES.whole, idiomId: 't', instance: 0 }],
    };
    const { container } = render(<Score exercise={lowE} />);
    // Written E3 sits three ledger lines below the treble staff; sounding E2
    // would be an octave lower again and effectively unreadable.
    expect(container.querySelectorAll('svg').length).toBe(1);
    expect(() => render(<Score exercise={lowE} />)).not.toThrow();
  });

  it('colours scored notes by verdict', () => {
    const results: NoteResult[] = [
      { index: 0, passed: true, verdict: 'pass', occupancy: 1, sampleCount: 10 },
      { index: 1, passed: false, verdict: 'wrong-pitch', occupancy: 0, sampleCount: 10 },
      { index: 3, passed: false, verdict: 'unclear', occupancy: 0.3, sampleCount: 10 },
    ];
    const markup = render(<Score exercise={simple} results={results} />).container.innerHTML;
    // Resolved from CSS variables in the browser; these are the fallbacks used
    // where no stylesheet is loaded.
    expect(markup).toContain(VERDICT_FALLBACKS.pass);
    expect(markup).toContain(VERDICT_FALLBACKS.fail);
    expect(markup).toContain(VERDICT_FALLBACKS.unclear);
  });

  it('marks the active note distinctly from scored ones', () => {
    const markup = render(<Score exercise={simple} activeIndex={2} />).container.innerHTML;
    expect(markup).toContain(VERDICT_FALLBACKS.active);
  });

  it('lays the heard note over the one being played, faintly', () => {
    const { container } = render(<Score exercise={simple} activeIndex={0} heardMidi={67} />);
    const ghost = container.querySelector('.vf-heard-note');
    expect(ghost).not.toBeNull();
    // Faint, so the note the player is meant to be reading stays the clearer one.
    expect(Number(ghost!.getAttribute('opacity'))).toBeLessThan(1);
  });

  it('shapes the ghost like the note being played, minus its stem', () => {
    const minims: Exercise = {
      ...simple,
      notes: [{ midi: 67, value: NOTE_VALUES.half, idiomId: 't', instance: 0 }],
    };
    const { container } = render(<Score exercise={minims} activeIndex={0} heardMidi={64} />);
    const ghost = container.querySelector('.vf-heard-note')!;

    // The same notehead glyph, so a minim's open head stays an open head — the
    // ghost reads as that note moved, not as a different symbol.
    expect(ghostGlyphs(container)[0].textContent).toBe(
      container.querySelector('.vf-stavenote:not(.vf-heard-note *) .vf-notehead text')!.textContent,
    );
    // The stem is the page's to draw; a second one beside it is clutter.
    expect(ghost.querySelector('.vf-stem')!.getAttribute('stroke')).toBe('none');
  });

  it('gives the ghost no verdict colour, so it cannot read as a score', () => {
    const ghost = render(<Score exercise={simple} activeIndex={0} heardMidi={67} />)
      .container.querySelector('.vf-heard-note')!.innerHTML;
    for (const colour of Object.values(VERDICT_FALLBACKS)) expect(ghost).not.toContain(colour);
  });

  it('draws no ghost with nothing heard, and none with nothing being played', () => {
    expect(render(<Score exercise={simple} heardMidi={67} />).container.querySelector('.vf-heard-note')).toBeNull();
    cleanup();
    expect(render(<Score exercise={simple} activeIndex={0} />).container.querySelector('.vf-heard-note')).toBeNull();
  });

  it('sits at the note being played, not at the start of the bar', () => {
    for (const index of [0, 1, 3]) {
      const { container } = render(
        <Score exercise={simple} activeIndex={index} heardMidi={67} width={720} />,
      );
      // The ghost is drawn outside every voice, so its agreeing with the played
      // note's x is the whole of what pins it there.
      expect(ghostHead(container).x).toBeCloseTo(playedHeads(container)[index].x, 1);
      cleanup();
    }
  });

  it('places the ghost by the pitch heard, not the pitch written', () => {
    const high = render(<Score exercise={simple} activeIndex={0} heardMidi={79} />).container;
    const highY = ghostHead(high).y;
    cleanup();
    const low = render(<Score exercise={simple} activeIndex={0} heardMidi={55} />).container;
    // Lower pitch, further down the staff — SVG y grows downwards.
    expect(ghostHead(low).y).toBeGreaterThan(highY);
  });

  it('crosses to the other staff of a grand staff when the heard pitch lives there', () => {
    const piano = instrumentById('piano');
    const wide = positionById(piano, 'grand-wide');
    const score = (heardMidi: number) => (
      <Score
        exercise={simple}
        instrument={piano}
        position={wide}
        activeIndex={0}
        heardMidi={heardMidi}
      />
    );

    // The note being played is C4, written in the right hand. A heard G4 is the
    // right hand's too; a heard E2 belongs to the left, and is drawn there
    // rather than five ledger lines under the treble staff.
    const treble = ghostHead(render(score(67)).container).y;
    cleanup();
    const bass = ghostHead(render(score(40)).container).y;
    // Comfortably past the treble staff's own depth: another staff down.
    expect(bass).toBeGreaterThan(treble + 100);
  });

  it('gives the ghost the accidental the key signature does not', () => {
    const inG: Exercise = { ...simple, key: keyByName('G') };
    // F sharp is in the signature and needs no sign of its own.
    const sharp = render(<Score exercise={inG} activeIndex={0} heardMidi={66} />).container;
    expect(ghostGlyphs(sharp)).toHaveLength(1);
    cleanup();

    // The F a semitone below is written E sharp in a sharp key, and the E line
    // carries no sharp in the signature — so it brings its own.
    const chromatic = render(<Score exercise={inG} activeIndex={0} heardMidi={65} />).container;
    expect(ghostGlyphs(chromatic)).toHaveLength(2);
  });

  it('redraws rather than appending when the exercise changes', () => {
    const { container, rerender } = render(<Score exercise={simple} />);
    rerender(<Score exercise={generateExercise({ level: 6, seed: 5 })} />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});
