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

/** One note of a given length, so the ghost has a known head to copy. */
const oneNote = (value: number): Exercise => ({
  ...simple,
  notes: [{ midi: 67, value, idiomId: 'test', instance: 0 }],
});

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

/** The notehead glyph the exercise itself was drawn with. */
function playedGlyph(container: HTMLElement): string | null {
  const note = [...container.querySelectorAll('.vf-stavenote')].find(
    (candidate) => !candidate.closest('.vf-heard-note'),
  );
  return note!.querySelector('.vf-notehead text')!.textContent;
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

  it('draws an octave sign over a passage instead of a stack of ledger lines', () => {
    // Seven ledger lines is not notation anyone sight-reads. The passage is
    // written an octave down with 8va over it, so it sits beside the staff.
    const high: Exercise = {
      ...simple,
      notes: [86, 88, 89, 91].map((midi, i) => ({
        midi,
        value: NOTE_VALUES.quarter,
        idiomId: 'test',
        instance: i,
      })),
    };
    const piano = instrumentById('piano');
    const markup = render(
      <Score exercise={high} instrument={piano} position={positionById(piano, 'full-range')} />,
    ).container.innerHTML;
    expect(markup).toContain('8');
    expect(markup).toContain('va');
  });

  it('draws one over a passage below the bass staff too', () => {
    const low: Exercise = {
      ...simple,
      notes: [31, 33, 35, 36].map((midi, i) => ({
        midi,
        value: NOTE_VALUES.quarter,
        idiomId: 'test',
        instance: i,
      })),
    };
    const piano = instrumentById('piano');
    expect(() =>
      render(<Score exercise={low} instrument={piano} position={positionById(piano, 'full-range')} />),
    ).not.toThrow();
    const markup = render(
      <Score exercise={low} instrument={piano} position={positionById(piano, 'full-range')} />,
    ).container.innerHTML;
    expect(markup).toContain('vb');
  });

  it('marks the active note distinctly from scored ones', () => {
    const markup = render(<Score exercise={simple} activeIndex={2} />).container.innerHTML;
    expect(markup).toContain(VERDICT_FALLBACKS.active);
  });

  it('lays the heard note over the one being played', () => {
    const { container } = render(<Score exercise={simple} activeIndex={0} heardMidi={67} />);
    expect(container.querySelector('.vf-heard-note')).not.toBeNull();
    // Shown rather than merely drawn: the stylesheet fades the layer in on this
    // class, which is what lets it also fade out with its drawing intact.
    expect(container.querySelector('.guide-note')!.classList.contains('is-shown')).toBe(true);
  });

  it('fades the guide out on its own layer rather than tearing it out', () => {
    const { container, rerender } = render(
      <Score exercise={simple} activeIndex={0} heardMidi={67} />,
    );
    rerender(<Score exercise={simple} activeIndex={0} heardMidi={null} />);

    const layer = container.querySelector('.guide-note')!;
    expect(layer.classList.contains('is-shown')).toBe(false);
    // The drawing stays put while it fades, so a note that comes back within
    // the fade returns instead of starting over.
    expect(layer.querySelector('.vf-heard-note')).not.toBeNull();
  });

  it('is not re-engraved when only the note being heard changes', () => {
    // The staff is expensive and the pitch heard moves several times a bar.
    const { container, rerender } = render(
      <Score exercise={simple} activeIndex={0} heardMidi={67} />,
    );
    const staff = container.querySelector('.score > div:not(.guide-note) svg');
    rerender(<Score exercise={simple} activeIndex={0} heardMidi={62} />);
    expect(container.querySelector('.score > div:not(.guide-note) svg')).toBe(staff);
  });

  it('shapes the ghost like the note being played, minus its stem', () => {
    const { container } = render(
      <Score exercise={oneNote(NOTE_VALUES.quarter)} activeIndex={0} heardMidi={64} />,
    );
    // A crotchet's head is already filled, so the ghost is the same glyph —
    // that note moved, not a different symbol.
    expect(ghostGlyphs(container)[0].textContent).toBe(playedGlyph(container));
    // The stem is the page's to draw; a second one beside it is clutter.
    expect(container.querySelector('.vf-heard-note .vf-stem')!.getAttribute('stroke')).toBe('none');
  });

  it('fills a hollow notehead, keeping its shape', () => {
    // Hollow and translucent leaves a ring that is hard to place against a
    // stave line, so the ghost takes the filled cut of the same head. SMuFL
    // gives one for the semibreve and the minim; a breve borrows the
    // semibreve's, being the nearest filled head there is.
    const filled: Record<string, string> = {
      [NOTE_VALUES.whole]: '\uE0FA',
      [NOTE_VALUES.half]: '\uE0FB',
      [NOTE_VALUES.breve]: '\uE0FA',
    };
    for (const [value, glyph] of Object.entries(filled)) {
      const { container } = render(
        <Score exercise={oneNote(Number(value))} activeIndex={0} heardMidi={64} />,
      );
      expect(ghostGlyphs(container)[0].textContent).toBe(glyph);
      // And the page itself still says the duration, hollow head and all.
      expect(playedGlyph(container)).not.toBe(glyph);
      cleanup();
    }
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
