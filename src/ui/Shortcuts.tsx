import * as Dialog from '@radix-ui/react-dialog';
import { SHORTCUTS } from './keys';
import { Heading, Text } from './Text';

export interface ShortcutsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The keys, written out.
 *
 * Behind a link rather than printed under the controls: four keys is a page of
 * furniture for something most players learn once and then never read again.
 * The one that matters is offered where it is needed — the hint beside the
 * controls names Space, and this is what the hint opens onto.
 */
export function Shortcuts({ open, onOpenChange }: ShortcutsProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal">
          <Dialog.Title asChild>
            <Heading level={2}>Keyboard</Heading>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text tone="muted">
              Both hands are on an instrument, so the session can be run without
              reaching for the mouse.
            </Text>
          </Dialog.Description>

          <dl className="keys">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="key-row">
                <dt>
                  <kbd>{shortcut.keys}</kbd>
                </dt>
                <dd>{shortcut.action}</dd>
              </div>
            ))}
          </dl>

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
