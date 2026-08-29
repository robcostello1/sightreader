import { OPEN_POSITION, regionPool } from './config/regions';
import { midiToName } from './lib/pitch';
import { TIERS } from './config/tiers';

export default function App() {
  const pool = regionPool(OPEN_POSITION);

  return (
    <main>
      <h1>Sightreader</h1>
      <p>Guitar sight-reading trainer. Scaffold only — no lesson loop yet.</p>

      <section>
        <h2>Region: {OPEN_POSITION.name}</h2>
        <p>
          {pool.length} pitches, {midiToName(pool[0])}–{midiToName(pool[pool.length - 1])}
        </p>
      </section>

      <section>
        <h2>Tiers</h2>
        <ul>
          {Object.values(TIERS).map((tier) => (
            <li key={tier.id}>
              <strong>{tier.name}</strong> — {tier.bars} bar(s), {tier.density.id} density,{' '}
              {tier.idioms.id} idioms, click{' '}
              {tier.clickThroughExercise ? 'throughout' : 'count-in only'}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
