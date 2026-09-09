// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { it, expect } from 'vitest';
import { Score } from './Score';
import { generateExercise } from '../generator';
import { levelConfig } from '../config/levels';
import { NOTE_VALUES, type Exercise } from '../lib/types';
import { keyByName } from '../lib/key';
import { instrumentById, positionById, soundingPool } from '../config/instruments';

/** SMuFL augmentation dot, which VexFlow draws inside the notehead group. */
const AUGMENTATION_DOT = '\ue1e7';

/**
 * How far apart vertically two glyphs must be before they cannot collide
 * whatever their x. Rather less than the gap between the hands, and rather
 * more than a notehead is tall.
 */
const CLEAR_ABOVE = 40;

/**
 * Smallest horizontal gap between two glyphs close enough to collide.
 *
 * Which staff a note is on is not asked: two glyphs overlap when they are near
 * in both directions, so the pairs far enough apart vertically — the two hands,
 * a bar rest against the other staff's run — are simply not compared. A dot is
 * part of the note before it rather than a glyph in its own right, so it is
 * dropped before anything is measured.
 */
function tightest(container: HTMLElement) {
  const heads = [...container.querySelectorAll('.vf-notehead text')]
    .filter((head) => !(head.textContent ?? '').startsWith(AUGMENTATION_DOT))
    .map((head) => ({ x: Number(head.getAttribute('x')), y: Number(head.getAttribute('y')) }))
    .filter((head) => !Number.isNaN(head.x) && !Number.isNaN(head.y));

  let worst = Infinity;
  for (let i = 0; i < heads.length; i++) {
    for (let j = i + 1; j < heads.length; j++) {
      if (Math.abs(heads[i].y - heads[j].y) > CLEAR_ABOVE) continue;
      worst = Math.min(worst, Math.abs(heads[i].x - heads[j].x));
    }
  }
  return worst;
}

/**
 * Closest two noteheads of one voice may sit before they collide. A notehead is
 * about ten units wide, so anything under this is ink on ink; squeezed below
 * what the formatter asks for, the old code drew 5.1 on a 288px column.
 */
const COLLISION = 6.5;

const simple: Exercise = {
  notes: [],
  keyCenter: 60,
  key: keyByName('C'),
  timeSignature: [4, 4],
  bpm: 60,
};

it('never squeezes a bar past the point its notes collide', () => {
  const piano = instrumentById('piano');
  const position = positionById(piano, 'grand-wide');
  const pool = soundingPool(piano, position!);

  for (const width of [288, 343, 420]) {
    for (let seed = 1; seed <= 30; seed++) {
      const exercise = generateExercise({ level: levelConfig(10), pool, bpm: 80, seed });
      const { container, unmount } = render(
        <Score exercise={exercise} instrument={piano} position={position} width={width} />,
      );
      const gap = tightest(container);
      unmount();
      if (Number.isFinite(gap)) {
        expect(gap, `seed ${seed} at ${width}px`).toBeGreaterThanOrEqual(COLLISION);
      }
    }
  }
});

/** Average gap between consecutive noteheads of one voice, per bar. */
function spacingPerBar(container: HTMLElement, counts: readonly number[]): number[] {
  const xs = [...container.querySelectorAll('.vf-notehead text')].map((head) =>
    Number(head.getAttribute('x')),
  );
  const spacings: number[] = [];
  let at = 0;
  for (const count of counts) {
    const bar = xs.slice(at, at + count);
    at += count;
    const gaps = bar.slice(1).map((x, i) => x - bar[i]);
    spacings.push(gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length));
  }
  return spacings;
}

it('gives a long note at least as much room as a short one', () => {
  // Three crotchets, then eight quavers. Sharing the spare width by note count
  // gave the busy bar more than twice the extra, so its quavers ended up
  // further apart than the crotchets — which reads as though the long notes
  // were the quick ones.
  const exercise: Exercise = {
    ...simple,
    notes: [
      ...Array.from({ length: 3 }, () => ({
        midi: 67,
        value: NOTE_VALUES.quarter,
        idiomId: 't',
        instance: 0,
      })),
      { midi: 67, value: NOTE_VALUES.quarter, idiomId: 't', instance: 0 },
      ...Array.from({ length: 8 }, () => ({
        midi: 67,
        value: NOTE_VALUES.eighth,
        idiomId: 't',
        instance: 1,
      })),
    ],
  };
  // Narrow enough that the leftover width is what decides, rather than both
  // bars reaching the ceiling on their own.
  const { container } = render(<Score exercise={exercise} width={700} />);
  const [crotchets, quavers] = spacingPerBar(container, [4, 8]);
  // Not merely wider: clearly wider. Sharing by note count left them at 54
  // against 48, which is near enough equal to read as a mistake.
  expect(crotchets / quavers).toBeGreaterThan(1.3);
});

/**
 * Topmost ink in the drawing, in SVG units. Zero is the top edge; anything
 * negative has been drawn off the page and is invisible.
 */
function highestInk(container: HTMLElement): number {
  let top = Infinity;
  for (const shape of container.querySelectorAll('rect, line, path, text')) {
    for (const attribute of ['y', 'y1', 'y2']) {
      const value = shape.getAttribute(attribute);
      if (value === null) continue;
      const y = Number(value);
      if (Number.isFinite(y)) top = Math.min(top, y);
    }
  }
  return top;
}

/**
 * How far a tuplet's number rises above its bracket. VexFlow centres the digit
 * on the bracket line, and jsdom measures no text, so the number's own position
 * never reaches the DOM — this is the room the bracket must leave for it.
 */
const TUPLET_NUMBER_RISE = 8;

it('leaves room above the staff for a triplet over the highest note', () => {
  const piano = instrumentById('piano');
  const position = positionById(piano, 'grand-wide');
  // C6: the top of the written range, above which the music is written an
  // octave down under an 8va sign and stops climbing.
  const triplet = (midi: number) => ({
    midi,
    value: NOTE_VALUES.quarter * (2 / 3),
    idiomId: 't',
    instance: 0,
    tuplet: { group: 0, num: 3, inSpaceOf: 2 },
  });
  const exercise: Exercise = {
    ...simple,
    notes: [
      triplet(84),
      triplet(82),
      triplet(81),
      { midi: 79, value: NOTE_VALUES.quarter, idiomId: 't', instance: 1 },
      { midi: 77, value: NOTE_VALUES.quarter, idiomId: 't', instance: 1 },
    ],
  };
  const { container } = render(
    <Score exercise={exercise} instrument={piano} position={position} />,
  );
  expect(highestInk(container)).toBeGreaterThanOrEqual(TUPLET_NUMBER_RISE);
});
