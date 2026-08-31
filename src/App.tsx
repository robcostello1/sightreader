import { useState } from 'react';
import { Lesson } from './ui/Lesson';

export default function App() {
  // The link is in the header and the dialog is rendered by the lesson, which
  // is where the instrument is known — some of the advice only applies to some
  // of them. So the header asks, and the lesson answers.
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

      <Lesson troubleshooting={helping} onTroubleshooting={setHelping} />
    </main>
  );
}
