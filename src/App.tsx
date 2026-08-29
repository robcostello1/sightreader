import { Lesson } from './ui/Lesson';

export default function App() {
  return (
    <main>
      <header>
        <h1>Sightreader</h1>
        <p className="muted">Guitar sight-reading trainer</p>
      </header>

      <Lesson />
    </main>
  );
}
