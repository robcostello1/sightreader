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
        analyser: { fftSize: 1024 },
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

describe('permission signposting', () => {
  it('does not touch the microphone before the player has been told why', async () => {
    render(<Lesson />);
    await settle();

    expect(startMicCapture).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /enable microphone/i })).toBeTruthy();
  });

  it('opens it on the button, and lets the lesson through', async () => {
    render(<Lesson />);
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enable microphone/i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /enable microphone/i })).toBeNull();
  });

  it('remembers a grant, so a returning player is not asked again', async () => {
    localStorage.setItem('sightreader.micPermission', JSON.stringify('granted'));

    render(<Lesson />);
    await settle();

    // Straight past the explainer, and listening from load as it did before.
    expect(screen.queryByRole('button', { name: /enable microphone/i })).toBeNull();
    expect(startMicCapture).toHaveBeenCalledTimes(1);
  });
});
