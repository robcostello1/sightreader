import { useEffect, useState } from 'react';
import { loadSetting, saveSetting } from '../lib/storage';
import type { InstrumentDefinition } from '../config/instruments';
import { tipsFor } from './tips';
import shotSizes from './tip-shots.json';
import { Heading } from './Text';

const readIndex = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;

export interface TipsProps {
  instrument: InstrumentDefinition;
  scoring: boolean;
  /** Opens the full shortcut list, which the first tip points at. */
  onKeys: () => void;
}

/**
 * One tip, in the space the notation will take.
 *
 * It sits where the music goes because that is the only part of the screen that
 * is empty while nothing is playing, and it leaves as soon as there is an
 * exercise to draw. Transparent, on a hairline: it is a note in the margin, not
 * another panel competing with the two that are already there.
 *
 * Which tip comes up advances every time the idle screen is reached, so someone
 * who comes back tomorrow gets a different one. It starts at the controls,
 * because the first thing worth knowing is how to start without the mouse.
 */
export function Tips({ instrument, scoring, onKeys }: TipsProps) {
  const tips = tipsFor(instrument, scoring);
  const [start] = useState(() => loadSetting('tipIndex', readIndex, 0));
  const [offset, setOffset] = useState(0);

  useEffect(() => saveSetting('tipIndex', start + 1), [start]);

  const tip = tips[(start + offset) % tips.length];
  // Taken at twice this, for a retina screen. Drawn at the size the control
  // actually is, so it is recognisable as the same control. A tip with no entry
  // draws its picture at whatever size it is rather than taking the page down
  // with it — tips.test.tsx is what stops that shipping.
  const size = shotSizes[tip.id as keyof typeof shotSizes] ?? { width: undefined, height: undefined };

  return (
    <aside className="tip" aria-label="Tip">
      <Heading level={2} size="small">
        Tip
      </Heading>
      {/* The thing itself, rather than directions to it. Both crops are in the
          markup and CSS draws the one this scheme wants — a media query alone
          would ignore the player's own light/dark choice, which outranks the
          system's. Only one carries the alt text; two would read it twice. */}
      <span className="tip-shot">
        <img
          className="on-light"
          src={`/tips/${tip.id}-light.png`}
          alt={tip.shot}
          width={size.width}
          height={size.height}
        />
        <img
          className="on-dark"
          src={`/tips/${tip.id}-dark.png`}
          alt=""
          width={size.width}
          height={size.height}
        />
      </span>
      <p className="tip-body">
        {tip.body.split(/\[([^\]]+)\]/).map((part, i) =>
          // The odd parts are what was inside the brackets: keys, drawn as keys.
          i % 2 === 1 ? <kbd key={i}>{part}</kbd> : part,
        )}
      </p>
      <div className="tip-actions">
        {tip.id === 'controls' && (
          <button type="button" className="link" onClick={onKeys}>
            All shortcuts
          </button>
        )}
        <button
          type="button"
          className="link tip-next"
          onClick={() => setOffset(offset + 1)}
        >
          Next tip
        </button>
      </div>
    </aside>
  );
}
