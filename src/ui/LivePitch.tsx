import { useEffect, useRef, useState } from 'react';
import { formatSpelled, spellInKey, type MusicalKey } from '../lib/key';
import { centsFromTarget, nearestMidi } from '../lib/pitch';
import type { Midi } from '../lib/types';

export interface LivePitchProps {
  hz: number | null;
  confidence: number;
  gate: number;
  musicalKey: MusicalKey;
}

/**
 * How long a note keeps its place after it stops being heard. Detection dips
 * below the confidence gate constantly mid-note — a string decaying, a finger
 * shifting — and without this the name blinks out and back several times a
 * second.
 */
const HOLD_MS = 250;

/**
 * How long a different note must hold before it takes over the display. Long
 * enough to ignore a single stray frame, short enough to feel immediate.
 */
const SETTLE_MS = 60;

/** Share of the new reading folded into the marker each frame. */
const CENTS_SMOOTHING = 0.3;

interface Steady {
  midi: Midi;
  cents: number;
}

/**
 * Steadies the *display* only. The detector's output is untouched — scoring
 * reads the raw sample stream, and nothing here feeds back into it. This exists
 * because a readout that flickers is harder to read than one that lags slightly.
 */
function useSteadyPitch(hz: number | null, confidence: number, gate: number): Steady | null {
  const [steady, setSteady] = useState<Steady | null>(null);
  const candidateRef = useRef<{ midi: Midi; since: number } | null>(null);
  const lastHeardRef = useRef(0);
  const centsRef = useRef(0);
  const shownRef = useRef<Midi | null>(null);

  useEffect(() => {
    const now = Date.now();
    const heard = hz !== null && confidence >= gate;

    if (!heard) {
      candidateRef.current = null;
      // Expire the hold on a timer too, in case no further samples arrive.
      const remaining = HOLD_MS - (now - lastHeardRef.current);
      if (shownRef.current === null) return;
      if (remaining <= 0) {
        shownRef.current = null;
        setSteady(null);
        return;
      }
      const timer = setTimeout(() => {
        shownRef.current = null;
        setSteady(null);
      }, remaining);
      return () => clearTimeout(timer);
    }

    lastHeardRef.current = now;
    const midi = nearestMidi(hz);
    const reading = centsFromTarget(hz, midi);

    const candidate = candidateRef.current;
    if (candidate === null || candidate.midi !== midi) {
      candidateRef.current = { midi, since: now };
    }

    const settled = now - (candidateRef.current?.since ?? now) >= SETTLE_MS;
    const isShown = shownRef.current === midi;

    // Jump straight in when nothing is shown; make a *replacement* earn its
    // place. Promoted on a timer as well, since a perfectly steady reading
    // stops changing the props and would otherwise never be re-examined.
    if (!isShown && shownRef.current !== null && !settled) {
      const wait = Math.max(0, SETTLE_MS - (now - (candidateRef.current?.since ?? now)));
      const timer = setTimeout(() => {
        if (candidateRef.current?.midi !== midi) return;
        centsRef.current = reading;
        shownRef.current = midi;
        setSteady({ midi, cents: reading });
      }, wait);
      return () => clearTimeout(timer);
    }

    if (!isShown) centsRef.current = reading;
    else centsRef.current += (reading - centsRef.current) * CENTS_SMOOTHING;

    shownRef.current = midi;
    setSteady({ midi, cents: centsRef.current });
  }, [hz, confidence, gate]);

  return steady;
}

/**
 * Everything here sits in a fixed slot. The note name and the tuning marker
 * appear and disappear constantly as playing starts and stops, and anything
 * that resized with them would shove the rest of the row around.
 */
export function LivePitch({ hz, confidence, gate, musicalKey }: LivePitchProps) {
  const steady = useSteadyPitch(hz, confidence, gate);

  // Spelled for the key in play — B flat in a flat key, not A sharp.
  const name = steady === null ? null : formatSpelled(spellInKey(steady.midi, musicalKey));
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
