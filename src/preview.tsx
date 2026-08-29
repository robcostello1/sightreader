import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Score } from './notation';
import { generateExercise } from './generator';
import { TIERS, type TierId } from './config/tiers';
import './index.css';

/**
 * Dev-only page for eyeballing notation across tiers and seeds without playing
 * through a lesson. Served at /preview.html in dev; not part of the build.
 */
const SAMPLES: { tier: TierId; seed: number }[] = [
  { tier: 'simple', seed: 222685567 },
  { tier: 'simple', seed: 7 },
  { tier: 'medium', seed: 42 },
  { tier: 'medium', seed: 3 },
  { tier: 'medium', seed: 11 },
];

// eslint-disable-next-line react/only-export-components -- dev-only entry point
function Preview() {
  return (
    <main>
      <h1>Notation preview</h1>
      {SAMPLES.map(({ tier, seed }) => {
        const exercise = generateExercise({ tier: TIERS[tier], seed });
        return (
          <section key={`${tier}-${seed}`}>
            <p className="muted">
              {TIERS[tier].name} · seed {seed} · {exercise.notes.length} notes
            </p>
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
