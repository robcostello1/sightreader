import { useState } from 'react';
import { isPermissionDenial, type MicPermission } from '../audio';
import { InstrumentPicker } from './InstrumentPicker';
import type { MicRequest } from './useLesson';

export interface OnboardingProps {
  /** Opens the microphone. Must be called from the click, not from an effect. */
  request: () => Promise<MicRequest>;
  /** Records what the browser decided, as soon as it decides. */
  onPermission: (permission: MicPermission) => void;
  /** Whether the instrument step is still owed; false when only access lapsed. */
  needsInstrument: boolean;
  instrumentId: string;
  positionId: string | null;
  onInstrument: (id: string) => void;
  onPosition: (id: string | null) => void;
  /** Every step done; the lesson can run. */
  onDone: () => void;
}

type Stage = 'explainer' | 'blocked' | 'instrument';

/**
 * The steps before the first exercise.
 *
 * A native permission dialog with no preamble gets a reflexive Block — it
 * arrives unasked, in the browser's words rather than the app's, and refusing
 * is the safe move. So the ask is explained first, in the app's own voice, and
 * the browser is only reached through a button the player pressed on purpose.
 *
 * Instrument comes after, not before: it is the question you can only answer
 * once you know the app is going to listen to you play.
 */
export function Onboarding({
  request,
  onPermission,
  needsInstrument,
  instrumentId,
  positionId,
  onInstrument,
  onPosition,
  onDone,
}: OnboardingProps) {
  const [stage, setStage] = useState<Stage>('explainer');
  const [busy, setBusy] = useState(false);

  const settled = () => {
    if (needsInstrument) setStage('instrument');
    else onDone();
  };

  const enable = () => {
    setBusy(true);
    void request().then((result) => {
      setBusy(false);
      if (result.granted) {
        onPermission('granted');
        settled();
        return;
      }
      // Only a refusal is worth remembering; no device, or a device held by
      // something else, is worth trying again.
      setStage('blocked');
      if (isPermissionDenial(result.cause)) onPermission('denied');
    });
  };

  if (stage === 'instrument') {
    return (
      <section className="onboarding onboarding-wide">
        <h2>What are you playing?</h2>
        <p className="muted">
          It sets the clef, the octave and — for a transposing instrument — the key you read in.
          You can change it later.
        </p>
        <InstrumentPicker
          instrumentId={instrumentId}
          positionId={positionId}
          onInstrument={onInstrument}
          onPosition={onPosition}
        />
        <button type="button" className="primary" onClick={onDone}>
          Start reading
        </button>
      </section>
    );
  }

  return (
    <section className="onboarding">
      <h2>Sightreader listens while you play</h2>
      <p>
        Reading is scored by ear: the app follows the notes you play through your microphone and
        marks each one as it goes.
      </p>
      <ul className="reassurance">
        <li>Pitch is worked out on this device, frame by frame.</li>
        <li>Nothing is recorded, stored, or sent anywhere.</li>
        <li>Your browser can withdraw access at any time.</li>
      </ul>

      {stage === 'blocked' && (
        <p className="warning">
          Your browser did not allow the microphone. Nothing has been lost — you can ask it again.
        </p>
      )}

      <button type="button" className="primary" onClick={enable} disabled={busy}>
        {busy ? 'Waiting for your browser…' : stage === 'blocked' ? 'Try again' : 'Enable microphone'}
      </button>
    </section>
  );
}
