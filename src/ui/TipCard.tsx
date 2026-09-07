import { useEffect, useState } from 'react';
import type { InstrumentDefinition } from '../config/instruments';
import { WELCOME, tipsFor } from './tips';
import shotSizes from './tip-shots.json';
import { Heading } from './Text';

export interface TipsProps {
  instrument: InstrumentDefinition;
  scoring: boolean;
  /** Opens the full shortcut list, which the tip about the keys points at. */
  onKeys: () => void;
  /** Whether the greeting is still owed. False once it has been given. */
  welcome: boolean;
  /** Called when it has been, so it is not given twice in one visit. */
  onWelcomed: () => void;
}

/**
 * One tip, in the space the notation will take.
 *
 * It sits where the music goes because that is the only part of the screen that
 * is empty while nothing is playing, and it leaves as soon as there is an
 * exercise to draw. Transparent, on a hairline: it is a note in the margin, not
 * another panel competing with the two that are already there.
 *
 * The card is unmounted and rebuilt every time an exercise starts and stops, so
 * which tip it opens on is not its own to remember — the greeting is owed once
 * a visit and the lesson holds that, and the tip after it is drawn at random,
 * which is what stops the same one greeting every stop of a long session.
 */
export function Tips({ instrument, scoring, onKeys, welcome, onWelcomed }: TipsProps) {
  const tips = tipsFor(instrument, scoring);
  // Taken once, at the mount: telling the lesson the greeting has been given
  // comes straight back as a prop, and reading the prop would swap the card out
  // from under the greeting on the very next render.
  const [greeting] = useState(welcome);
  const [from] = useState(() => Math.floor(Math.random() * tips.length));
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (welcome) onWelcomed();
    // Once per appearance of the greeting, not once per render of the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tip = greeting && offset === 0 ? WELCOME : tips[(from + offset) % tips.length];
  // Taken at twice this, for a retina screen. Drawn at the size the control
  // actually is, so it is recognisable as the same control. A tip with no entry
  // draws its picture at whatever size it is rather than taking the page down
  // with it — tips.test.tsx is what stops that shipping.
  const size = shotSizes[tip.id as keyof typeof shotSizes] ?? { width: undefined, height: undefined };

  return (
    <aside className="tip" aria-label={tip.title ?? 'Tip'}>
      <Heading level={2} size="small">
        {tip.title ?? 'Tip'}
      </Heading>
      {/* The thing itself, rather than directions to it. Both crops are in the
          markup and CSS draws the one this scheme wants — a media query alone
          would ignore the player's own light/dark choice, which outranks the
          system's. Only one carries the alt text; two would read it twice. */}
      {tip.shot && (
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
      )}
      <p className="tip-body">
        {tip.body.split(/\[([^\]]+)\]/).map((part: string, i: number) =>
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
