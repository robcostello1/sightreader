// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Waveform } from './Waveform';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Analyser stub that hands back a fixed frame. */
function fakeAnalyser(fill: (i: number) => number) {
  const reads: number[] = [];
  return {
    analyser: {
      fftSize: 64,
      getFloatTimeDomainData: (target: Float32Array) => {
        reads.push(target.length);
        for (let i = 0; i < target.length; i++) target[i] = fill(i);
      },
    } as unknown as AnalyserNode,
    reads,
  };
}

describe('Waveform', () => {
  it('rests flat before a microphone is open', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const { container } = render(<Waveform analyser={null} />);
    expect(container.querySelector('canvas')).not.toBeNull();
    // Draws without an analyser rather than throwing or vanishing.
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(60);
      }),
    ).not.toThrow();
  });

  it('renders a canvas sized to the requested height', () => {
    const { analyser } = fakeAnalyser(() => 0);
    const { container } = render(<Waveform analyser={analyser} height={40} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas!.style.height).toBe('40px');
  });

  it('reads the analyser on each animation frame', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const { analyser, reads } = fakeAnalyser((i) => Math.sin(i));
    render(<Waveform analyser={analyser} />);

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(reads.length).toBeGreaterThan(0);
    // Reads a buffer matching the analyser's frame size.
    expect(reads[0]).toBe(64);
  });

  it('stops reading once unmounted', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const { analyser, reads } = fakeAnalyser(() => 0.5);
    const { unmount } = render(<Waveform analyser={analyser} />);

    act(() => {
      vi.advanceTimersByTime(40);
    });
    unmount();
    const after = reads.length;
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // A loop left running would keep polling the audio graph forever.
    expect(reads.length).toBe(after);
  });
});
