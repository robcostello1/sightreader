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
 *
 * Written by symptom rather than by cause: someone arrives here having seen a
 * right note marked wrong, not having decided that their microphone is thin
 * below 200Hz. Which is also why the metronome and the octave errors sit under
 * one heading — they look identical from the outside.
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
            This app uses your system microphone to listen to you play. That can cause problems if
            it doesn&rsquo;t hear you well.
          </Dialog.Description>

          <section className="trouble">
            <h3>Correct Notes Show As Wrong</h3>
            <p className="muted small">
              The microphone may be picking up the metronome as well as you. Wear headphones, or
              play a bit louder than the metronome.
            </p>
            <p className="muted small">
              Low notes and quiet notes are harder to detect, and the system can show a note an
              octave out. Play clearly, avoid distortion, and stay near the microphone.
            </p>
          </section>

          <section className="trouble">
            <h3>No Sound Is Heard</h3>
            <p className="muted small">
              Check that this page has permission to use the microphone, and that no other app is
              holding onto it &mdash; video call apps often don&rsquo;t release it.
            </p>
            <p className="muted small">In {recovery.name}:</p>
            <ol className="steps muted small">
              {recovery.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <section className="trouble">
            <h3>Fast Notes Are Not Scored</h3>
            <p className="muted small">
              A short note at a high tempo doesn&rsquo;t last long enough for the system to judge
              it. Try decreasing the tempo.
            </p>
          </section>

          <section className="trouble">
            <h3>Privacy</h3>
            <p className="muted small">
              The system doesn&rsquo;t record, store, or send your audio anywhere. It&rsquo;s read
              on this device and discarded.
            </p>
          </section>

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
