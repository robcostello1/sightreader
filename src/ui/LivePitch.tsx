import { formatSpelled, spellInKey, type MusicalKey } from '../lib/key';
import { centsFromTarget, nearestMidi } from '../lib/pitch';

export interface LivePitchProps {
  hz: number | null;
  confidence: number;
  gate: number;
  musicalKey: MusicalKey;
}

/**
 * Everything here sits in a fixed slot. The note name and the tuning marker
 * appear and disappear constantly as playing starts and stops, and anything
 * that resized with them would shove the rest of the row around.
 */
export function LivePitch({
  hz,
  confidence,
  gate,
  musicalKey,
}: LivePitchProps) {
  const confident = hz !== null && confidence >= gate;
  const midi = hz === null ? null : nearestMidi(hz);
  // Spelled for the key in play — B flat in a flat key, not A sharp.
  const name = confident && midi !== null ? formatSpelled(spellInKey(midi, musicalKey)) : null;

  // How far off the nearest semitone, as a position rather than a number: a
  // reading is either flat, sharp or in tune, and the figure itself adds little.
  const cents = confident && midi !== null ? centsFromTarget(hz!, midi) : 0;
  const offset = 50 + Math.max(-50, Math.min(50, cents));

  return (
    <div className={`readout ${confident ? 'is-confident' : ''}`}>
      <span className="note">{name ?? '—'}</span>
      <span className="tuning" aria-hidden>
        <i className="tuning-centre" />
        {name !== null && <i className="tuning-marker" style={{ left: `${offset}%` }} />}
      </span>
    </div>
  );
}

