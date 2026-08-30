export type BrowserFamily = 'chrome' | 'firefox' | 'safari' | 'other';

export interface RecoverySteps {
  /** What to call the browser when telling someone where to click. */
  name: string;
  steps: string[];
}

/**
 * Which browser we are in, to the only resolution that matters here: where the
 * microphone permission is re-enabled.
 *
 * User-agent strings are a pile of historical claims — every Chromium browser
 * says "Safari", Edge says "Chrome" — so the order of these checks is the
 * whole algorithm. Anything unrecognised gets generic advice rather than
 * confident instructions for the wrong menu.
 */
export function detectBrowser(userAgent: string): BrowserFamily {
  const ua = userAgent.toLowerCase();
  if (ua.includes('firefox/') || ua.includes('fxios')) return 'firefox';
  // Edge, Opera and the rest of Chromium recover the same way Chrome does.
  if (ua.includes('chrome/') || ua.includes('chromium/') || ua.includes('crios')) return 'chrome';
  if (ua.includes('safari/')) return 'safari';
  return 'other';
}

const RECOVERY: Record<BrowserFamily, RecoverySteps> = {
  chrome: {
    name: 'Chrome',
    steps: [
      'Select the icon at the left of the address bar.',
      'Turn Microphone on for this site.',
      'Reload the page.',
    ],
  },
  firefox: {
    name: 'Firefox',
    steps: [
      'Select the padlock at the left of the address bar.',
      'Clear the blocked Microphone permission.',
      'Reload the page.',
    ],
  },
  safari: {
    name: 'Safari',
    steps: [
      'Open Safari → Settings for This Website, from the menu bar.',
      'Set Microphone to Allow.',
      'Reload the page.',
    ],
  },
  other: {
    name: 'your browser',
    steps: [
      'Open this site’s permissions, usually from an icon in the address bar.',
      'Allow the microphone for this site.',
      'Reload the page.',
    ],
  },
};

export function recoverySteps(userAgent: string): RecoverySteps {
  return RECOVERY[detectBrowser(userAgent)];
}
