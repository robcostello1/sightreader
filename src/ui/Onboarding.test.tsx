// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Onboarding, type OnboardingProps } from './Onboarding';
import { INSTRUMENTS } from '../config/instruments';

afterEach(cleanup);

/** Clicks, then lets the request promise and the state it sets settle. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

const grants = () => vi.fn().mockResolvedValue({ granted: true });
const refuses = () =>
  vi.fn().mockResolvedValue({
    granted: false,
    cause: new DOMException('no', 'NotAllowedError'),
  });

function setup(overrides: Partial<OnboardingProps> = {}) {
  const props: OnboardingProps = {
    open: true,
    request: grants(),
    permission: 'unknown',
    onPermission: vi.fn(),
    needsInstrument: true,
    instrumentId: 'guitar',
    positionId: null,
    onInstrument: vi.fn(),
    onPosition: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
  const view = render(<Onboarding {...props} />);
  return { props, rerender: (next: Partial<OnboardingProps>) =>
    view.rerender(<Onboarding {...props} {...next} />) };
}

const button = (name: RegExp) => screen.getByRole('button', { name });
const instrumentSelect = () => screen.getByLabelText(/what are you playing/i);
const startButton = () => button(/start reading/i);

describe('the checklist', () => {
  it('stays out of the way when there is nothing to ask', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cannot be dismissed except by answering it', async () => {
    const { props } = setup();
    // No close control, and escape does nothing: skipping is an answer, not an
    // escape hatch, so it has to be chosen.
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('will not let go until both items are answered', async () => {
    const { props, rerender } = setup();
    expect(startButton().hasAttribute('disabled')).toBe(true);

    // The microphone alone is not enough.
    await click(button(/enable microphone/i));
    rerender({ permission: 'granted' });
    expect(startButton().hasAttribute('disabled')).toBe(true);

    fireEvent.change(instrumentSelect(), { target: { value: 'flute' } });
    expect(props.onInstrument).toHaveBeenCalledWith('flute');
    expect(startButton().hasAttribute('disabled')).toBe(false);

    await click(startButton());
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });
});

describe('the microphone item', () => {
  it('explains the ask before anything reaches the browser', () => {
    const { props } = setup();

    // Nothing may touch getUserMedia on render: the whole point is that the
    // native dialog arrives only after the player has read why.
    expect(props.request).not.toHaveBeenCalled();
    expect(screen.getByText(/nothing is recorded/i)).toBeTruthy();
  });

  it('asks the browser when the player presses the button', async () => {
    const { props } = setup();
    await click(button(/enable microphone/i));

    expect(props.request).toHaveBeenCalledTimes(1);
    expect(props.onPermission).toHaveBeenCalledWith('granted');
  });

  it('warns rather than silently accepting a skip', async () => {
    const { props } = setup();
    await click(button(/^skip$/i));

    expect(props.request).not.toHaveBeenCalled();
    expect(screen.getByText(/nothing is scored/i)).toBeTruthy();
    // Still offered afterwards: skipping is not a door closing.
    expect(button(/enable microphone/i)).toBeTruthy();
  });

  it('says what a refusal costs and how to undo it', async () => {
    const { props } = setup({ request: refuses() });
    await click(button(/enable microphone/i));

    expect(props.onPermission).toHaveBeenCalledWith('denied');
    expect(screen.getByText(/blocked the microphone/i)).toBeTruthy();
    // jsdom names no browser it recognises, so this is the generic advice.
    expect(screen.getByText(/reload the page/i)).toBeTruthy();

    // A refusal is an answer: with the instrument chosen, the way out is open.
    fireEvent.change(instrumentSelect(), { target: { value: 'flute' } });
    expect(startButton().hasAttribute('disabled')).toBe(false);
  });

  it('does not record a refusal when there was simply no microphone', async () => {
    // Nothing was refused, so nothing should be remembered — plugging an
    // interface in and pressing again is the whole recovery.
    const { props } = setup({
      request: vi.fn().mockResolvedValue({
        granted: false,
        cause: new DOMException('none', 'NotFoundError'),
      }),
    });
    await click(button(/enable microphone/i));

    expect(props.onPermission).not.toHaveBeenCalled();
    expect(screen.queryByText(/blocked the microphone/i)).toBeNull();
  });

  it('is settled already when access is granted', () => {
    setup({ permission: 'granted' });
    expect(screen.queryByRole('button', { name: /enable microphone/i })).toBeNull();
    expect(screen.getByText(/scoring is on/i)).toBeTruthy();
  });
});

describe('the instrument item', () => {
  it('lists every instrument, grouped, with piano and guitar first', () => {
    setup();
    const options = within(instrumentSelect()).getAllByRole('option');
    const names = options.map((option) => option.textContent);

    // "Choose…" first, then the two most people arrive holding.
    expect(names[1]).toBe('Piano');
    expect(names[2]).toBe('Guitar');
    for (const instrument of INSTRUMENTS) {
      expect(names.some((name) => name?.startsWith(instrument.name))).toBe(true);
    }
  });

  it('shows what is not supported yet rather than hiding it', () => {
    setup();
    const options = within(instrumentSelect()).getAllByRole('option');
    // An absent instrument reads as an app that does not cover you; a disabled
    // one reads as an app that knows what it does not do yet.
    for (const instrument of INSTRUMENTS.filter((i) => i.status === 'comingSoon')) {
      const option = options.find((o) => o.textContent?.startsWith(instrument.name));
      expect(option?.hasAttribute('disabled')).toBe(true);
      expect(option?.textContent).toMatch(/coming soon/i);
    }
  });

  it('offers a starting range only where there is one to choose, and only once picked', () => {
    const { rerender } = setup();
    expect(screen.queryByLabelText(/starting/i)).toBeNull();

    fireEvent.change(instrumentSelect(), { target: { value: 'guitar' } });
    rerender({ instrumentId: 'guitar' });
    expect(screen.getByLabelText(/starting position/i)).toBeTruthy();

    fireEvent.change(instrumentSelect(), { target: { value: 'flute' } });
    rerender({ instrumentId: 'flute' });
    expect(screen.queryByLabelText(/starting/i)).toBeNull();
  });

  it('is not asked again once it has been answered', () => {
    setup({ needsInstrument: false, permission: 'granted' });
    expect(screen.queryByLabelText(/what are you playing/i)).toBeNull();
    // Only the microphone was owed, and it is settled, so the way out is open.
    expect(startButton().hasAttribute('disabled')).toBe(false);
  });
});
