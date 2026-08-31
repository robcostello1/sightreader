// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startMicCapture = vi.hoisted(() => vi.fn());
vi.mock('../audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../audio')>()),
  startMicCapture,
}));

const { Lesson } = await import('./Lesson');

beforeEach(() => {
  localStorage.clear();
  startMicCapture.mockReset();
  startMicCapture.mockImplementation(
    async () =>
      ({
        context: { currentTime: 0, state: 'running' },
        // The waveform reads this every frame; without it the rAF loop throws
        // after the test has moved on.
        analyser: { fftSize: 1024, getFloatTimeDomainData: () => {} },
        sampleRate: 44100,
        stop: async () => {},
      }) as never,
  );
});

afterEach(cleanup);

/** Lets effects and the mic promise settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Makes the browser refuse, as it does once a site has been blocked. */
function browserRefuses() {
  startMicCapture.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
}

/** As a player who has already been through the checklist would arrive. */
function asReturning(permission = 'granted') {
  localStorage.setItem('sightreader.micPermission', JSON.stringify(permission));
  localStorage.setItem('sightreader.onboarded', JSON.stringify(true));
}

const modalShown = () => screen.queryByRole('dialog') !== null;
const instrumentAsked = () => screen.queryByLabelText(/what are you playing/i) !== null;

/** Answers the instrument item, which the checklist will not let go without. */
function chooseInstrument(id: string) {
  fireEvent.change(screen.getByLabelText(/what are you playing/i), { target: { value: id } });
}

describe('the checklist', () => {
  it('does not touch the microphone before the player has been told why', async () => {
    render(<Lesson />);
    await settle();

    expect(startMicCapture).not.toHaveBeenCalled();
    expect(modalShown()).toBe(true);
    // The app is behind it, not replaced by it.
    expect(document.querySelector('.layout')).not.toBeNull();
  });

  it('opens the microphone on the button and lets go once both are answered', async () => {
    render(<Lesson />);
    await settle();

    await click(/enable microphone/i);
    expect(startMicCapture).toHaveBeenCalledTimes(1);

    chooseInstrument('flute');
    await click(/^go$/i);

    expect(modalShown()).toBe(false);
    expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy();
  });

  it('does not switch the microphone on just because a previous visit allowed it', async () => {
    // Permission granted, but the checklist has not been answered: turning the
    // microphone on the moment the page loads is the player's call, not ours.
    localStorage.setItem('sightreader.micPermission', JSON.stringify('granted'));
    render(<Lesson />);
    await settle();

    expect(modalShown()).toBe(true);
    expect(startMicCapture).not.toHaveBeenCalled();

    chooseInstrument('flute');
    await click(/^go$/i);
    await settle();
    expect(startMicCapture).toHaveBeenCalledTimes(1);
  });

  it('remembers both answers, so a returning player lands in the lesson', async () => {
    asReturning();
    render(<Lesson />);
    await settle();

    expect(modalShown()).toBe(false);
    // Listening from load, as it did before there was a checklist.
    expect(startMicCapture).toHaveBeenCalledTimes(1);
  });
});

describe('without a microphone', () => {
  it('asks again on every startup until it is granted', async () => {
    // The likeliest reason to come back after a refusal is having gone and
    // fixed it in browser settings, which the app has to notice.
    asReturning('denied');
    render(<Lesson />);
    await settle();

    expect(modalShown()).toBe(true);
    // But not the instrument again — that answer does not go stale.
    expect(instrumentAsked()).toBe(false);
  });

  it('runs the lesson with scoring off once the player skips', async () => {
    render(<Lesson />);
    await settle();

    await click(/^skip$/i);
    chooseInstrument('flute');
    await click(/^go$/i);

    expect(modalShown()).toBe(false);
    expect(startMicCapture).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy();
    expect(screen.getByText(/scoring is off/i)).toBeTruthy();

    // And the way back is the checklist again, not a silent retry.
    await click(/turn scoring on/i);
    expect(modalShown()).toBe(true);
  });

  it('does not ask twice in one session', async () => {
    asReturning('denied');
    browserRefuses();
    render(<Lesson />);
    await settle();

    await click(/enable microphone/i);
    await click(/^go$/i);
    expect(modalShown()).toBe(false);

    // Changing something unrelated must not drag the checklist back up.
    fireEvent.change(screen.getByLabelText(/^instrument$/i), { target: { value: 'flute' } });
    await settle();
    expect(modalShown()).toBe(false);
  });
});

describe('changing instrument later', () => {
  it('is a dropdown in the sidebar, and persists', async () => {
    asReturning();
    render(<Lesson />);
    await settle();

    fireEvent.change(screen.getByLabelText(/^instrument$/i), { target: { value: 'flute' } });
    await settle();

    expect(JSON.parse(localStorage.getItem('sightreader.instrument') ?? '""')).toBe('flute');
  });
});

describe('appearance', () => {
  it('overrides the system scheme, and remembers which', async () => {
    asReturning();
    render(<Lesson />);
    await settle();

    fireEvent.change(screen.getByLabelText(/appearance/i), { target: { value: 'light' } });
    await settle();

    // The stylesheet keys color-scheme off this, and light-dark() follows it.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(JSON.parse(localStorage.getItem('sightreader.theme') ?? '""')).toBe('light');

    fireEvent.change(screen.getByLabelText(/appearance/i), { target: { value: 'system' } });
    await settle();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('the settings panel', () => {
  it('keeps difficulty and tempo out, and folds the rest away', async () => {
    asReturning();
    render(<Lesson />);
    await settle();

    const settings = screen.getByText('Settings').closest('details');
    expect(settings).not.toBeNull();
    // Closed on arrival: these are set once, not reached for mid-session.
    expect(settings!.open).toBe(false);

    // The two that change what an exercise is like stay in the open.
    for (const label of [/^difficulty/i, /^tempo/i]) {
      expect(screen.getByLabelText(label).closest('details')).toBeNull();
    }
    // Everything else is inside it.
    for (const label of [/^instrument$/i, /appearance/i, /auto-advance/i]) {
      expect(screen.getByLabelText(label).closest('details')).toBe(settings);
    }
  });

  it('switches the heard note on the staff off, and remembers', async () => {
    asReturning();
    render(<Lesson />);
    await settle();

    const toggle = screen.getByLabelText(/guide note/i);
    expect((toggle as HTMLInputElement).checked).toBe(true);

    fireEvent.click(toggle);
    await settle();
    expect(JSON.parse(localStorage.getItem('sightreader.showHeard') ?? 'null')).toBe(false);
  });
});
