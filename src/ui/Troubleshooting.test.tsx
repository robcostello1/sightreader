// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';
import { Troubleshooting } from './Troubleshooting';

afterEach(cleanup);

describe('Troubleshooting', () => {
  it('is reachable from the header, and not in the way until then', () => {
    // Rendered through App: the link lives in the header rather than the
    // lesson, so it is there before and between exercises alike.
    const { container } = render(<App />);
    const link = [...container.querySelectorAll('header button')].find((button) =>
      /troubleshooting/i.test(button.textContent ?? ''),
    );
    expect(link).toBeTruthy();
    expect(container.querySelector('.trouble')).toBeNull();
  });

  it('opens on the link', () => {
    render(<Troubleshooting open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();

    render(<Troubleshooting open onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('says what to do about the metronome being heard', () => {
    // The click comes back through the microphone and is scored as if it were
    // played. Nothing in the app can reliably tell it apart from the player, so
    // the answer is advice rather than a filter.
    render(<Troubleshooting open onOpenChange={() => {}} />);
    expect(screen.getByText(/headphones/i)).toBeTruthy();
    expect(screen.getByText(/louder than the metronome/i)).toBeTruthy();
  });

  it('closes on the button, unlike the checklist', () => {
    let open = true;
    render(<Troubleshooting open onOpenChange={(next) => (open = next)} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(open).toBe(false);
  });
});
