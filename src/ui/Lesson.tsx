import { Suspense, lazy, useEffect, useState } from 'react';
import {
  MAX_LEVEL,
  clampLevel,
  conceptsIntroducedAt,
  levelBrief,
  levelConfig,
} from '../config/levels';
import {
  loadMicPermission,
  queryMicPermission,
  saveMicPermission,
  type MicPermission,
} from '../audio';
import {
  DEFAULT_INSTRUMENT_ID,
  INSTRUMENTS,
  INSTRUMENT_FAMILIES,
  instrumentById,
  positionById,
  soundingPool,
} from '../config/instruments';
import { fretRangeLabel } from '../config/regions';
import { DEFAULT_PROGRESSION, UNSCORED_WINDOW, progressionState } from '../config/progression';
import { BPM_STEP, MAX_BPM, MIN_BPM, clampBpm } from '../config/tempo';
import { loadSetting, saveSetting } from '../lib/storage';
import { applyTheme, loadTheme, type ThemePreference } from '../lib/theme';
import { midiToName } from '../lib/pitch';
import { keyByName, transposeKey } from '../lib/key';
import { Accordion } from './Accordion';
import { LivePitch } from './LivePitch';
import { useCurrentReading, useSteadyPitch } from './useSteadyPitch';
import { Onboarding } from './Onboarding';
import { Troubleshooting } from './Troubleshooting';
import { Heading, Text } from './Text';
import { PauseIcon, PlayIcon, StopIcon } from './Icon';
import { Shortcuts } from './Shortcuts';
import { Tips } from './TipCard';
import { useShortcuts } from './keys';
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

export interface LessonProps {
  /** Opened from the header, but rendered here, where the instrument is known. */
  troubleshooting?: boolean;
  onTroubleshooting?: (open: boolean) => void;
}

