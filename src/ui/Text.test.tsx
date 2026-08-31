// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Heading, List, Text } from './Text';

afterEach(cleanup);

describe('Text', () => {
  it('reads at reading size unless told otherwise', () => {
    const { container } = render(<Text>Body</Text>);
    const text = container.firstElementChild!;
    expect(text.tagName).toBe('P');
    expect(text.className).toBe('text');
  });

  it('carries size and tone on separate axes', () => {
    // Either can be dimmed, and dimming is not a size.
    const { container } = render(
      <Text size="small" tone="muted">
        Caption
      </Text>,
    );
    expect(container.firstElementChild!.className).toContain('text-small');
    expect(container.firstElementChild!.className).toContain('text-muted');
  });

  it('goes inline where it has to sit inside a line of something else', () => {
    const { container } = render(<Text as="span">Inline</Text>);
    expect(container.firstElementChild!.tagName).toBe('SPAN');
  });

  it('keeps layout classes it is handed', () => {
    const { container } = render(<Text className="steps">x</Text>);
    expect(container.firstElementChild!.className).toContain('steps');
  });
});

describe('Heading', () => {
  it('takes its level from the document and its size from the design', () => {
    // A card's label and a dialog's title are both second-level headings and
    // should look nothing alike, so the two are chosen separately.
    const label = render(
      <Heading level={2} size="small">
        This level
      </Heading>,
    ).container.firstElementChild!;
    expect(label.tagName).toBe('H2');
    expect(label.className).toContain('heading-small');
    cleanup();

    const title = render(<Heading level={2}>Troubleshooting</Heading>).container
      .firstElementChild!;
    expect(title.tagName).toBe('H2');
    expect(title.className).not.toContain('heading-small');
  });
});

describe('List', () => {
  it('is ordered when asked, and its items need nothing of their own', () => {
    const { container } = render(
      <List as="ol" tone="muted">
        <li>One</li>
      </List>,
    );
    expect(container.firstElementChild!.tagName).toBe('OL');
    expect(container.firstElementChild!.className).toContain('text-muted');
  });
});
