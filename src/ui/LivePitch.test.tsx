// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LivePitch } from './LivePitch';
import { keyByName } from '../lib/key';
import { midiToHz } from '../lib/pitch';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const C = keyByName('C');
const F = keyByName('F');

function markerPercent(container: HTMLElement): number | null {
  const marker = container.querySelector<HTMLElement>('.tuning-marker');
  return marker ? Number.parseFloat(marker.style.left) : null;
}

const noteText = (container: HTMLElement) => container.querySelector('.note')!.textContent;

describe('LivePitch display steadying', () => {
  // The detector dips below the gate constantly mid-note — a decaying string, a
  // shifting finger — and a readout that blinks in and out is unreadable. None
  // of this touches the sample stream the scorer uses.
  const props = (hz: number | null, confidence = 0.95) => ({
    hz,
    confidence,
    gate: 0.8,
    musicalKey: C,
  });

  it('shows the first note it hears without waiting', () => {
    vi.useFakeTimers();
    const { container } = render(<LivePitch {...props(midiToHz(60))} />);
    expect(noteText(container)).toBe('C4');
  });

  it('holds the note through a brief dropout', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<LivePitch {...props(midiToHz(60))} />);

    act(() => rerender(<LivePitch {...props(null, 0)} />));
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(noteText(container)).toBe('C4');
  });

  it('lets the note go once the dropout outlasts the hold', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<LivePitch {...props(midiToHz(60))} />);

    act(() => rerender(<LivePitch {...props(null, 0)} />));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(noteText(container)).toBe('—');
  });

  it('ignores a single stray reading of another note', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<LivePitch {...props(midiToHz(60))} />);

    // One frame of a different pitch, then back — an octave error or a bump.
    act(() => rerender(<LivePitch {...props(midiToHz(64))} />));
    expect(noteText(container)).toBe('C4');
    act(() => rerender(<LivePitch {...props(midiToHz(60))} />));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(noteText(container)).toBe('C4');
  });

  it('changes over once another note actually holds', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<LivePitch {...props(midiToHz(60))} />);

    act(() => rerender(<LivePitch {...props(midiToHz(64))} />));
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(noteText(container)).toBe('E4');
  });
});

describe('LivePitch on a transposing instrument', () => {
  it('names the note the player reads, not the one the microphone hears', () => {
    // A B flat clarinettist sounding a concert D is playing their E. Telling
    // them "D" would name a note that is not on their page.
    const { container } = render(
      <LivePitch
        hz={midiToHz(50)} // concert D3
        confidence={0.95}
        gate={0.8}
        musicalKey={keyByName('D')} // written key for concert C
        writtenOffset={2}
      />,
    );
    expect(container.querySelector('.note')!.textContent).toBe('E3');
  });

  it('leaves a non-transposing instrument alone', () => {
    const { container } = render(
      <LivePitch hz={midiToHz(60)} confidence={0.95} gate={0.8} musicalKey={C} />,
    );
    expect(container.querySelector('.note')!.textContent).toBe('C4');
  });
});

describe('LivePitch', () => {
  it('names a confident pitch, spelled for the key', () => {
    const { container } = render(
      <LivePitch hz={midiToHz(70)} confidence={0.95} gate={0.8} musicalKey={F} />,
    );
    expect(container.querySelector('.note')!.textContent).toBe('Bb4');
  });

  it('holds its slot when nothing is heard, rather than collapsing', () => {
    // The layout must not move as playing starts and stops.
    const { container } = render(
      <LivePitch hz={null} confidence={0} gate={0.8} musicalKey={C} />,
    );
    expect(container.querySelector('.note')!.textContent).toBe('—');
    expect(container.querySelector('.readout')).not.toBeNull();
    expect(markerPercent(container)).toBeNull();
  });

  it('ignores a pitch below the confidence gate', () => {
    const { container } = render(
      <LivePitch hz={midiToHz(60)} confidence={0.3} gate={0.8} musicalKey={C} />,
    );
    expect(container.querySelector('.note')!.textContent).toBe('—');
  });

  it('centres the marker when in tune', () => {
    const { container } = render(
      <LivePitch hz={midiToHz(60)} confidence={0.95} gate={0.8} musicalKey={C} />,
    );
    expect(markerPercent(container)).toBeCloseTo(50, 1);
  });

  it('puts flat to the left and sharp to the right', () => {
    const flat = render(
      <LivePitch hz={midiToHz(60) * 2 ** (-25 / 1200)} confidence={0.95} gate={0.8} musicalKey={C} />,
    );
    expect(markerPercent(flat.container)).toBeLessThan(50);
    cleanup();

    const sharp = render(
      <LivePitch hz={midiToHz(60) * 2 ** (25 / 1200)} confidence={0.95} gate={0.8} musicalKey={C} />,
    );
    expect(markerPercent(sharp.container)).toBeGreaterThan(50);
  });

  it('clamps the marker inside the meter', () => {
    // Half a semitone out is the most it can be from the nearest note, but the
    // marker must never escape its track regardless.
    for (const cents of [-80, 80]) {
      const { container } = render(
        <LivePitch
          hz={midiToHz(60) * 2 ** (cents / 1200)}
          confidence={0.95}
          gate={0.8}
          musicalKey={C}
        />,
      );
      const percent = markerPercent(container)!;
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
      cleanup();
    }
  });
});
