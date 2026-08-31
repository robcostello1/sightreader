import { formatSpelled, spellInKey, type MusicalKey } from '../lib/key';
import { useSteadyPitch } from './useSteadyPitch';

export interface LivePitchProps {
  hz: number | null;
  confidence: number;
  gate: number;
  /** The key as written for this instrument, not the concert one. */
  musicalKey: MusicalKey;
  /**
   * Semitones from sounding to written. The microphone hears concert pitch, but
   * a player reads and thinks in their own part — a B flat clarinettist playing
   * a concert D is playing their E, and being told "D" would be no help.
   */
  writtenOffset?: number;
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
  writtenOffset = 0,
}: LivePitchProps) {
  const steady = useSteadyPitch(hz, confidence, gate);

  // Spelled for the key in play — B flat in a flat key, not A sharp.
  const name =
    steady === null
      ? null
      : formatSpelled(spellInKey(steady.midi + writtenOffset, musicalKey));
  const offset = 50 + Math.max(-50, Math.min(50, steady?.cents ?? 0));

  return (
    <div className={`readout ${steady !== null ? 'is-confident' : ''}`}>
      <span className="note">{name ?? '—'}</span>
      <span className="tuning" aria-hidden>
        <i className="tuning-centre" />
        {name !== null && <i className="tuning-marker" style={{ left: `${offset}%` }} />}
      </span>
    </div>
  );
}
