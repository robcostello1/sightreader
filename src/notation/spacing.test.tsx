// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { it, expect } from 'vitest';
import { Score } from './Score';
import { generateExercise } from '../generator';
import { levelConfig } from '../config/levels';
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
