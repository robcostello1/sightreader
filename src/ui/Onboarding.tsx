import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { isPermissionDenial, type MicPermission } from '../audio';
import { INSTRUMENT_FAMILIES, INSTRUMENTS, instrumentById, positionById } from '../config/instruments';
import { recoverySteps } from '../lib/browser';
import type { MicRequest } from './useLesson';
import { Heading, List, Text } from './Text';

export interface OnboardingProps {
  open: boolean;
  /** Opens the microphone. Must be called from the click, not from an effect. */
  request: () => Promise<MicRequest>;
  /** What the browser has said so far, and where to record what it says next. */
  permission: MicPermission;
  onPermission: (permission: MicPermission) => void;
  /** Whether the instrument is still to be chosen; it is asked once ever. */
  needsInstrument: boolean;
  instrumentId: string;
  positionId: string | null;
  onInstrument: (id: string) => void;
  onPosition: (id: string | null) => void;
  /** Both items settled; the lesson can run. */
  onDone: () => void;
}

/**
 * Everything asked before the first exercise, as one checklist over the app.
 *
 * A native permission dialog with no preamble gets a reflexive Block — it
 * arrives unasked, in the browser's words rather than the app's, and refusing
 * is the safe move. So the ask is explained first, and the browser is only
 * reached through a button the player pressed on purpose.
 *
 * Both items sit on one screen rather than being paced across several: there
 * are only two, one has a sensible answer already, and a player who can see the
 * whole list knows how far there is to go.
 */
export function Onboarding({
  open,
  request,
  permission,
  onPermission,
  needsInstrument,
  instrumentId,
  positionId,
  onInstrument,
  onPosition,
  onDone,
}: OnboardingProps) {
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // An instrument already chosen is not asked about again; a new one starts
  // unset, so the list is answered rather than defaulted past.
  const [picked, setPicked] = useState(!needsInstrument);

  const instrument = instrumentById(instrumentId);
  const position = positionById(instrument, positionId);
  const granted = permission === 'granted';
  // Every item answered: the microphone one way or the other, the instrument
  // by an actual choice. There is no other way out of the dialog.
  const ready = (granted || skipped) && picked;

  const enable = () => {
    setBusy(true);
    void request().then((result) => {
      setBusy(false);
      if (result.granted) {
        onPermission('granted');
        setSkipped(false);
        setBlocked(false);
        return;
      }
      // Only a refusal is worth remembering; no device, or one held by another
      // app, is worth simply trying again.
      if (isPermissionDenial(result.cause)) {
        onPermission('denied');
        setBlocked(true);
      }
      setSkipped(true);
    });
  };

  const recovery = recoverySteps(typeof navigator === 'undefined' ? '' : navigator.userAgent);

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        {/* No close button, and no dismissing by clicking away: the way out is
            the checklist, and skipping is one of its answers. */}
        <Dialog.Content
          className="modal"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title asChild>
            <Heading level={2}>Before you start</Heading>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text tone="muted">Two things, then you are reading.</Text>
          </Dialog.Description>

          <ol className="checklist">
            <li className={granted ? 'is-done' : skipped ? 'is-warned' : ''}>
              <Heading level={3}>
                <span className="check-mark" aria-hidden="true">
                  {granted ? '✓' : skipped ? '!' : '○'}
                </span>
                Microphone
              </Heading>

              {granted ? (
                <Text tone="muted">
                  Scoring is on. Pitch is worked out on this device; nothing is recorded or sent.
                </Text>
              ) : (
                <>
                  <Text tone="muted">
                    Scoring listens to what you play. Pitch is worked out on this device — nothing
                    is recorded, stored, or sent anywhere.
                  </Text>

                  {skipped && (
                    <Text tone="warning">
                      {blocked
                        ? 'Your browser blocked the microphone. Exercises still run, but nothing is scored.'
                        : 'Without it, exercises still run but nothing is scored.'}
                    </Text>
                  )}

                  {blocked && (
                    <List as="ol" tone="muted" className="steps">
                      {recovery.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </List>
                  )}

                  <div className="check-actions">
                    <button type="button" onClick={enable} disabled={busy}>
                      {busy ? 'Waiting for your browser…' : 'Enable microphone'}
                    </button>
                    {!skipped && (
                      <button type="button" onClick={() => setSkipped(true)}>
                        Skip
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>

            {needsInstrument && (
            <li className={picked ? 'is-done' : ''}>
              <Heading level={3}>
                <span className="check-mark" aria-hidden="true">
                  {picked ? '✓' : '○'}
                </span>
                Instrument
              </Heading>

              <label className="field">
                <span className="field-label">What are you playing?</span>
                <select
                  value={picked ? instrumentId : ''}
                  onChange={(event) => {
                    setPicked(true);
                    onInstrument(event.target.value);
                    // Positions belong to an instrument; the old one means
                    // nothing here.
                    onPosition(null);
                  }}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {INSTRUMENT_FAMILIES.map((family) => (
                    <optgroup key={family.id} label={family.label}>
                      {INSTRUMENTS.filter((option) => option.family === family.id).map((option) => (
                        <option
                          key={option.id}
                          value={option.id}
                          disabled={option.status === 'comingSoon'}
                        >
                          {option.name}
                          {option.status === 'comingSoon' ? ' — coming soon' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              {picked && instrument.positions && (
                <label className="field">
                  <span className="field-label">
                    Starting {instrument.id === 'guitar' ? 'position' : 'range'}
                  </span>
                  <select
                    value={position?.id ?? ''}
                    onChange={(event) => onPosition(event.target.value)}
                  >
                    {instrument.positions.map((option) => (
                      <option
                        key={option.id}
                        value={option.id}
                        disabled={option.status === 'comingSoon'}
                      >
                        {option.label}
                        {option.status === 'comingSoon' ? ' — coming soon' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
            )}
          </ol>

          <div className="modal-actions">
            <button type="button" className="primary" onClick={onDone} disabled={!ready}>
              Go
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
