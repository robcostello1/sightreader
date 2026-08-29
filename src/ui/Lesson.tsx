import { Suspense, lazy, useEffect, useState } from 'react';

// VexFlow is the bulk of the bundle and nothing is notated until a lesson
// starts, so it loads out of band. The effect below warms it during the idle
// screen, well before the count-in ends.
const Score = lazy(() => import('../notation').then((m) => ({ default: m.Score })));
import { MAX_LEVEL, clampLevel, levelConfig, levelSummary } from '../config/levels';
import { loadSetting, saveSetting } from '../lib/storage';
import { POSITIONS, fretRangeLabel, regionById, regionPool } from '../config/regions';
import { midiToName } from '../lib/pitch';
import { centsFromTarget, nearestMidi } from '../lib/pitch';
import { useLesson } from './useLesson';
import type { NoteResult } from '../lib/types';

const VERDICT_LABELS: Record<NoteResult['verdict'], string> = {
  pass: 'correct',
  silence: 'nothing played',
  'wrong-pitch': 'wrong note',
  unclear: 'unclear — more than one string sounding',
  unscorable: 'too short to score at this tempo',
};

function LivePitch({ hz, confidence, gate }: { hz: number | null; confidence: number; gate: number }) {
  const confident = hz !== null && confidence >= gate;
  const midi = hz === null ? null : nearestMidi(hz);
  const cents = hz !== null && midi !== null ? centsFromTarget(hz, midi) : null;

  return (
    <div className={`readout ${confident ? 'is-confident' : ''}`}>
      <span className="note">{confident && midi !== null ? midiToName(midi) : '—'}</span>
      <span className="detail">
        {confident && hz !== null
          ? `${hz.toFixed(1)} Hz · ${cents! >= 0 ? '+' : ''}${cents!.toFixed(0)} cents`
          : 'listening…'}
      </span>
    </div>
  );
}

function Results({ results, summary }: { results: readonly NoteResult[]; summary: { passed: number; total: number; accuracy: number; unscorable: number } }) {
  const failures = results.filter((r) => !r.passed);
  return (
    <section>
      <h2>Results</h2>
      <p className="score-line">
        {summary.passed} of {summary.total - summary.unscorable} scorable notes correct —{' '}
        <strong>{Math.round(summary.accuracy * 100)}%</strong>
        {summary.unscorable > 0 && (
          <span className="muted"> ({summary.unscorable} too short to score)</span>
        )}
      </p>
      {failures.length > 0 && (
        <ul className="failures">
          {failures.map((result) => (
            <li key={result.index}>
              Note {result.index + 1}: {VERDICT_LABELS[result.verdict]}
              {result.verdict !== 'silence' && result.verdict !== 'unscorable' && (
                <span className="muted"> ({Math.round(result.occupancy * 100)}% on target)</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Stored settings are validated on read — see loadSetting. */
const readLevel = (value: unknown) => (typeof value === 'number' ? clampLevel(value) : null);
const readRegionId = (value: unknown) =>
  typeof value === 'string' && POSITIONS.some((p) => p.id === value) ? value : null;
const readFlag = (value: unknown) => (typeof value === 'boolean' ? value : null);

export function Lesson() {
  const [level, setLevel] = useState(() => loadSetting('level', readLevel, 1));
  const [regionId, setRegionId] = useState(() =>
    loadSetting('position', readRegionId, POSITIONS[0].id),
  );
  const [autoAdvance, setAutoAdvance] = useState(() =>
    loadSetting('autoAdvance', readFlag, true),
  );

  useEffect(() => saveSetting('level', level), [level]);
  useEffect(() => saveSetting('position', regionId), [regionId]);
  useEffect(() => saveSetting('autoAdvance', autoAdvance), [autoAdvance]);

  const region = regionById(regionId);
  const config = levelConfig(level);
  const pool = regionPool(region);
  const lesson = useLesson({ level, region, autoAdvance });
  const running = lesson.phase === 'count-in' || lesson.phase === 'playing';
  const listening = running || lesson.phase === 'results';

  useEffect(() => {
    void import('../notation');
  }, []);

  return (
    <>
      <section>
        <div className="controls">
          <label className="level-control">
            Level <strong>{level}</strong>
            <input
              type="range"
              min={1}
              max={MAX_LEVEL}
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              disabled={running}
            />
          </label>

          <label>
            Position{' '}
            <select
              value={regionId}
              onChange={(event) => setRegionId(event.target.value)}
              disabled={running}
            >
              {POSITIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({fretRangeLabel(option)})
                </option>
              ))}
            </select>
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(event) => setAutoAdvance(event.target.checked)}
            />
            Keep going
          </label>

          {lesson.phase === 'idle' && <button onClick={lesson.start}>Start</button>}
          {lesson.phase === 'arming' && <span className="muted">Requesting microphone…</span>}
          {listening && <button onClick={lesson.stop}>Stop</button>}
          {lesson.phase === 'results' && !autoAdvance && (
            <button onClick={lesson.start}>Next exercise</button>
          )}
          {lesson.phase === 'error' && (
            <>
              <span role="alert">Could not start: {lesson.error}</span>
              <button onClick={lesson.start}>Retry</button>
            </>
          )}
        </div>

        <p className="muted level-summary">{levelSummary(config).join(' · ')}</p>
        <p className="muted">
          {region.name} — {fretRangeLabel(region)} · {pool.length} pitches,{' '}
          {midiToName(pool[0])}–{midiToName(pool[pool.length - 1])}
        </p>

        {lesson.phase === 'count-in' && (
          <p className="count-in">
            Count-in… <strong>{lesson.beatsUntilStart}</strong>
          </p>
        )}
      </section>

      {lesson.exercise && (
        <section>
          <Suspense fallback={<p className="muted">Loading notation…</p>}>
            <Score
              exercise={lesson.exercise}
              results={lesson.results}
              activeIndex={lesson.activeIndex ?? undefined}
            />
          </Suspense>
          <p className="muted">
            Level {config.level} · {region.name} ({fretRangeLabel(region)}) ·{' '}
            {lesson.exercise.key.name} major · {lesson.exercise.bpm} bpm · seed {lesson.seed}
          </p>
        </section>
      )}

      {running && (
        <section>
          <LivePitch
            hz={lesson.livePitch?.hz ?? null}
            confidence={lesson.livePitch?.confidence ?? 0}
            gate={config.scoring.confidenceGate}
          />
          <p className="muted">Attacks detected: {lesson.onsetCount}</p>
          {lesson.falseStart && (
            <p role="alert" className="muted">
              False start — you played during the count-in. That note was not scored.
            </p>
          )}
        </section>
      )}

      {lesson.phase === 'results' && lesson.summary && (
        <>
          <Results results={lesson.results} summary={lesson.summary} />
          {autoAdvance && <p className="muted">Next exercise starting…</p>}
        </>
      )}

      {lesson.stats.completed > 0 && (
        <section>
          <h2>This session</h2>
          <p className="muted">
            {lesson.stats.completed} exercise{lesson.stats.completed === 1 ? '' : 's'} ·{' '}
            {lesson.stats.passed}/{lesson.stats.scorable} notes correct
            {lesson.stats.scorable > 0 &&
              ` (${Math.round((lesson.stats.passed / lesson.stats.scorable) * 100)}%)`}
          </p>
        </section>
      )}
    </>
  );
}
