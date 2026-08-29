import { OPEN_POSITION, regionPool } from './config/regions';
import { centsFromTarget, midiToName, nearestMidi } from './lib/pitch';
import { TIERS } from './config/tiers';
import { useLivePitch } from './ui/useLivePitch';

const CONFIDENCE_GATE = TIERS.simple.scoring.confidenceGate;

function PitchReadout() {
  const { status, error, sample, lastOnset, onsetCount, sampleRate, start, stop } = useLivePitch();

  const confident = sample !== null && sample.hz !== null && sample.confidence >= CONFIDENCE_GATE;
  const midi = sample?.hz != null ? nearestMidi(sample.hz) : null;
  const cents = sample?.hz != null && midi !== null ? centsFromTarget(sample.hz, midi) : null;

  return (
    <section>
      <h2>Live pitch</h2>

      {status === 'idle' && <button onClick={start}>Start listening</button>}
      {status === 'starting' && <p>Requesting microphone…</p>}
      {status === 'error' && (
        <p role="alert">
          Could not start: {error} <button onClick={start}>Retry</button>
        </p>
      )}

      {status === 'listening' && (
        <>
          <div className={`readout ${confident ? 'is-confident' : ''}`}>
            <span className="note">{confident && midi !== null ? midiToName(midi) : '—'}</span>
            <span className="detail">
              {confident && sample?.hz != null
                ? `${sample.hz.toFixed(1)} Hz · ${cents! >= 0 ? '+' : ''}${cents!.toFixed(0)} cents`
                : 'listening…'}
            </span>
          </div>

          <div className="meter" aria-label="detection confidence">
            <div className="meter-fill" style={{ width: `${(sample?.confidence ?? 0) * 100}%` }} />
          </div>
          <p className="muted">
            Confidence {(sample?.confidence ?? 0).toFixed(2)} (gate {CONFIDENCE_GATE}) · capture{' '}
            {sampleRate} Hz
          </p>
          <p className="muted">
            Attacks detected: {onsetCount}
            {lastOnset && ` · last strength ${lastOnset.strength.toFixed(1)}`}
          </p>

          <button onClick={stop}>Stop</button>
        </>
      )}
    </section>
  );
}

export default function App() {
  const pool = regionPool(OPEN_POSITION);

  return (
    <main>
      <h1>Sightreader</h1>
      <p>Guitar sight-reading trainer. Audio pipeline only — no lesson loop yet.</p>

      <PitchReadout />

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
              <strong>{tier.name}</strong> — {tier.targetBars ?? 'idiom-length'} bar(s),{' '}
              {tier.density.id} density,{' '}
              {tier.idioms.id} idioms, click{' '}
              {tier.clickThroughExercise ? 'throughout' : 'count-in only'}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
