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

/** As a player who has already been through onboarding would arrive. */
function asReturning(permission = 'granted') {
  localStorage.setItem('sightreader.micPermission', JSON.stringify(permission));
  localStorage.setItem('sightreader.onboarded', JSON.stringify(true));
}

const explainerShown = () => screen.queryByRole('button', { name: /enable microphone/i }) !== null;
const pickerShown = () => screen.queryByText(/what are you playing/i) !== null;

describe('permission signposting', () => {
  it('does not touch the microphone before the player has been told why', async () => {
    render(<Lesson />);
    await settle();

    expect(startMicCapture).not.toHaveBeenCalled();
    expect(explainerShown()).toBe(true);
  });

  it('opens it on the button, then asks what is being played', async () => {
    render(<Lesson />);
    await settle();
    await click(/enable microphone/i);

    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(pickerShown()).toBe(true);
  });

  it('remembers both answers, so a returning player lands in the lesson', async () => {
    asReturning();
    render(<Lesson />);
    await settle();

    expect(explainerShown()).toBe(false);
    expect(pickerShown()).toBe(false);
    // Listening from load, as it did before there was an explainer.
    expect(startMicCapture).toHaveBeenCalledTimes(1);
  });

  it('explains again when access has lapsed, without asking for the instrument again', async () => {
    localStorage.setItem('sightreader.onboarded', JSON.stringify(true));
    render(<Lesson />);
    await settle();

    expect(explainerShown()).toBe(true);
    await click(/enable microphone/i);
    // Straight back to the lesson: the instrument was never in question.
    expect(pickerShown()).toBe(false);
    expect(explainerShown()).toBe(false);
  });
});

describe('changing instrument later', () => {
  it('reopens the picker from the settings, and takes the choice', async () => {
    asReturning();
    render(<Lesson />);
    await settle();

    await click(/^change$/i);
    expect(pickerShown()).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText('Flute'));
      await Promise.resolve();
    });
    await click(/^done$/i);

    expect(pickerShown()).toBe(false);
    expect(screen.getByText('Flute')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('sightreader.instrument') ?? '""')).toBe('flute');
  });
});

describe('without a microphone', () => {
  it('asks again on every startup until it is granted', async () => {
    // The likeliest reason to come back after a refusal is having gone and
    // fixed it in browser settings, which the app has to notice.
    asReturning('denied');
    render(<Lesson />);
    await settle();

    expect(explainerShown()).toBe(true);
    expect(screen.getByText(/scoring has been off/i)).toBeTruthy();
    // But not the instrument again — that answer does not go stale.
    expect(pickerShown()).toBe(false);
  });

  it('runs the lesson with scoring off once the player carries on', async () => {
    asReturning('denied');
    browserRefuses();
    render(<Lesson />);
    await settle();
    await click(/enable microphone/i);
    await click(/^continue$/i);

    expect(explainerShown()).toBe(false);
    expect(pickerShown()).toBe(false);
    expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy();
    expect(screen.getByText(/scoring is off/i)).toBeTruthy();

    // And the way back is the explanation again, not a silent retry.
    await click(/turn scoring on/i);
    expect(explainerShown()).toBe(true);
  });

  it('does not ask twice in one session', async () => {
    asReturning('denied');
    browserRefuses();
    render(<Lesson />);
    await settle();
    await click(/enable microphone/i);
    await click(/^continue$/i);

    // Changing something unrelated must not drag the ask back up.
    await click(/^change$/i);
    await click(/^done$/i);
    expect(explainerShown()).toBe(false);
  });
});
