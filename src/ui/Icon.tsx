import type { ReactNode } from 'react';

/**
 * The transport icons, drawn rather than typed.
 *
 * They are the one place in the app where a shape says it faster than a word,
 * and they are the shapes everything else with a transport uses — a triangle
 * to go, two bars to hold, a square to stop. Each still ships with its label
 * beside it: a button that is only a glyph is a guess, and these three are
 * being pressed by someone whose hands are otherwise busy holding an
 * instrument.
 *
 * Sized in em so a button decides how big its own icon is, and filled with
 * currentColor so one never has to be recoloured for a theme.
 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function PlayIcon() {
  return <Glyph><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" /></Glyph>;
}

export function PauseIcon() {
  return (
    <Glyph>
      <rect x="6.5" y="5" width="4" height="14" rx="1" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" />
    </Glyph>
  );
}

export function StopIcon() {
  return <Glyph><rect x="6" y="6" width="12" height="12" rx="1.5" /></Glyph>;
}
