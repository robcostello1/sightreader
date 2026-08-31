import type { ReactNode } from 'react';

/**
 * Two sizes, and only two.
 *
 * `small` is the interface talking about itself — labels, readouts, captions,
 * the running commentary beside a control. `default` is anything meant to be
 * read as prose: an explanation, an answer, a paragraph someone stops on.
 *
 * The distinction is what the text is *for*, not how much of it there is. A
 * long caption is still small; one sentence of explanation is not.
 */
export type TextSize = 'default' | 'small';

/** Colour, kept off the size axis so either can be dimmed or made a warning. */
export type TextTone = 'default' | 'muted' | 'warning';

function classes(base: string, size: TextSize, tone: TextTone, extra?: string): string {
  return [
    base,
    size === 'small' ? `${base}-small` : null,
    tone !== 'default' ? `${base}-${tone}` : null,
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface TextProps {
  size?: TextSize;
  tone?: TextTone;
  /** A paragraph unless it has to sit inside a line of something else. */
  as?: 'p' | 'span' | 'div';
  className?: string;
  children: ReactNode;
}

export function Text({
  size = 'default',
  tone = 'default',
  as: Tag = 'p',
  className,
  children,
}: TextProps) {
  return <Tag className={classes('text', size, tone, className)}>{children}</Tag>;
}

export interface HeadingProps {
  /** Document structure. The size is chosen separately, and on purpose. */
  level: 1 | 2 | 3;
  size?: TextSize;
  tone?: TextTone;
  className?: string;
  children: ReactNode;
}

/**
 * Level and size are separate because they answer different questions: the
 * level is where this sits in the document, the size is how loudly it should
 * say so. A card's label and a dialog's title are both second-level headings
 * and should look nothing alike.
 */
export function Heading({
  level,
  size = 'default',
  tone = 'default',
  className,
  children,
}: HeadingProps) {
  const Tag = `h${level}` as const;
  return (
    <Tag className={classes('heading', size, tone, `heading-${level} ${className ?? ''}`.trim())}>
      {children}
    </Tag>
  );
}

export interface ListProps {
  as?: 'ul' | 'ol';
  size?: TextSize;
  tone?: TextTone;
  className?: string;
  children: ReactNode;
}

/** Items inherit the list's size, so an `li` inside needs nothing of its own. */
export function List({
  as: Tag = 'ul',
  size = 'default',
  tone = 'default',
  className,
  children,
}: ListProps) {
  return <Tag className={classes('text', size, tone, `list ${className ?? ''}`.trim())}>{children}</Tag>;
}
