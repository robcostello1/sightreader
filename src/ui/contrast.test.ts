import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the palette against regressing below WCAG AA.
 *
 * Read from the stylesheet rather than duplicated here, so the test cannot
 * quietly pass while the real colours drift.
 */
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[name] = value;
  }
  return tokens;
}

const [lightBlock, darkBlock] = css.split('@media (prefers-color-scheme: dark)');
const light = tokensIn(lightBlock);
const dark = tokensIn(darkBlock ?? '');

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

describe('palette contrast', () => {
  it('defines the same tokens for both schemes', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
    expect(light.bg).toBeDefined();
    expect(light['fg-muted']).toBeDefined();
  });

  it.each([
    ['light', () => light],
    ['dark', () => dark],
  ])('meets WCAG AA for body text in %s', (_scheme, read) => {
    const tokens = read();
    for (const name of ['fg', 'fg-muted', 'accent', 'danger']) {
      // 4.5:1 is the AA threshold for normal-sized text, which all of these are.
      expect(contrast(tokens[name], tokens.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps secondary text clearly readable, not merely passing', () => {
    // The original failure was dimming by opacity; muted text should have real
    // headroom above the threshold rather than sitting on it.
    expect(contrast(light['fg-muted'], light.bg)).toBeGreaterThan(6);
    expect(contrast(dark['fg-muted'], dark.bg)).toBeGreaterThan(6);
  });
});
