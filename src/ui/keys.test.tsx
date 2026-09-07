// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHORTCUTS, isActivatable, isFormTarget, useShortcuts } from './keys';
import type { ShortcutHandlers } from './keys';

afterEach(cleanup);

/** A page with every kind of thing a keystroke could be aimed at. */
function Page({ enabled = true, ...handlers }: ShortcutHandlers & { enabled?: boolean }) {
  useShortcuts(handlers, enabled);
  return (
    <div>
      <button type="button">Go</button>
      <input aria-label="tempo" type="range" />
      <select aria-label="instrument">
        <option>Guitar</option>
      </select>
    </div>
  );
}

function press(key: string, target: Element | Document = document.body, init = {}) {
  act(() => {
    fireEvent.keyDown(target, { key, ...init });
  });
}

describe('the keyboard layer', () => {
  it('holds and lets go on the space bar', () => {
    const toggle = vi.fn();
    render(<Page toggle={toggle} />);

    press(' ');
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('stops on escape and opens the list on a question mark', () => {
    const stop = vi.fn();
    const keys = vi.fn();
    render(<Page stop={stop} keys={keys} />);

    press('Escape');
    press('?');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(keys).toHaveBeenCalledTimes(1);
  });

  it('moves on with enter, which is not the same key as the hold', () => {
    const next = vi.fn();
    const toggle = vi.fn();
    render(<Page next={next} toggle={toggle} />);

    press('Enter');
    expect(next).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('leaves the sliders and dropdowns their own keys', () => {
    const toggle = vi.fn();
    const stop = vi.fn();
    const { getByLabelText } = render(<Page toggle={toggle} stop={stop} />);

    press(' ', getByLabelText('tempo'));
    press(' ', getByLabelText('instrument'));
    press('Escape', getByLabelText('instrument'));
    expect(toggle).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not press a focused button twice', () => {
    const toggle = vi.fn();
    const next = vi.fn();
    const { getByRole } = render(<Page toggle={toggle} next={next} />);
    const button = getByRole('button');

    // The browser turns both of these into a click on the button itself.
    press(' ', button);
    press('Enter', button);
    expect(toggle).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    // Escape is not one it would press, so it still means stop.
    const stop = vi.fn();
    cleanup();
    const rendered = render(<Page stop={stop} />);
    press('Escape', rendered.getByRole('button'));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps out of the way of the browser and the system', () => {
    const toggle = vi.fn();
    render(<Page toggle={toggle} />);

    press(' ', document.body, { metaKey: true });
    press(' ', document.body, { ctrlKey: true });
    press(' ', document.body, { altKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });

  it('hands the keyboard over while a dialog owns it', () => {
    const toggle = vi.fn();
    render(<Page toggle={toggle} enabled={false} />);

    press(' ');
    press('Escape');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('follows the handler that is current, without rebinding on every phase', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Page toggle={first} />);

    press(' ');
    rerender(<Page toggle={second} />);
    press(' ');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops the page scrolling out from under the music', () => {
    render(<Page toggle={() => {}} />);
    const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('documents every key it binds', () => {
    expect(SHORTCUTS.map((s) => s.keys)).toEqual(['Space', 'Enter', 'Esc', '?']);
  });
});

describe('what a keystroke belongs to', () => {
  it('knows a control from the page', () => {
    const input = document.createElement('input');
    const div = document.createElement('div');
    expect(isFormTarget(input)).toBe(true);
    expect(isFormTarget(div)).toBe(false);
    expect(isFormTarget(null)).toBe(false);
  });

  it('knows what the browser will press for it', () => {
    expect(isActivatable(document.createElement('button'))).toBe(true);
    expect(isActivatable(document.createElement('summary'))).toBe(true);
    expect(isActivatable(document.createElement('div'))).toBe(false);
  });
});
