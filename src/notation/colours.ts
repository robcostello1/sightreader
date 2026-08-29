/**
 * Verdict colours come from the stylesheet, so a note on the staff and its bar
 * in the level-up window are the same colour by construction rather than by two
 * lists happening to agree.
 *
 * The fallbacks match the light-scheme tokens in index.css and are used where no
 * stylesheet is loaded, such as in tests.
 */
export const VERDICT_FALLBACKS = {
  pass: '#0b7469',
  fail: '#b01e52',
  unclear: '#855800',
  active: '#4b45c9',
} as const;

export interface VerdictColours {
  pass: string;
  fail: string;
  unclear: string;
  active: string;
  /** Unscored notes follow the page's text colour. */
  idle: string;
}

/** Resolved against an element, which inherits whichever theme is in force. */
export function verdictColours(host: Element): VerdictColours {
  const styles = getComputedStyle(host);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    pass: token('--pass', VERDICT_FALLBACKS.pass),
    fail: token('--fail', VERDICT_FALLBACKS.fail),
    unclear: token('--unclear', VERDICT_FALLBACKS.unclear),
    active: token('--accent', VERDICT_FALLBACKS.active),
    idle: 'currentColor',
  };
}
