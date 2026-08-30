import { loadSetting, saveSetting } from './storage';

/** `system` follows the operating system; the other two override it. */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'theme';

const read = (value: unknown): ThemePreference | null =>
  value === 'light' || value === 'dark' || value === 'system' ? value : null;

export function loadTheme(): ThemePreference {
  return loadSetting(KEY, read, 'system');
}

export function saveTheme(preference: ThemePreference): void {
  saveSetting(KEY, preference);
}

/**
 * Puts the choice where the stylesheet can see it.
 *
 * A `data-theme` attribute on the root element rather than a class, since that
 * is what the CSS keys `color-scheme` off — and `color-scheme` is what
 * `light-dark()` and the native controls both follow. System is the absence of
 * the attribute, so nothing overrides the media preference.
 */
export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}
