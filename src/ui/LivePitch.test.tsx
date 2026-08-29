// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LivePitch } from './LivePitch';
import { keyByName } from '../lib/key';
import { midiToHz } from '../lib/pitch';

afterEach(cleanup);

const C = keyByName('C');
const F = keyByName('F');

function markerPercent(container: HTMLElement): number | null {
  const marker = container.querySelector<HTMLElement>('.tuning-marker');
  return marker ? Number.parseFloat(marker.style.left) : null;
}

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
