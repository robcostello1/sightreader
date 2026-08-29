import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Score } from './notation';
import { generateExercise } from './generator';
import { levelConfig, levelSummary } from './config/levels';
import { POSITIONS } from './config/regions';
import './index.css';

/**
 * Dev-only page for eyeballing notation across tiers and seeds without playing
 * through a lesson. Served at /preview.html in dev; not part of the build.
 */
// Whole levels plus the fade across level 3, to show new ideas arriving.
// Whole levels, the fade across level 3, and seeds that previously laid out
// badly — dense bars and triplets near a bar line.
const SAMPLES = [
  ...Array.from({ length: 10 }, (_, i) => ({ level: i + 1, seed: 42 })),
  ...[3.0, 3.3, 3.6, 3.9].map((level) => ({ level, seed: 8 })),
  { level: 5, seed: 36 },
  { level: 5.5, seed: 11 },
  { level: 10, seed: 7 },
];

// eslint-disable-next-line react/only-export-components -- dev-only entry point
function Preview() {
  return (
    <main>
      <h1>Notation preview</h1>
      {SAMPLES.map(({ level, seed }) => {
        const config = levelConfig(level);
        const exercise = generateExercise({ level: config, region: POSITIONS[0], seed });
        return (
          <section key={`${level}`}>
            <p className="muted">
              <strong>Level {level.toFixed(1)}</strong> · {exercise.key.name} major ·{' '}
              {exercise.notes.length} notes
            </p>
            <p className="muted">{levelSummary(config).join(' · ')}</p>
            <Score exercise={exercise} />
          </section>
        );
      })}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
