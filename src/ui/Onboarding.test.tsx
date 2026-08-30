// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    request: grants(),
    onPermission: vi.fn(),
    needsInstrument: true,
    instrumentId: 'guitar',
    positionId: null,
    onInstrument: vi.fn(),
    onPosition: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
  render(<Onboarding {...props} />);
  return props;
}

const enableButton = () => screen.getByRole('button', { name: /enable microphone/i });

/** The tile for one instrument, found by its exact name — "Guitar" is not "Bass guitar". */
function tileFor(name: string): HTMLButtonElement {
  const tile = screen.getByText(name).closest('button');
  if (tile === null) throw new Error(`no tile for ${name}`);
  return tile;
}

describe('permission step', () => {
  it('explains the ask before anything reaches the browser', () => {
    const props = setup();

    // Nothing may touch getUserMedia on render: the whole point is that the
    // native dialog arrives only after the player has read why.
    expect(props.request).not.toHaveBeenCalled();
    expect(screen.getByText(/nothing is recorded/i)).toBeTruthy();
  });

  it('asks the browser when the player presses the button', async () => {
    const props = setup();
    await click(enableButton());

    expect(props.request).toHaveBeenCalledTimes(1);
    expect(props.onPermission).toHaveBeenCalledWith('granted');
  });

  it('says so when the browser refuses, and offers another go', async () => {
    const props = setup({ request: refuses() });
    await click(enableButton());

    expect(props.onPermission).toHaveBeenCalledWith('denied');
    expect(screen.getByText(/did not allow the microphone/i)).toBeTruthy();

    await click(screen.getByRole('button', { name: /try again/i }));
    expect(props.request).toHaveBeenCalledTimes(2);
  });

  it('does not record a refusal when there was simply no microphone', async () => {
    // Nothing was refused, so nothing should be remembered — plugging an
    // interface in and pressing again is the whole recovery.
    const props = setup({
      request: vi.fn().mockResolvedValue({
        granted: false,
        cause: new DOMException('none', 'NotFoundError'),
      }),
    });
    await click(enableButton());

    expect(props.onPermission).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('goes straight through when only access had lapsed', async () => {
    // Already onboarded, so there is no instrument to pick — just the
    // explanation the revoked microphone deserves.
    const props = setup({ needsInstrument: false });
    await click(enableButton());

    expect(props.onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/what are you playing/i)).toBeNull();
  });
});

describe('instrument step', () => {
  async function reachPicker(overrides: Partial<OnboardingProps> = {}) {
    const props = setup(overrides);
    await click(enableButton());
    return props;
  }

  it('follows the permission step, not the other way round', async () => {
    await reachPicker();
    expect(screen.getByText(/what are you playing/i)).toBeTruthy();
  });

  it('lists every instrument, grouped by family', async () => {
    await reachPicker();

    for (const instrument of INSTRUMENTS) {
      expect(tileFor(instrument.name)).toBeTruthy();
    }
    for (const family of ['Fretted', 'Bowed strings', 'Woodwind', 'Brass', 'Keyboard']) {
      expect(screen.getByRole('heading', { name: family })).toBeTruthy();
    }
  });

  it('shows what is not supported yet rather than hiding it', async () => {
    await reachPicker();

    // An absent instrument reads as an app that does not cover you; a disabled
    // one reads as an app that knows what it does not do yet.
    const gated = INSTRUMENTS.filter((i) => i.status === 'comingSoon');
    expect(gated.length).toBeGreaterThan(0);
    for (const instrument of gated) {
      const tile = tileFor(instrument.name);
      expect(tile.hasAttribute('disabled')).toBe(true);
      expect(tile.textContent).toMatch(/coming soon/i);
    }
  });

  it('reports a choice, and clears the position it does not belong to', async () => {
    const props = await reachPicker();
    await click(tileFor('Flute'));

    expect(props.onInstrument).toHaveBeenCalledWith('flute');
    expect(props.onPosition).toHaveBeenCalledWith(null);
  });

  it('offers a range only for the instrument that has one, and only once picked', async () => {
    await reachPicker({ instrumentId: 'flute' });
    expect(screen.queryByRole('combobox')).toBeNull();

    cleanup();
    await reachPicker({ instrumentId: 'guitar' });
    // Guitar is selected, so its fretboard positions are there to choose from.
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.getByText(/fretboard position/i)).toBeTruthy();
  });

  it('finishes when the player says so', async () => {
    const props = await reachPicker();
    await click(screen.getByRole('button', { name: /start reading/i }));
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });
});
