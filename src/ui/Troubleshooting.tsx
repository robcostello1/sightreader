import * as Dialog from '@radix-ui/react-dialog';
import { recoverySteps } from '../lib/browser';

export interface TroubleshootingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * What to try when the scoring disagrees with what was played.
 *
 * Kept behind a link rather than said on the way in. Most of this is either
 * obvious or does not apply, and a page that warns about every way listening
 * can go wrong reads as an app that expects to get it wrong. It is here for the
 * player who has already noticed something and gone looking.
 */
export function Troubleshooting({ open, onOpenChange }: TroubleshootingProps) {
  const recovery = recoverySteps(typeof navigator === 'undefined' ? '' : navigator.userAgent);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal">
          <Dialog.Title>Troubleshooting</Dialog.Title>
          <Dialog.Description className="muted small">
            Listening happens on this device, and rooms differ. If the scoring does not match what
            you played, one of these is usually why.
          </Dialog.Description>

          <section className="trouble">
            <h3>Notes are marked wrong when they were right</h3>
            <p className="muted small">
              The microphone may be hearing the metronome as well as you. Wear headphones, or play
              a little louder, so that what you play is the loudest thing in the room. Moving away
              from the speakers helps too.
            </p>
          </section>

          <section className="trouble">
            <h3>Nothing is being heard at all</h3>
            <p className="muted small">
              Check that this page has the microphone, and that no other app has taken it — video
              calls tend to hold onto it. In {recovery.name}:
            </p>
            <ol className="steps muted small">
              {recovery.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <section className="trouble">
            <h3>Low notes come back an octave high</h3>
            <p className="muted small">
              Below about G3 the fundamental is often quieter than the harmonic an octave above it
              — both on the instrument and in a built-in microphone, which tends to thin out down
              there. Detection then hears the harmonic as the note. Playing those notes more
              firmly, picking nearer the neck than the bridge, or using a better microphone all
              give the fundamental more to stand on.
            </p>
          </section>

          <section className="trouble">
            <h3>Fast notes come back unscored</h3>
            <p className="muted small">
              Past a certain tempo a short note does not last long enough to be judged, and is left
              unscored rather than failed. Lower the tempo to bring those notes back.
            </p>
          </section>

          <p className="muted small">
            Nothing you play is recorded, stored, or sent anywhere. It is read on this device and
            discarded.
          </p>

          <div className="modal-actions">
            <Dialog.Close asChild>
              <button type="button">Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
