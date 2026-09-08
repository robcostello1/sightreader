import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Score } from './notation';
import { excerptToExercise, type Excerpt, type Line } from './content/excerpts';
import { instrumentById, positionById } from './config/instruments';
import { applyTheme } from './lib/theme';
import { Heading, Text } from './ui/Text';
import './index.css';

const requested = new URLSearchParams(location.search).get('theme');
if (requested === 'light' || requested === 'dark') applyTheme(requested);

/** What a human decided about an excerpt, which outranks the classifier. */
type Verdict = Line | 'reject';

const STORE = 'sightreader.excerptVerdicts';

/**
 * Dev-only page for assigning excerpts to a line by eye.
 *
 * The importer's guess is a starting point: it knows which staff a line came
 * from and whether a voice crossed between them, and nothing about which line
 * is the tune. Served at /review.html in dev, against an excerpts.json the
 * importer wrote into public/ — see docs/excerpt-import.md. Neither that file
 * nor anything it holds belongs in the repository.
 */
// eslint-disable-next-line react/only-export-components -- dev-only entry point
function Review() {
  const [excerpts, setExcerpts] = useState<Excerpt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? '{}');
    } catch {
      return {};
    }
  });
  const [onlyUsable, setOnlyUsable] = useState(true);
  const [undecided, setUndecided] = useState(false);

  useEffect(() => {
    fetch('/excerpts.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data) => setExcerpts(data.excerpts))
      .catch(() => setError('No /excerpts.json. Run npm run import-scores and put it in public/.'));
  }, []);

  useEffect(() => localStorage.setItem(STORE, JSON.stringify(verdicts)), [verdicts]);

  const key = (excerpt: Excerpt) =>
    `${excerpt.source}:${excerpt.firstMeasure}:${excerpt.line}:${excerpt.notes.length}`;

  const shown = useMemo(() => {
    if (!excerpts) return [];
    return excerpts
      .filter((excerpt) => !onlyUsable || (excerpt.notatable && excerpt.confidence >= 0.9))
      .filter((excerpt) => !undecided || verdicts[key(excerpt)] === undefined)
      .slice(0, 60);
  }, [excerpts, onlyUsable, undecided, verdicts]);

  const piano = instrumentById('piano');
  const position = positionById(piano, 'grand-wide');

  return (
    <main>
      <Heading level={1} className="preview-title">Excerpt review</Heading>
      {error && <Text tone="warning">{error}</Text>}
      {excerpts && (
        <Text tone="muted">
          {excerpts.length} excerpts, {Object.keys(verdicts).length} decided. Showing{' '}
          {shown.length}.
        </Text>
      )}

      <div className="check-actions">
        <label className="toggle">
          <input
            type="checkbox"
            checked={onlyUsable}
            onChange={(event) => setOnlyUsable(event.target.checked)}
          />
          Drawable and confident only
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={undecided}
            onChange={(event) => setUndecided(event.target.checked)}
          />
          Undecided only
        </label>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(JSON.stringify(verdicts, null, 2))}
        >
          Copy decisions
        </button>
      </div>

      {shown.map((excerpt) => {
        const id = key(excerpt);
        const verdict = verdicts[id];
        return (
          <section key={id}>
            <Text tone="muted">
              <strong>{excerpt.source}</strong> · bar {excerpt.firstMeasure} · guessed{' '}
              {excerpt.line} ({Math.round(excerpt.confidence * 100)}%)
              {excerpt.notesDropped > 0 && ` · ${excerpt.notesDropped} notes dropped`}
              {excerpt.spansStaves && ' · spans both staves'}
              {!excerpt.notatable && ' · not drawable'}
            </Text>
            <Score
              exercise={excerptToExercise(excerpt)}
              instrument={piano}
              position={position}
            />
            <div className="check-actions">
              {(['lead', 'bass', 'mixed', 'reject'] as Verdict[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={verdict === option ? 'control is-live' : undefined}
                  onClick={() => setVerdicts({ ...verdicts, [id]: option })}
                >
                  {option}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Review />
  </StrictMode>,
);
