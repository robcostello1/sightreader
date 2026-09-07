import { useEffect, useRef } from 'react';

export interface Shortcut {
  /** As it is printed on a keyboard. */
  keys: string;
  /** What it does, in the same words the buttons use. */
  action: string;
}

/**
 * The whole keyboard layer, in one list.
 *
 * Playing an instrument takes both hands and both eyes, and the mouse is on the
 * other side of the room from a music stand. Everything a session needs while
 * it is running is therefore reachable without looking: hold it, let it go,
 * stop, move on.
 *
 * The list is what the shortcuts dialog shows and what the handler implements,
 * so a key cannot be documented without being bound or bound without being
 * documented.
 */
export const SHORTCUTS: Shortcut[] = [
  { keys: 'Space', action: 'Start, hold, and pick back up' },
  { keys: 'Enter', action: 'Move on to the next exercise' },
  { keys: 'Esc', action: 'Stop the session' },
  { keys: '?', action: 'Show this list' },
];

/**
 * Somewhere a keystroke belongs to a control rather than to the page: a text
 * box, a dropdown, the tempo and difficulty sliders — where space and the arrow
 * keys already mean something.
 */
export function isFormTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['input', 'textarea', 'select', 'option'].includes(target.tagName.toLowerCase());
}

/**
 * Something the browser will already press for you on space or enter. Taking
 * those keys here as well would run the action twice — once as a shortcut and
 * once as a click on whatever the last press left focused.
 */
export function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['button', 'a', 'summary'].includes(target.tagName.toLowerCase());
}

export interface ShortcutHandlers {
  /** Space: whatever the go button means at this moment. */
  toggle?: () => void;
  /** Enter: on to the next exercise. */
  next?: () => void;
  /** Escape: end the session. */
  stop?: () => void;
  /** Question mark: the list itself. */
  keys?: () => void;
}

/**
 * Binds the list above to the window.
 *
 * Handlers are read through a ref so the listener is bound once and not
 * re-bound on every phase change — the phase changes on every frame of an
 * exercise, and an add/remove pair per frame is not something to hang off the
 * key that pauses the music. `enabled` is for the times the page is not the
 * thing being typed at: a dialog is open, and it owns the keyboard.
 */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const latest = useRef(handlers);
  // In an effect rather than during the render that produced them: a ref
  // written while rendering is a value React is entitled to throw away.
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // A modifier means the keystroke belongs to the browser or the OS.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isFormTarget(event.target)) return;
      const { toggle, next, stop, keys } = latest.current;

      if (event.key === 'Escape') {
        stop?.();
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        keys?.();
        return;
      }
      if (isActivatable(event.target)) return;
      if (event.key === ' ') {
        // Space scrolls the page by default, which is the last thing wanted
        // from the key that holds the music.
        event.preventDefault();
        toggle?.();
        return;
      }
      if (event.key === 'Enter') next?.();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
