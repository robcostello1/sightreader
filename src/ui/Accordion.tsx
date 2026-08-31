import type { ReactNode } from 'react';

export interface AccordionProps {
  /** Reads as a section heading within its card, so it is styled like one. */
  title: string;
  /**
   * Shown after the title, for a section whose worth depends on how much is in
   * it — four concepts arriving is news, none is not.
   */
  count?: number;
  children: ReactNode;
}

/**
 * A foldaway section of a card. Native `details`, so it opens without state and
 * keyboard and find-in-page work on it for free.
 *
 * Shared rather than written out at each use: the sidebar has two of these and
 * they were drifting apart — one a card title, one a sentence — which made two
 * sections of the same panel look like different kinds of thing.
 */
export function Accordion({ title, count, children }: AccordionProps) {
  return (
    <details className="accordion">
      <summary>
        {title}
        {count !== undefined && ` (${count})`}
      </summary>
      {children}
    </details>
  );
}
