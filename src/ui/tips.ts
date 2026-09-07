import { DEFAULT_PROGRESSION } from '../config/progression';
import type { InstrumentDefinition } from '../config/instruments';

export interface Tip {
  id: string;
  /** One sentence. Anything longer is a manual, and nobody came here to read one. */
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
      body: 'Space starts a session and holds it wherever it has got to; press ? for the other keys.',
    },
    ...(instrument.hasPositions
      ? [
          {
            id: 'range',
            body:
              instrument.id === 'guitar'
                ? 'Settings changes which part of the neck you read, from a four-fret position to the whole thing.'
                : 'Settings changes how much of the keyboard you read, from five notes under one hand to the full range.',
          },
        ]
      : []),
    {
      id: 'levelling',
      body: `${window} exercises averaging ${threshold}% moves you up a tenth of a level.`,
    },
    ...(scoring
      ? [
          {
            id: 'guide',
            body: 'Turn on Show guide note in Settings to see what the microphone is hearing on the staff.',
          },
        ]
      : []),
    ...(scoring && instrument.family !== 'keyboard'
      ? [
          {
            id: 'tuning',
            body: 'Tune to the readout below the staff first: it names the note it hears and shows how far off it is.',
          },
        ]
      : []),
  ];
}
