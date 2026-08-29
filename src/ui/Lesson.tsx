import { Suspense, lazy, useEffect, useState } from 'react';
import {
  MAX_LEVEL,
  clampLevel,
  conceptsIntroducedAt,
  levelBrief,
  levelConfig,
  shortestNoteValue,
} from '../config/levels';
import { maxScorableBpm } from '../scoring';
import { NOMINAL_HOP_MS } from '../audio';
import { POSITIONS, fretRangeLabel, regionById, regionPool } from '../config/regions';
import { DEFAULT_PROGRESSION, progressionState } from '../config/progression';
import { BPM_STEP, MAX_BPM, MIN_BPM, clampBpm } from '../config/tempo';
import { loadSetting, saveSetting } from '../lib/storage';
import { centsFromTarget, midiToName, nearestMidi } from '../lib/pitch';
import { formatSpelled, spellInKey, type MusicalKey } from '../lib/key';
import { Waveform } from './Waveform';
import { useLesson } from './useLesson';
import type { NoteResult } from '../lib/types';

// VexFlow is the bulk of the bundle and nothing is notated until a lesson
// starts, so it loads out of band. The effect below warms it during the idle
// screen, well before the count-in ends.
const Score = lazy(() => import('../notation').then((m) => ({ default: m.Score })));

const VERDICT_LABELS: Record<NoteResult['verdict'], string> = {
  pass: 'correct',
  silence: 'nothing played',
  'wrong-pitch': 'wrong note',
  unclear: 'unclear — more than one string sounding',
  unscorable: 'too short to score at this tempo',
};

/** Stored settings are validated on read — see loadSetting. */
const readLevel = (value: unknown) => (typeof value === 'number' ? clampLevel(value) : null);
const readRegionId = (value: unknown) =>
  typeof value === 'string' && POSITIONS.some((p) => p.id === value) ? value : null;
const readFlag = (value: unknown) => (typeof value === 'boolean' ? value : null);
const readBpm = (value: unknown) => (typeof value === 'number' ? clampBpm(value) : null);

function LivePitch({
  hz,
  confidence,
  gate,
  musicalKey,
}: {
  hz: number | null;
  confidence: number;
  gate: number;
  musicalKey: MusicalKey;
}) {
  const confident = hz !== null && confidence >= gate;
  const midi = hz === null ? null : nearestMidi(hz);
  const cents = hz !== null && midi !== null ? centsFromTarget(hz, midi) : null;
  // Spelled for the key in play — B flat in a flat key, not A sharp.
  const name = midi === null ? null : formatSpelled(spellInKey(midi, musicalKey));

  return (
    <div className={`readout ${confident ? 'is-confident' : ''}`}>
      <span className="note">{confident && name !== null ? name : '—'}</span>
      <span className="detail">
        {confident && hz !== null
          ? `${hz.toFixed(1)} Hz · ${cents! >= 0 ? '+' : ''}${cents!.toFixed(0)} cents`
          : ''}
      </span>
    </div>
  );
}

