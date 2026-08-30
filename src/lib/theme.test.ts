// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, loadTheme, saveTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme preference', () => {
  it('follows the system until told otherwise', () => {
    expect(loadTheme()).toBe('system');
  });

  it('remembers a choice across sessions', () => {
    saveTheme('dark');
    expect(loadTheme()).toBe('dark');
  });

  it('falls back rather than trusting whatever is stored', () => {
    localStorage.setItem('sightreader.theme', JSON.stringify('sepia'));
    expect(loadTheme()).toBe('system');
  });
});

describe('applyTheme', () => {
  it('marks the root element with the override', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('leaves no mark for system, so nothing overrides the media preference', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
