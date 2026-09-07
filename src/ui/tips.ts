import { DEFAULT_PROGRESSION } from '../config/progression';
import type { InstrumentDefinition } from '../config/instruments';

export interface Tip {
  id: string;
  title: string;
  body: string;
}

/**
 * What this player, on this instrument, could usefully be told.
 *
 * Nothing here is about how to read music — it is about the parts of the app
 * that are easy to miss. A tip is dropped rather than reworded when it does not
 * apply: there is no range to change on a fixed-range instrument, nothing to
 * tune to without a microphone, and a piano is not tuned by its player.
 */
export function tipsFor(instrument: InstrumentDefinition, scoring: boolean): Tip[] {
  const window = DEFAULT_PROGRESSION.windowSize;
  const threshold = Math.round(DEFAULT_PROGRESSION.threshold * 100);
  return [
    {
      id: 'controls',
      title: 'Hands on the instrument',
      body: 'Space starts a session, holds it wherever it has got to, and picks it back up from the top of the bar. Esc stops. Press ? for the rest.',
    },
    ...(instrument.hasPositions
      ? [
          {
            id: 'range',
            title: 'Where you are playing',
            body:
              instrument.id === 'guitar'
                ? 'Settings holds every fretboard position, and the whole neck in both lengths a guitar comes in. Moving up the neck changes what is under your hand, not how hard the reading is.'
                : 'Settings holds a five-finger position for each hand, one staff at a time, and the grand staff at three widths.',
          },
        ]
      : []),
    {
      id: 'levelling',
      title: 'Moving up',
      body: `The row of bars below the staff is your last ${window} exercises. Averaging ${threshold}% across them moves you up a tenth of a level, and starts the window again.`,
    },
    ...(scoring
      ? [
          {
            id: 'guide',
            title: 'Seeing what it hears',
            body: 'Show guide note, in Settings, draws the note the microphone is hearing on the staff beside the one you are meant to be playing.',
          },
        ]
      : []),
    ...(scoring && instrument.family !== 'keyboard'
      ? [
          {
            id: 'tuning',
            title: 'Tuning first',
            body: 'The readout under the staff names what it hears and shows how far sharp or flat. Play an open string into it before you start — a note scored against the wrong tuning is scored wrong.',
          },
        ]
      : []),
  ];
}
