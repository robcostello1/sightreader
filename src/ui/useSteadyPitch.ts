import { useEffect, useRef, useState } from 'react';
import { centsFromTarget, nearestMidi } from '../lib/pitch';
import type { Midi } from '../lib/types';

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

export interface Steady {
  midi: Midi;
  cents: number;
}

/**
 * Steadies the *display* only. The detector's output is untouched — scoring
 * reads the raw sample stream, and nothing here feeds back into it. This exists
 * because a readout that flickers is harder to read than one that lags slightly.
 *
 * Shared by the note-name readout and the ghost note on the staff, so the two
 * never disagree about what is being heard. They call it separately rather than
 * passing one result down: the readout is self-contained, and the hook is a
 * function of its arguments, so two callers given the same samples settle on the
 * same note.
 */
export function useSteadyPitch(
  hz: number | null,
  confidence: number,
  gate: number,
): Steady | null {
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
 * The steadied reading, but only while it belongs to the note under the cursor.
 *
 * The cursor moving on is not a new reading of the room. A pitch still being
 * held from the note before — or lingering inside the hold above — would
 * otherwise travel to the note that has just come up and sit over it as though
 * it were an answer to it, before the microphone has said anything about that
 * note at all.
 *
 * What counts as having said something is a fresh reading, not a different one:
 * a note held or struck again across the bar keeps arriving, so it keeps its
 * guide, while a note that has stopped does not.
 */
/* oxlint-disable react/refs -- see below: the note a reading arrived under has
   to be remembered as it arrives, and the value is derived during render on
   purpose. */
export function useCurrentReading(heard: Steady | null, activeIndex: number | null): Midi | null {
  const lastHeard = useRef<Steady | null>(null);
  const heardDuring = useRef<number | null>(null);

  // Noted as the reading arrives rather than in an effect. An effect runs after
  // the paint, and the frame it would run a step behind on is the one where the
  // cursor has moved and the reading has not — precisely the frame that would
  // show the note before over the note now. The pair here is a memo of the last
  // arrival, not state the render depends on: the same arguments give the same
  // answer, which is what makes it safe to work out here.
  if (heard !== lastHeard.current) {
    lastHeard.current = heard;
    heardDuring.current = activeIndex;
  }

  return heard !== null && heardDuring.current === activeIndex ? heard.midi : null;
}
/* oxlint-enable react/refs */