function Results({
  results,
  summary,
}: {
  results: readonly NoteResult[];
  summary: { passed: number; total: number; accuracy: number; unscorable: number };
}) {
  const failures = results.filter((r) => !r.passed);
  return (
    <div>
      <p className="score-line">
        {summary.passed} of {summary.total - summary.unscorable} correct —{' '}
        <strong>{Math.round(summary.accuracy * 100)}%</strong>
        {summary.unscorable > 0 && (
          <span className="muted"> ({summary.unscorable} too short to score)</span>
        )}
      </p>
      {failures.length > 0 && (
        <ul className="failures">
          {failures.slice(0, 6).map((result) => (
            <li key={result.index}>
              Note {result.index + 1}: {VERDICT_LABELS[result.verdict]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Lesson() {
  const [level, setLevel] = useState(() => loadSetting('level', readLevel, 1));
  const [regionId, setRegionId] = useState(() =>
    loadSetting('position', readRegionId, POSITIONS[0].id),
  );
  const [autoAdvance, setAutoAdvance] = useState(() => loadSetting('autoAdvance', readFlag, true));
  const [bpm, setBpm] = useState(() => loadSetting('bpm', readBpm, MIN_BPM));

  useEffect(() => saveSetting('level', level), [level]);
  useEffect(() => saveSetting('position', regionId), [regionId]);
  useEffect(() => saveSetting('autoAdvance', autoAdvance), [autoAdvance]);
  useEffect(() => saveSetting('bpm', bpm), [bpm]);

  const region = regionById(regionId);
  const config = levelConfig(level);
  const brief = levelBrief(level);
  const pool = regionPool(region);
  // The detector reports once per hop and the attack guard eats the head of
  // every window, so past a certain tempo this level's shortest note cannot be
  // judged at all. Cap the control there rather than offering settings that
  // return nothing but "too short to score". The tightest signature is the
  // limiting one, since a smaller beat unit makes the same value briefer.
  const tightestBeatUnit = Math.min(...config.timeSignatures.map((entry) => entry.value[1]));
  const tempoCeiling = clampBpm(
    Math.min(
      MAX_BPM,
      maxScorableBpm(shortestNoteValue(config), tightestBeatUnit, config.scoring, NOMINAL_HOP_MS),
    ),
  );
  const effectiveBpm = Math.min(bpm, tempoCeiling);

  // Advancement is gated on the same pass/fail scores used for feedback — no
  // separate mastery signal (spec §7).
  const lesson = useLesson({ level, region, bpm: effectiveBpm, autoAdvance, onAdvance: setLevel });
  const progress = progressionState(level, lesson.history);

  const threshold = Math.round(DEFAULT_PROGRESSION.threshold * 100);
  const running = lesson.phase === 'count-in' || lesson.phase === 'playing';
  const listening = running || lesson.phase === 'results';

  useEffect(() => {
    void import('../notation');
  }, []);

  return (
    <div className="layout">
      <div className="stage">
        {lesson.milestone !== null ? (
          <section className="milestone">
            <h2>Level {lesson.milestone}</h2>
            <p>Now introducing:</p>
            <ul>
              {conceptsIntroducedAt(lesson.milestone).map((concept) => (
                <li key={concept}>{concept}</li>
              ))}
            </ul>
            <p className="muted">These start appearing gradually, not all at once.</p>
            <button onClick={lesson.acknowledgeMilestone}>Continue</button>
          </section>
        ) : (
          <>
            <div className="stage-controls">
              {lesson.phase === 'idle' && (
                <button className="primary" onClick={lesson.start}>
                  Start
                </button>
              )}
              {lesson.phase === 'arming' && <span className="muted">Requesting microphone…</span>}
              {listening && <button onClick={lesson.stop}>Stop</button>}
              {lesson.phase === 'results' && !autoAdvance && (
                <button className="primary" onClick={lesson.start}>
                  Next
                </button>
              )}
              {lesson.phase === 'results' && autoAdvance && (
                <button onClick={lesson.paused ? lesson.resume : lesson.pause}>
                  {lesson.paused ? 'Resume' : 'Pause'}
                </button>
              )}
              {lesson.phase === 'error' && (
                <>
                  <span role="alert">Could not start: {lesson.error}</span>
                  <button onClick={lesson.start}>Retry</button>
                </>
              )}
              {lesson.phase === 'count-in' && (
                <span className="count-in">
                  Count-in <strong>{lesson.beatsUntilStart}</strong>
                </span>
              )}
            </div>

            {lesson.exercise && (
              <Suspense fallback={<p className="muted">Loading notation…</p>}>
                <Score
                  exercise={lesson.exercise}
                  results={lesson.results}
                  activeIndex={lesson.activeIndex ?? undefined}
                />
              </Suspense>
            )}

            {running && lesson.exercise && (
              <div className="monitor">
                <div className="monitor-item">
                  <span className="monitor-label">Heard</span>
                  <LivePitch
                    hz={lesson.livePitch?.hz ?? null}
                    confidence={lesson.livePitch?.confidence ?? 0}
                    gate={config.scoring.confidenceGate}
                    musicalKey={lesson.exercise.key}
                  />
                </div>
                {lesson.analyser && (
                  <div className="monitor-item">
                    <span className="monitor-label">Microphone</span>
                    <Waveform analyser={lesson.analyser} />
                  </div>
                )}
              </div>
            )}

            {lesson.phase === 'results' && lesson.summary && (
              <Results results={lesson.results} summary={lesson.summary} />
            )}
          </>
        )}
      </div>

      <aside className="sidebar">
        <section>
          <h2>Config</h2>

          <label className="field field-primary">
            <span className="field-label">
              Difficulty {level.toFixed(1)} <span className="unit">of {MAX_LEVEL}</span>
            </span>
            <input
              type="range"
              min={1}
              max={MAX_LEVEL}
              // Tenths: within a level, the decimal is how often its new ideas
              // turn up. 3.0 still plays like level 2; 3.9 is nearly level 4.
              step={0.1}
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              disabled={running}
            />
            <p className="hint">
              Whole numbers introduce new ideas; the decimal is how far they have
              come in.
            </p>
          </label>

          <label className="field">
            <span className="field-label">Tempo — {effectiveBpm} bpm</span>
            <input
              type="range"
              min={MIN_BPM}
              max={tempoCeiling}
              step={BPM_STEP}
              value={effectiveBpm}
              onChange={(event) => setBpm(Number(event.target.value))}
              disabled={running}
            />
          </label>
          {tempoCeiling < MAX_BPM && (
            <p className="muted small">
              Capped at {tempoCeiling} bpm — faster than this and the shortest notes
              at this level are too brief to score.
            </p>
          )}

          <label className="field">
            <span className="field-label">Fretboard position</span>
            <select
              value={regionId}
              onChange={(event) => setRegionId(event.target.value)}
              disabled={running}
            >
              {POSITIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            {region.name} — {fretRangeLabel(region)} · {pool.length} pitches,{' '}
            {midiToName(pool[0])}–{midiToName(pool[pool.length - 1])}
          </p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(event) => setAutoAdvance(event.target.checked)}
            />
            Auto-advance to next exercise
          </label>
        </section>

        <section>
          <h2>This level</h2>
          <ul className="facts">
            {brief.facts.map((fact) => (
              <li key={fact.label}>
                <span className="fact-label">{fact.label}</span>
                <span className="fact-value">{fact.value}</span>
              </li>
            ))}
          </ul>

          {brief.introducing.length > 0 && (
            <>
              <p className="small muted">Coming in</p>
              <ul className="introducing">
                {brief.introducing.map((item) => (
                  <li key={item.label}>
                    {item.label}
                    <span className="bar" aria-hidden>
                      <span className="bar-fill" style={{ width: `${item.progress * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

        </section>

        <section>
          <h2>Levelling up</h2>
          {progress.atCeiling ? (
            <p className="small">Top level reached.</p>
          ) : (
            <>
              <div
                className="window"
                role="img"
                aria-label={`${progress.completed} of ${progress.needed} exercises played`}
              >
                {Array.from({ length: progress.needed }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < progress.completed ? (progress.ready ? 'strong' : 'played') : ''
                    }
                  />
                ))}
              </div>
              <p className="small">
                {progress.accuracy === null
                  ? `Reach ${threshold}% accuracy across ${progress.needed} exercises to level up.`
                  : `${Math.round(progress.accuracy * 100)}% accuracy over ${progress.completed} of ${progress.needed} — ${threshold}% needed.`}
              </p>
            </>
          )}

          {lesson.stats.completed > 0 && (
            <p className="muted small">
              {lesson.stats.completed} exercise{lesson.stats.completed === 1 ? '' : 's'} this
              session
              {lesson.stats.scorable > 0 &&
                `, ${Math.round((lesson.stats.passed / lesson.stats.scorable) * 100)}% of notes correct`}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
