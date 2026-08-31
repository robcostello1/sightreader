import * as Dialog from '@radix-ui/react-dialog';
import { recoverySteps } from '../lib/browser';
import type { InstrumentDefinition } from '../config/instruments';
import { Heading, List, Text } from './Text';

export interface TroubleshootingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being played, for the advice that only applies to some of them. */
  instrument?: InstrumentDefinition;
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
 *
 * Set at reading size throughout. It is the one part of the app that is prose
 * rather than interface, and the only place anyone stops to read a paragraph.
 */
export function Troubleshooting({ open, onOpenChange, instrument }: TroubleshootingProps) {
  const recovery = recoverySteps(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  // Amplified, and with a fretboard to move up. Everyone else is told to move
  // nearer the microphone, which is the whole of the advice that applies.
  const amplified = instrument?.family === 'fretted';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal">
          <Dialog.Title asChild>
            <Heading level={2}>Troubleshooting</Heading>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text tone="muted">
              This app uses your system microphone to listen to you play. That can cause problems
              if it doesn&rsquo;t hear you well.
            </Text>
          </Dialog.Description>

          <section className="trouble">
            <Heading level={3}>Correct Notes Show As Wrong</Heading>
            <Text tone="muted">
              The microphone may be picking up the metronome as well as you. Wear headphones, or
              play a bit louder than the metronome.
            </Text>
            <Text tone="muted">
              Low notes and quiet notes are harder to detect, and the system can show a note an
              octave out. Play clearly, avoid distortion, and stay near the microphone.
            </Text>
            {amplified && (
              <Text tone="muted">
                Small practice amps often have little output at the bottom of their range, which
                has the same effect. If you are using one, try choosing a higher fretboard position
                in Settings.
              </Text>
            )}
          </section>

          <section className="trouble">
            <Heading level={3}>No Sound Is Heard</Heading>
            <Text tone="muted">
              Check that this page has permission to use the microphone, and that no other app is
              holding onto it &mdash; video call apps often don&rsquo;t release it.
            </Text>
            <Text tone="muted">In {recovery.name}:</Text>
            <List as="ol" tone="muted" className="steps">
              {recovery.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </List>
          </section>

          <section className="trouble">
            <Heading level={3}>Fast Notes Are Not Scored</Heading>
            <Text tone="muted">
              Depending on device, instrument and environment, a short note at a high tempo may not
              last long enough for the system to judge it. Try decreasing the tempo.
            </Text>
          </section>

          <section className="trouble">
            <Heading level={3}>Privacy</Heading>
            <Text tone="muted">
              The system doesn&rsquo;t record, store, or send your audio anywhere. It&rsquo;s read
              on this device and discarded.
            </Text>
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
