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
import {
  DEFAULT_INSTRUMENT_ID,
  INSTRUMENTS,
  instrumentById,
  positionById,
  soundingPool,
} from '../config/instruments';
import { fretRangeLabel } from '../config/regions';
import { DEFAULT_PROGRESSION, progressionState } from '../config/progression';
import { BPM_STEP, MAX_BPM, MIN_BPM, clampBpm } from '../config/tempo';
import { loadSetting, saveSetting } from '../lib/storage';
import { midiToName } from '../lib/pitch';
import { keyByName } from '../lib/key';
import { LivePitch } from './LivePitch';
import { Waveform } from './Waveform';
import { useLesson } from './useLesson';

// VexFlow is the bulk of the bundle and nothing is notated until a lesson
// starts, so it loads out of band. The effect below warms it during the idle
// screen, well before the count-in ends.
const Score = lazy(() => import('../notation').then((m) => ({ default: m.Score })));

/** Stored settings are validated on read — see loadSetting. */
const readLevel = (value: unknown) => (typeof value === 'number' ? clampLevel(value) : null);
const readInstrumentId = (value: unknown) =>
  typeof value === 'string' &&
  INSTRUMENTS.some((i) => i.id === value && i.status === 'available')
    ? value
    : null;
const readPositionId = (value: unknown) => (typeof value === 'string' ? value : null);
/** Fallback for the readout before an exercise names a key. */
const C_MAJOR = keyByName('C');

const readFlag = (value: unknown) => (typeof value === 'boolean' ? value : null);
const readBpm = (value: unknown) => (typeof value === 'number' ? clampBpm(value) : null);

export function Lesson() {
  const [level, setLevel] = useState(() => loadSetting('level', readLevel, 1));
  const [instrumentId, setInstrumentId] = useState(() =>
    loadSetting('instrument', readInstrumentId, DEFAULT_INSTRUMENT_ID),
  );
  const [positionId, setPositionId] = useState(() => loadSetting('position', readPositionId, null));
  const [autoAdvance, setAutoAdvance] = useState(() => loadSetting('autoAdvance', readFlag, true));
  const [bpm, setBpm] = useState(() => loadSetting('bpm', readBpm, MIN_BPM));

  useEffect(() => saveSetting('level', level), [level]);
  useEffect(() => saveSetting('instrument', instrumentId), [instrumentId]);
  useEffect(() => saveSetting('position', positionId), [positionId]);
  useEffect(() => saveSetting('autoAdvance', autoAdvance), [autoAdvance]);
  useEffect(() => saveSetting('bpm', bpm), [bpm]);

  const instrument = instrumentById(instrumentId);
  const position = positionById(instrument, positionId);
  const config = levelConfig(level);
  const brief = levelBrief(level);
  const pool = soundingPool(instrument, position);
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
  const lesson = useLesson({
    level,
    instrumentId,
    positionId: position?.id ?? null,
    bpm: effectiveBpm,
    autoAdvance,
    onAdvance: setLevel,
  });
  const progress = progressionState(level, lesson.history);

  const threshold = Math.round(DEFAULT_PROGRESSION.threshold * 100);
  const running = lesson.phase === 'count-in' || lesson.phase === 'playing';
  const listening = running || lesson.phase === 'results';

  useEffect(() => {
    void import('../notation');
  }, []);

  // Listen from the start, so the readout works before and between exercises.
  const { listen } = lesson;
  useEffect(() => listen(), [listen]);

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

            <div className="score-area">
              {lesson.exercise && (
                <Suspense fallback={<p className="muted">Loading notation…</p>}>
                  <Score
                    exercise={lesson.exercise}
                    instrument={instrument}
                    position={position}
                    results={lesson.results}
                    activeIndex={lesson.activeIndex ?? undefined}
                  />
                </Suspense>
              )}
            </div>

            <div className="status">
              <div className="card monitor">
                <div className="monitor-row">
                  <LivePitch
                    hz={lesson.livePitch?.hz ?? null}
                    confidence={lesson.livePitch?.confidence ?? 0}
                    gate={config.scoring.confidenceGate}
                    musicalKey={lesson.exercise?.key ?? C_MAJOR}
                  />
                  <Waveform analyser={lesson.analyser} />
                </div>
              </div>

              <section className="card progress-card">
                <h2>Levelling up</h2>
                <div
                  className="window"
                  role="img"
                  aria-label={
                    progress.atCeiling
                      ? 'Top level reached'
                      : `${progress.completed} of ${progress.needed} exercises played, ` +
                        `${Math.round((progress.accuracy ?? 0) * 100)}% accuracy, ` +
                        `${threshold}% needed to level up`
                  }
                >
                  {Array.from({ length: progress.needed }, (_, i) => {
                    const accuracy = lesson.history[i];
                    return (
                      <span key={i} className="window-slot">
                        {accuracy !== undefined && (
                          <span
                            className={`window-fill ${
                              accuracy >= DEFAULT_PROGRESSION.threshold ? 'is-pass' : ''
                            }`}
                            style={{ width: `${Math.max(4, accuracy * 100)}%` }}
                          />
                        )}
                      </span>
                    );
                  })}
                </div>
              </section>

              <section className="card result-card">
                <h2>Last exercise</h2>
                <p className="result-line">
                  <span className="result-score">
                    {lesson.summary ? `${Math.round(lesson.summary.accuracy * 100)}%` : '—'}
                  </span>
                  <span className="muted small">
                    {lesson.summary &&
                      `${lesson.summary.passed}/${
                        lesson.summary.total - lesson.summary.unscorable
                      }`}
                  </span>
                </p>
              </section>
            </div>

          </>
        )}
      </div>

      <aside className="sidebar">
        <section className="card">
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
            <span className="field-label">Instrument</span>
            <select
              value={instrumentId}
              onChange={(event) => {
                setInstrumentId(event.target.value);
                // Positions belong to an instrument; the old one means nothing here.
                setPositionId(null);
              }}
              disabled={running}
            >
              {INSTRUMENTS.map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  disabled={option.status === 'comingSoon'}
                >
                  {option.name}
                  {option.status === 'comingSoon' ? ' — coming soon' : ''}
                </option>
              ))}
            </select>
          </label>

          {instrument.hasPositions && instrument.positions && (
            <label className="field">
              <span className="field-label">
                {instrument.id === 'guitar' ? 'Fretboard position' : 'Range'}
              </span>
              <select
                value={position?.id ?? ''}
                onChange={(event) => setPositionId(event.target.value)}
                disabled={running}
              >
                {instrument.positions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <p className="muted small">
            {position?.region && `${fretRangeLabel(position.region)} · `}
            {pool.length} pitches, {midiToName(pool[0])}–{midiToName(pool[pool.length - 1])}
            {instrument.transposition.semitones !== 0 &&
              ` · ${instrument.transposition.label.toLowerCase()}`}
          </p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(event) => setAutoAdvance(event.target.checked)}
            />
            Auto-advance
          </label>
        </section>

        <section className="card">
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
            <details className="accordion">
              <summary>Being introduced ({brief.introducing.length})</summary>
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
            </details>
          )}

        </section>

      </aside>
    </div>
  );
}
