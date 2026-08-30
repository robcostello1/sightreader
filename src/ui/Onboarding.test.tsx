// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from './Onboarding';

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

describe('Onboarding', () => {
  it('explains the ask before anything reaches the browser', async () => {
    const request = grants();
    render(<Onboarding request={request} onDone={vi.fn()} />);

    // Nothing may touch getUserMedia on render: the whole point is that the
    // native dialog arrives only after the player has read why.
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText(/nothing is recorded/i)).toBeTruthy();
  });

  it('asks the browser when the player presses the button', async () => {
    const request = grants();
    const onDone = vi.fn();
    render(<Onboarding request={request} onDone={onDone} />);

    await click(screen.getByRole('button', { name: /enable microphone/i }));

    expect(request).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('granted');
  });

  it('says so when the browser refuses, and offers another go', async () => {
    const request = refuses();
    const onDone = vi.fn();
    render(<Onboarding request={request} onDone={onDone} />);

    await click(screen.getByRole('button', { name: /enable microphone/i }));

    expect(onDone).toHaveBeenCalledWith('denied');
    expect(screen.getByText(/did not allow the microphone/i)).toBeTruthy();

    await click(screen.getByRole('button', { name: /try again/i }));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not record a refusal when there was simply no microphone', async () => {
    // Nothing was refused, so nothing should be remembered — plugging an
    // interface in and pressing again is the whole recovery.
    const request = vi.fn().mockResolvedValue({
      granted: false,
      cause: new DOMException('none', 'NotFoundError'),
    });
    const onDone = vi.fn();
    render(<Onboarding request={request} onDone={onDone} />);

    await click(screen.getByRole('button', { name: /enable microphone/i }));

    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
