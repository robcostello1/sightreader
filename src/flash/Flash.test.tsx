// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Flash } from './Flash';
import { flashQuestion } from './questions';
import { mulberry32 } from '../generator/rng';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Past the flash, to the question. */
const flashPast = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
};

const question = (seed: number) => flashQuestion({ rng: mulberry32(seed) });

describe('the flash mode', () => {
  it('shows the pattern first, and takes it away', async () => {
    render(<Flash seed={1} />);
    expect(document.querySelector('.flash-stage .score')).not.toBeNull();

    await flashPast();
    expect(document.querySelector('.flash-stage .score')).toBeNull();
    expect(screen.getByText(question(1).prompt)).not.toBeNull();
  });

  it('asks nothing while the pattern is still up', () => {
    render(<Flash seed={1} />);
    expect(document.querySelectorAll('.flash-option')).toHaveLength(0);
  });

  it('marks a right answer right, and counts it', async () => {
    render(<Flash seed={1} />);
    await flashPast();

    const right = question(1).answer;
    const options = [...document.querySelectorAll('.flash-option')];
    const index = question(1).options.findIndex((option) => option.id === right);
    await act(async () => {
      fireEvent.click(options[index]);
    });

    expect(options[index].className).toContain('is-right');
    expect(screen.getByText('Yes')).not.toBeNull();
    expect(screen.getByText('1 of 1')).not.toBeNull();
  });

  it('shows a wrong answer against the right one rather than only saying no', async () => {
    render(<Flash seed={1} />);
    await flashPast();

    const options = [...document.querySelectorAll('.flash-option')];
    const wrongIndex = question(1).options.findIndex((option) => option.id !== question(1).answer);
    await act(async () => {
      fireEvent.click(options[wrongIndex]);
    });

    expect(options[wrongIndex].className).toContain('is-wrong');
    expect(document.querySelectorAll('.flash-option.is-right')).toHaveLength(1);
    expect(screen.getByText('0 of 1')).not.toBeNull();
  });

  it('takes one answer per question, not a second guess', async () => {
    render(<Flash seed={1} />);
    await flashPast();

    const options = [...document.querySelectorAll('.flash-option')] as HTMLButtonElement[];
    await act(async () => {
      fireEvent.click(options[0]);
      fireEvent.click(options[1]);
    });
    // One question asked, whatever was clicked after the first answer.
    expect(document.querySelector('.flash')!.textContent).toContain('of 1');
    expect(options.every((option) => option.disabled)).toBe(true);
  });

  it('shows the next pattern on the next question', async () => {
    render(<Flash seed={1} />);
    await flashPast();
    await act(async () => {
      fireEvent.click(document.querySelector('.flash-option')!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    });

    // Back to a pattern on screen, and a different one.
    expect(document.querySelector('.flash-stage .score')).not.toBeNull();
    await flashPast();
    expect(screen.getByText(question(2).prompt)).not.toBeNull();
  });
});
