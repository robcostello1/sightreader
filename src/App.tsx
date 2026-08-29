import { OPEN_POSITION, regionPool } from './config/regions';
import { midiToName } from './lib/pitch';
import { Lesson } from './ui/Lesson';

export default function App() {
  const pool = regionPool(OPEN_POSITION);

  return (
    <main>
      <header>
        <h1>Sightreader</h1>
        <p className="muted">
          {OPEN_POSITION.name} · {pool.length} pitches,{' '}
          {midiToName(pool[0])}–{midiToName(pool[pool.length - 1])}
        </p>
      </header>

      <Lesson />
    </main>
  );
}
