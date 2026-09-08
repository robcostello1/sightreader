// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { it, expect } from 'vitest';
import { Score } from './Score';
import { generateExercise } from '../generator';
import { levelConfig } from '../config/levels';
import { instrumentById, positionById, soundingPool } from '../config/instruments';

/**
 * Smallest gap between consecutive noteheads of one voice, in SVG units.
 *
 * Voices are drawn one after another, so x running backwards marks the start of
 * the next one — which is how the two hands of a grand staff are told apart
 * without knowing where either staff sits.
 */
function tightest(container: HTMLElement) {
  let worst = Infinity;
  let previous = -Infinity;
  for (const head of container.querySelectorAll('.vf-notehead text')) {
    const x = Number(head.getAttribute('x'));
    if (Number.isNaN(x)) continue;
    if (x > previous) worst = Math.min(worst, x - previous);
    previous = x;
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
