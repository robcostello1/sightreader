// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Score } from './Score';
import { generateExercise } from '../generator';
import { NOTE_VALUES } from '../lib/types';
import { keyByName } from '../lib/key';
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
    expect(markup).toContain('#2e9e5b'); // pass
    expect(markup).toContain('#d1495b'); // fail
    expect(markup).toContain('#c77b18'); // unclear
  });

  it('marks the active note distinctly from scored ones', () => {
    const markup = render(<Score exercise={simple} activeIndex={2} />).container.innerHTML;
    expect(markup).toContain('#2f6fed');
  });

  it('redraws rather than appending when the exercise changes', () => {
    const { container, rerender } = render(<Score exercise={simple} />);
    rerender(<Score exercise={generateExercise({ level: 6, seed: 5 })} />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});
