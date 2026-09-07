import { DEFAULT_PROGRESSION } from '../config/progression';
import type { InstrumentDefinition } from '../config/instruments';

export interface Tip {
  id: string;
  /**
   * What the tip says. Short — anything longer is a manual, and nobody came
   * here to read one. A key in square brackets, `[Space]`, is drawn as a key.
   */
  body: string;
  /**
   * What the picture above the sentence is, for anyone who cannot see it. The
   * picture itself is a crop of the running app, one file per scheme under
   * public/tips, named for the tip — regenerate with
   * `node scripts/tip-shots.mjs` whenever the thing in shot changes.
   */
  shot: string;
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
      shot: 'The Pause and Stop buttons above the staff',
      body: 'Use the [Space] bar to start or pause. Press [?] to see other shortcuts.',
    },
    ...(instrument.hasPositions
      ? [
          {
            id: 'range',
      shot: 'The instrument and range dropdowns inside Settings',
            body:
              instrument.id === 'guitar'
                ? 'Settings changes which part of the neck you read, from a four-fret position to the whole thing.'
                : 'Settings changes how much of the keyboard you read, from five notes under one hand to the full range.',
          },
        ]
      : []),
    {
      id: 'levelling',
      shot: 'The Levelling up card, showing a row of five slots',
      body: `You level up a little each time you hit ${threshold}% ${window} times in a row.`,
    },
    ...(scoring
      ? [
          {
            id: 'guide',
      shot: 'A staff with a faint guide note beside the note being read',
            body: 'Turn on \u201cShow guide note\u201d in Settings to see what note you\u2019re playing.',
          },
        ]
      : []),
    ...(scoring && instrument.family !== 'keyboard'
      ? [
          {
            id: 'tuning',
      shot: 'The note readout and its tuning meter, below the staff',
            body: 'You can use the note readout to tune your instrument.',
          },
        ]
      : []),
  ];
}
