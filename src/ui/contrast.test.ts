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

/**
 * Both palettes, read from the light-dark() pairs the stylesheet declares.
 *
 * Taking them from the same declaration is what makes "defines the same tokens
 * for both schemes" true by construction rather than by a test — a colour
 * cannot be changed in one scheme and forgotten in the other.
 */
function palettes(): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  const pair = /--([\w-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/gi;
  for (const [, name, lightValue, darkValue] of css.matchAll(pair)) {
    light[name] = lightValue;
    dark[name] = darkValue;
  }
  return { light, dark };
}

const { light, dark } = palettes();

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
  it('finds the palette it is meant to be checking', () => {
    // A stylesheet rewrite that stopped matching would otherwise leave this
    // whole file passing vacuously.
    for (const name of [
      'bg',
      'surface',
      'fg',
      'fg-muted',
      'accent',
      'pass',
      'fail',
      'unclear',
      'accent-surface',
      'on-accent',
    ]) {
      expect(light[name]).toBeDefined();
      expect(dark[name]).toBeDefined();
    }
  });

  it('keeps light off white and warm', () => {
    // Paper is never pure white, and a page of notation on #fff glares under a
    // lamp — but only just off, so it still reads as white.
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(light.bg.slice(i, i + 2), 16));
    expect(r).toBeLessThan(255);
    expect(r).toBeGreaterThan(248);
    // Warm: more red than blue, by a little.
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeLessThan(16);
  });

  it.each([
    ['light', () => light],
    ['dark', () => dark],
  ])('meets WCAG AA for body text in %s', (_scheme, read) => {
    const tokens = read();
    for (const name of ['fg', 'fg-muted', 'accent', 'pass', 'fail', 'unclear']) {
      // 4.5:1 is the AA threshold for normal-sized text, which all of these are.
      // Checked on the card surface as well as the page, since most of the
      // secondary text now sits on a card.
      for (const background of ['bg', 'surface']) {
        expect(contrast(tokens[name], tokens[background])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each([
    ['light', () => light],
    ['dark', () => dark],
  ])('keeps the header bar readable in %s', (_scheme, read) => {
    // The header inverts the palette — light text on the accent — which the
    // checks above do not cover: they ask whether the accent reads as text on
    // the page, which is a different question from whether the page reads as
    // text on the accent.
    const tokens = read();
    expect(contrast(tokens['on-accent'], tokens['accent-surface'])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps secondary text clearly readable, not merely passing', () => {
    // The original failure was dimming by opacity; muted text should have real
    // headroom above the threshold rather than sitting on it.
    expect(contrast(light['fg-muted'], light.surface)).toBeGreaterThan(6);
    expect(contrast(dark['fg-muted'], dark.surface)).toBeGreaterThan(6);
  });
});

/**
 * The type scale, guarded the same way and for the same reason as the palette:
 * read from the stylesheet, so it cannot pass while the real values drift.
 */
describe('type scale', () => {
  it('is the only place a size is written down', () => {
    // Before the scale there were five values between 0.75 and 1rem doing the
    // same job in different corners of this file — which is how a caption ends
    // up a pixel smaller than the caption beside it.
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map(([, value]) => value.trim());
    expect(sizes.length).toBeGreaterThan(8);
    for (const size of sizes) expect(size).toMatch(/^var\(--/);
  });

  it('defines every token the text components ask for', () => {
    for (const token of [
      '--text-size',
      '--text-size-small',
      '--heading-1',
      '--heading-1-small',
      '--heading-2',
      '--heading-2-small',
      '--heading-3',
      '--heading-3-small',
    ]) {
      expect(css).toContain(`${token}:`);
    }
  });
});

describe('surfaces', () => {
  it('leaves headings the colour of whatever they sit on', () => {
    // A heading that names its own colour cannot be put on the accent bar, and
    // the wordmark went out in near-black on purple before this. Only the label
    // variant chooses a colour, and it is never on anything but a card.
    const heading = css.slice(css.indexOf('.heading {'));
    expect(heading.slice(0, heading.indexOf('}'))).not.toContain('color:');
  });
});