export function Lesson({ troubleshooting = false, onTroubleshooting }: LessonProps = {}) {
  const [level, setLevel] = useState(() => loadSetting('level', readLevel, 1));
  const [instrumentId, setInstrumentId] = useState(() =>
    loadSetting('instrument', readInstrumentId, DEFAULT_INSTRUMENT_ID),
  );
  const [positionId, setPositionId] = useState(() => loadSetting('position', readPositionId, null));
  const [autoAdvance, setAutoAdvance] = useState(() => loadSetting('autoAdvance', readFlag, true));
  // Off unless asked for. What the microphone hears is not only the player —
  // the metronome comes back in through it, and a guide note appearing on the
  // click looks wrong even where it changes no verdict.
  const [showHeard, setShowHeard] = useState(() => loadSetting('showHeard', readFlag, false));
  const [bpm, setBpm] = useState(() => loadSetting('bpm', readBpm, MIN_BPM));
  const [micPermission, setMicPermission] = useState<MicPermission>(loadMicPermission);
  const [onboarded, setOnboarded] = useState(() => loadSetting('onboarded', readFlag, false));
  /**
   * Set when the player chooses to carry on without a microphone, and
   * deliberately not stored: the ask comes back next session, because the
   * likeliest reason to return is having gone and fixed the permission.
   */
  const [micAsked, setMicAsked] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(loadTheme);
  const [keysShown, setKeysShown] = useState(false);

  useEffect(() => saveSetting('level', level), [level]);
  useEffect(() => saveSetting('instrument', instrumentId), [instrumentId]);
  useEffect(() => saveSetting('position', positionId), [positionId]);
  useEffect(() => saveSetting('autoAdvance', autoAdvance), [autoAdvance]);
  useEffect(() => saveSetting('showHeard', showHeard), [showHeard]);
  useEffect(() => saveSetting('bpm', bpm), [bpm]);
  useEffect(() => saveMicPermission(micPermission), [micPermission]);
  useEffect(() => saveSetting('onboarded', onboarded), [onboarded]);
  useEffect(() => {
    applyTheme(theme);
    saveSetting('theme', theme);
  }, [theme]);

  // The browser outranks anything stored: access granted last week can have
  // been withdrawn from the address bar since, and asking it costs nothing.
  useEffect(() => {
    let live = true;
    void queryMicPermission().then((actual) => {
      if (live && actual !== null) setMicPermission(actual);
    });
    return () => {
      live = false;
    };
  }, []);

  const instrument = instrumentById(instrumentId);
  const position = positionById(instrument, positionId);
  const config = levelConfig(level);
  const brief = levelBrief(level);
  const pool = soundingPool(instrument, position);
  // Tempo is not capped and no instrument is withheld. What a fast tempo costs
  // is the shortest note values, and what a low register costs is the shortest
  // values down there — both per note, inside generation, and neither worth
  // saying out loud: low notes being longer is how the music goes anyway.
  const effectiveBpm = bpm;

  // Advancement is gated on the same pass/fail scores used for feedback — no
  // separate mastery signal (spec §7).
  // No microphone, no scoring — the exercise still runs, but nothing is judged.
  const scoring = micPermission === 'granted';
  const lesson = useLesson({
    level,
    instrumentId,
    positionId: position?.id ?? null,
    bpm: effectiveBpm,
    scoring,
    autoAdvance,
    onAdvance: setLevel,
  });
  const progress = progressionState(level, lesson.history);

  // What the player reads, which is what the readout must name.
  const writtenKey = transposeKey(
    lesson.exercise?.key ?? C_MAJOR,
    -instrument.transposition.semitones,
    -instrument.transposition.letters,
  );

  // The same steadied reading the note-name readout shows, so the guide on the
  // staff and the name under it never name different notes. The readout says
  // what is being heard whenever that is; the guide only speaks for the note it
  // is sitting on, so it is gated on the reading being one of that note's.
  const heard = useSteadyPitch(
    lesson.livePitch?.hz ?? null,
    lesson.livePitch?.confidence ?? 0,
    config.scoring.confidenceGate,
  );
  const guideMidi = useCurrentReading(heard, lesson.activeIndex);

  const threshold = Math.round(DEFAULT_PROGRESSION.threshold * 100);
  const running = lesson.phase === 'count-in' || lesson.phase === 'playing';
  const listening = running || lesson.phase === 'results';
  /**
   * Whether there is anything to hold: an exercise in flight, or the gap before
   * the next one when one is coming. With auto-advance off, results sit there
   * until asked to move on, which is already a kind of held.
   */
  const holdable = running || (lesson.phase === 'results' && autoAdvance);

  /**
   * The transport, as a transport: play, pause and stop, all three always
   * there. Which one is live depends on the phase, and the one that is not is
   * disabled rather than removed — a control that comes and goes has to be
   * found again every time, and these three are the shape everyone already
   * knows. The play button is the one that changes meaning: start, resume,
   * next, retry. What it means now is its label, which is its title and the
   * name a screen reader reads.
   */
  const play =
    holdable && !lesson.paused
      ? // Already playing. The button is lit and dead, and is just Play.
        { label: 'Play', act: lesson.start }
      : lesson.paused && holdable
      ? { label: 'Resume', act: lesson.resume }
      : lesson.phase === 'error'
        ? { label: 'Retry', act: lesson.start }
        : lesson.phase === 'results'
          ? { label: 'Next exercise', act: lesson.start }
          : { label: 'Start', act: lesson.start };
  // Only while the music is actually running is there nothing for play to do.
  // In the gap after results it is how you skip the wait rather than sit it out.
  const canPlay = lesson.phase !== 'arming' && (!running || lesson.paused);
  // Pause is a toggle, as it is on anything else with a transport: pressing it
  // again lets the music go. It stays live while the session is held, which is
  // both how you get out of a hold and how the hold shows itself.
  const canPause = holdable;

  /** Where there is another exercise to move on to rather than one in flight. */
  const between =
    lesson.phase === 'idle' || lesson.phase === 'results' || lesson.phase === 'error';


  useEffect(() => {
    void import('../notation');
  }, []);

  // The microphone is asked for once a session until it is granted — a refusal
  // is usually followed by going and fixing it, and the app has to notice.
  // The instrument is asked once ever, and changed from the sidebar after that.
  const needsMicrophone = micPermission !== 'granted' && !micAsked;
  const onboarding = needsMicrophone || !onboarded;

  // Listen from the start, so the readout works before and between exercises —
  // but not while the checklist is still up. Access granted on a previous visit
  // is not permission to switch the microphone on the moment the page loads:
  // that is for the player to do, from the checklist.
  const { listen } = lesson;
  useEffect(() => {
    if (onboarding || micPermission !== 'granted') return;
    listen();
  }, [listen, micPermission, onboarding]);

  // A dialog owns the keyboard while it is up, including the checklist that
  // arrives over a lesson that has not started yet.
  useShortcuts(
    {
      // Space is the transport: whichever of play and pause is live takes it.
      toggle:
        lesson.milestone !== null
          ? lesson.acknowledgeMilestone
          : lesson.paused
            ? lesson.resume
            : canPause
              ? lesson.pause
              : canPlay
                ? play.act
                : undefined,
      next: lesson.milestone !== null ? lesson.acknowledgeMilestone : between ? lesson.start : undefined,
      stop: listening ? lesson.stop : undefined,
      keys: () => setKeysShown(true),
    },
    !onboarding && !troubleshooting && !keysShown,
  );

  return (
    <div className="layout">
      {/* The checklist sits over the app rather than in place of it, so what is
          being set up is visible behind the questions. */}
      <Onboarding
        open={onboarding}
        request={lesson.requestMicrophone}
        permission={micPermission}
        onPermission={setMicPermission}
        needsInstrument={!onboarded}
        instrumentId={instrumentId}
        positionId={positionId}
        onInstrument={setInstrumentId}
        onPosition={setPositionId}
        onDone={() => {
          setOnboarded(true);
          setMicAsked(true);
        }}
      />

      <Troubleshooting
        open={troubleshooting}
        onOpenChange={(open) => onTroubleshooting?.(open)}
        instrument={instrument}
      />

      <Shortcuts open={keysShown} onOpenChange={setKeysShown} />

      <div className="stage">
        {lesson.milestone !== null ? (
          <section className="milestone">
            <Heading level={2}>Level {lesson.milestone}</Heading>
            <p>Now introducing:</p>
            <ul>
              {conceptsIntroducedAt(lesson.milestone).map((concept) => (
                <li key={concept}>{concept}</li>
              ))}
            </ul>
            <Text tone="muted">These start appearing gradually, not all at once.</Text>
            <button onClick={lesson.acknowledgeMilestone}>Continue</button>
          </section>
        ) : (
          <>
            {/* Three fixed slots — go, stop, and what is happening. Which
                button is in the first one changes constantly; where it is and
                how wide it is never does, so nothing below the row moves as a
                session runs. */}
            <div className="stage-controls">
              <div className="transport">
                <button
                  type="button"
                  className={`control ${running && !lesson.paused ? 'is-live' : ''}`}
                  onClick={play.act}
                  disabled={!canPlay}
                  title={`${play.label} (Space)`}
                  aria-label={play.label}
                  aria-keyshortcuts="Space"
                >
                  <PlayIcon />
                </button>
                <button
                  type="button"
                  className={`control ${lesson.paused ? 'is-live' : ''}`}
                  onClick={lesson.paused ? lesson.resume : lesson.pause}
                  disabled={!canPause}
                  title={lesson.paused ? 'Unpause (Space)' : 'Pause (Space)'}
                  aria-label="Pause"
                  // A toggle, so it keeps one name and reports its state
                  // rather than becoming a second button called Resume.
                  aria-pressed={lesson.paused}
                  aria-keyshortcuts="Space"
                >
                  <PauseIcon />
                </button>
                <button
                  type="button"
                  className="control"
                  onClick={lesson.stop}
                  disabled={!listening}
                  title="Stop (Esc)"
                  aria-label="Stop"
                  aria-keyshortcuts="Escape"
                >
                  <StopIcon />
                </button>
              </div>
              <div className="control-status">
                {lesson.phase === 'error' ? (
                  <span role="alert" className="control-message">
                    Could not start: {lesson.error}
                  </span>
                ) : lesson.phase === 'arming' ? (
                  <Text as="span" tone="muted">Requesting microphone…</Text>
                ) : lesson.phase === 'count-in' && !lesson.paused ? (
                  <span className="count-in">
                    Count-in <strong>{lesson.beatsUntilStart}</strong>
                  </span>
                ) : lesson.secondsUntilNext !== null ? (
                  /* The gap after results, so the wait is a wait rather than a
                     hold of unknown length. */
                  <span className="count-in">
                    Next exercise in <strong>{lesson.secondsUntilNext}</strong>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="score-area">
              {/* Nothing to read yet, so the space says something useful
                  instead of sitting empty. */}
              {!lesson.exercise && (
                <Tips
                  instrument={instrument}
                  scoring={scoring}
                  onKeys={() => setKeysShown(true)}
                />
              )}
              {lesson.exercise && (
                <Suspense fallback={<Text tone="muted">Loading notation…</Text>}>
                  <Score
                    exercise={lesson.exercise}
                    instrument={instrument}
                    position={position}
                    results={lesson.results}
                    activeIndex={lesson.activeIndex ?? undefined}
                    heardMidi={showHeard && scoring ? guideMidi : null}
                  />
                </Suspense>
              )}
            </div>

            <div className="status">
              {scoring ? (
                <div className="card monitor">
                  <div className="monitor-row">
                    <LivePitch
                      hz={lesson.livePitch?.hz ?? null}
                      confidence={lesson.livePitch?.confidence ?? 0}
                      gate={config.scoring.confidenceGate}
                      musicalKey={writtenKey}
                      writtenOffset={-instrument.transposition.semitones}
                    />
                    <Waveform analyser={lesson.analyser} />
                  </div>
                </div>
              ) : (
                <div className="card monitor">
                  <Text size="small" tone="muted">
                    Scoring is off — the microphone was not available.
                  </Text>
                  <button type="button" onClick={() => setMicAsked(false)}>
                    Turn scoring on
                  </button>
                </div>
              )}

              <section className="card progress-card">
                <Heading level={2} size="small">Levelling up</Heading>
                {/* With nothing scored there is no accuracy to fill a bar with,
                    so the same window counts exercises read instead. */}
                <div
                  className="window"
                  role="img"
                  aria-label={
                    progress.atCeiling
                      ? 'Top level reached'
                      : scoring
                        ? `${progress.completed} of ${progress.needed} exercises played, ` +
                          `${Math.round((progress.accuracy ?? 0) * 100)}% accuracy, ` +
                          `${threshold}% needed to level up`
                        : `${lesson.unscoredCompleted} of ${UNSCORED_WINDOW} exercises played`
                  }
                >
                  {Array.from({ length: scoring ? progress.needed : UNSCORED_WINDOW }, (_, i) => {
                    const accuracy = scoring ? lesson.history[i] : undefined;
                    const played = !scoring && i < lesson.unscoredCompleted;
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
                        {played && <span className="window-fill is-played" />}
                      </span>
                    );
                  })}
                </div>
              </section>

              {scoring && (
                <section className="card result-card">
                  <Heading level={2} size="small">Last exercise</Heading>
                  <p className="result-line">
                    <span className="result-score">
                      {lesson.summary ? `${Math.round(lesson.summary.accuracy * 100)}%` : '—'}
                    </span>
                    <Text as="span" size="small" tone="muted">
                      {lesson.summary &&
                        `${lesson.summary.passed}/${
                          lesson.summary.total - lesson.summary.unscorable
                        }`}
                    </Text>
                  </p>
                </section>
              )}
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
              max={MAX_BPM}
              step={BPM_STEP}
              value={effectiveBpm}
              onChange={(event) => setBpm(Number(event.target.value))}
              disabled={running}
            />
          </label>
          {/* Everything but the two settings that change what an exercise is
              like. They are the ones worth reaching for mid-session; the rest
              are set once and then only get in the way. */}
          <Accordion title="Settings">
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
                {INSTRUMENT_FAMILIES.map((family) => (
                  <optgroup key={family.id} label={family.label}>
                    {INSTRUMENTS.filter((option) => option.family === family.id).map((option) => (
                      <option
                        key={option.id}
                        value={option.id}
                        disabled={option.status === 'comingSoon'}
                      >
                        {option.name}
                        {option.status === 'comingSoon' ? ' — coming soon' : ''}
                      </option>
                    ))}
                  </optgroup>
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
                    <option
                      key={option.id}
                      value={option.id}
                      disabled={option.status === 'comingSoon'}
                    >
                      {option.label}
                      {option.status === 'comingSoon' ? ' — coming soon' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <Text size="small" tone="muted">
              {position?.region && `${fretRangeLabel(position.region)} · `}
              {pool.length} pitches, {midiToName(pool[0])}–{midiToName(pool[pool.length - 1])}
              {instrument.transposition.semitones !== 0 &&
                ` · ${instrument.transposition.label.toLowerCase()}`}
            </Text>

            <label className="field">
              <span className="field-label">Appearance</span>
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value as ThemePreference)}
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            <label className="toggle">
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(event) => setAutoAdvance(event.target.checked)}
              />
              Auto-advance
            </label>

            <label className="toggle">
              <input
                type="checkbox"
                checked={showHeard}
                onChange={(event) => setShowHeard(event.target.checked)}
              />
              Show guide note
            </label>
          </Accordion>
        </section>

        <section className="card">
          <Heading level={2} size="small">This level</Heading>
          <ul className="facts">
            {brief.facts.map((fact) => (
              <li key={fact.label}>
                <span className="fact-label">{fact.label}</span>
                <span className="fact-value">{fact.value}</span>
              </li>
            ))}
          </ul>

          {brief.introducing.length > 0 && (
            <Accordion title="Being introduced" count={brief.introducing.length}>
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
            </Accordion>
          )}

        </section>

      </aside>
    </div>
  );
}
