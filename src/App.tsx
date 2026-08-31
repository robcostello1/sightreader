import { useState } from 'react';
import { Lesson } from './ui/Lesson';
import { Troubleshooting } from './ui/Troubleshooting';

export default function App() {
  const [helping, setHelping] = useState(false);

  return (
    <main>
      {/* One link, so it needs no menu to fold into at any width. */}
      <header>
        <h1>Sightreader</h1>
        <nav>
          <button type="button" className="link" onClick={() => setHelping(true)}>
            Troubleshooting
          </button>
        </nav>
      </header>

      <Troubleshooting open={helping} onOpenChange={setHelping} />

      <Lesson />
    </main>
  );
}
