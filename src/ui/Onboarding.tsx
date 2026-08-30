import { useState } from 'react';
import { isPermissionDenial, type MicPermission } from '../audio';
import type { MicRequest } from './useLesson';

export interface OnboardingProps {
  /** Opens the microphone. Must be called from the click, not from an effect. */
  request: () => Promise<MicRequest>;
  /** Called once the player is through, with what the browser decided. */
  onDone: (permission: MicPermission) => void;
}

type Stage = 'explainer' | 'blocked';

/**
 * The screen before the microphone prompt.
 *
 * A native permission dialog with no preamble gets a reflexive Block — it
 * arrives unasked, in the browser's words rather than the app's, and refusing
 * is the safe move. So the ask is explained first, in the app's own voice, and
 * the browser is only reached through a button the player pressed on purpose.
 */
export function Onboarding({ request, onDone }: OnboardingProps) {
  const [stage, setStage] = useState<Stage>('explainer');
  const [busy, setBusy] = useState(false);

  const enable = () => {
    setBusy(true);
    void request().then((result) => {
      setBusy(false);
      if (result.granted) {
        onDone('granted');
        return;
      }
      // Only a refusal is worth remembering; no device, or a device held by
      // something else, is worth trying again.
      setStage('blocked');
      if (isPermissionDenial(result.cause)) onDone('denied');
    });
  };

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
