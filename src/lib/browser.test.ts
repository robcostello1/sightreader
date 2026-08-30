import { describe, expect, it } from 'vitest';
import { detectBrowser, recoverySteps } from './browser';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:129.0) Gecko/20100101 Firefox/129.0';
const EDGE = `${CHROME} Edg/128.0.0.0`;
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1';

describe('detectBrowser', () => {
  it('is not fooled by the claims every user agent makes', () => {
    // Every Chromium browser says "Safari"; Edge says "Chrome" as well. Only
    // the order of the checks tells them apart.
    expect(detectBrowser(CHROME)).toBe('chrome');
    expect(detectBrowser(SAFARI)).toBe('safari');
    expect(detectBrowser(FIREFOX)).toBe('firefox');
  });

  it('sends the rest of Chromium down the Chrome path, which is where they recover', () => {
    expect(detectBrowser(EDGE)).toBe('chrome');
    expect(detectBrowser(IOS_CHROME)).toBe('chrome');
  });

  it('admits when it does not know', () => {
    expect(detectBrowser('')).toBe('other');
    expect(detectBrowser('SomeNewBrowser/1.0')).toBe('other');
  });
});

describe('recoverySteps', () => {
  it('names the browser it is talking about', () => {
    expect(recoverySteps(FIREFOX).name).toBe('Firefox');
    expect(recoverySteps(SAFARI).name).toBe('Safari');
  });

  it('gives generic advice rather than the wrong menu', () => {
    const unknown = recoverySteps('SomeNewBrowser/1.0');
    expect(unknown.name).toBe('your browser');
    expect(unknown.steps.length).toBeGreaterThan(0);
  });

  it('always ends by reloading, since a permission change does not reach a live page', () => {
    for (const ua of [CHROME, SAFARI, FIREFOX, EDGE, '']) {
      expect(recoverySteps(ua).steps.at(-1)).toMatch(/reload/i);
    }
  });
});
