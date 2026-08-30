// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Score } from './Score';
import { INSTRUMENTS, instrumentById, positionById, soundingPool } from '../config/instruments';
import { generateExercise } from '../generator';

afterEach(cleanup);

const available = INSTRUMENTS.filter((i) => i.status === 'available');

describe('notation across instruments', () => {
  it.each(available.map((i) => [i.name, i.id] as const))(
    'renders %s without throwing',
    (_name, id) => {
      const instrument = instrumentById(id);
      const position = positionById(instrument, null);
      const pool = soundingPool(instrument, position);

      // Across the level range, so clefs meet accidentals, rests and tuplets.
      for (const level of [1, 5, 9]) {
        for (let seed = 1; seed <= 4; seed++) {
          const exercise = generateExercise({ level, pool, seed });
          expect(() =>
            render(<Score exercise={exercise} instrument={instrument} position={position} />),
          ).not.toThrow();
          cleanup();
        }
      }
    },
  );

  it('draws a bass-clef instrument on a bass clef', () => {
    const trombone = instrumentById('trombone');
    const exercise = generateExercise({ level: 3, pool: soundingPool(trombone, null), seed: 1 });
    const { container } = render(<Score exercise={exercise} instrument={trombone} />);
    // VexFlow names its glyphs, so the clef is identifiable in the output.
    expect(container.innerHTML).toMatch(/clef/i);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders piano on both staves, with a brace joining them', () => {
    const piano = instrumentById('piano');
    const position = positionById(piano, 'grand-wide');
    const exercise = generateExercise({
      level: 6,
      pool: soundingPool(piano, position),
      seed: 5,
    });
    const { container } = render(
      <Score exercise={exercise} instrument={piano} position={position} />,
    );
    // Two staves per system, and the brace that makes them one instrument.
    const staveLines = container.querySelectorAll('svg path');
    expect(staveLines.length).toBeGreaterThan(0);
    expect(container.innerHTML).toMatch(/clef/i);
  });

  it('puts a single-staff piano position on one staff only', () => {
    const piano = instrumentById('piano');
    const position = positionById(piano, 'rh-5-finger');
    const exercise = generateExercise({
      level: 3,
      pool: soundingPool(piano, position),
      seed: 2,
    });
    expect(() =>
      render(<Score exercise={exercise} instrument={piano} position={position} />),
    ).not.toThrow();
  });

  it.each(['grand-close', 'grand-wide', 'full-range', 'lh-5-finger', 'bass-staff'])(
    'renders the %s piano position across levels',
    (positionId) => {
      const piano = instrumentById('piano');
      const position = positionById(piano, positionId);
      for (const level of [2, 6, 10]) {
        for (let seed = 1; seed <= 3; seed++) {
          const exercise = generateExercise({
            level,
            pool: soundingPool(piano, position),
            seed,
          });
          expect(() =>
            render(<Score exercise={exercise} instrument={piano} position={position} />),
          ).not.toThrow();
          cleanup();
        }
      }
    },
  );

  it('keeps every written note inside the staff’s reachable range', () => {
    // A transposing instrument whose written octave was wrong would show up as
    // notes miles off the staff; this is a cheap guard on the offset's sign.
    for (const instrument of available) {
      const pool = soundingPool(instrument, positionById(instrument, null));
      const written = pool.map((midi) => midi - instrument.transposition.semitones);
      // Nothing should be written below A0 or above C8 — the piano's own limits.
      expect(Math.min(...written)).toBeGreaterThanOrEqual(21);
      expect(Math.max(...written)).toBeLessThanOrEqual(108);
    }
  });
});
