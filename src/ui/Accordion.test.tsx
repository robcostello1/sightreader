// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Accordion } from './Accordion';

afterEach(cleanup);

describe('Accordion', () => {
  it('starts closed, so what is behind it costs no space', () => {
    const { container } = render(
      <Accordion title="Settings">
        <p>hidden</p>
      </Accordion>,
    );
    expect(container.querySelector('details')!.open).toBe(false);
  });

  it('appends a count when there is one to give, and nothing when there is not', () => {
    render(<Accordion title="Being introduced" count={4}>x</Accordion>);
    expect(screen.getByText('Being introduced (4)')).toBeTruthy();
    cleanup();

    render(<Accordion title="Settings">x</Accordion>);
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('counts zero rather than reading as no count at all', () => {
    render(<Accordion title="Being introduced" count={0}>x</Accordion>);
    expect(screen.getByText('Being introduced (0)')).toBeTruthy();
  });
});
