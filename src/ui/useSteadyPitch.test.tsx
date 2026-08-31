// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useCurrentReading } from './useSteadyPitch';
import type { Steady } from './useSteadyPitch';

afterEach(cleanup);

const reading = (midi: number): Steady => ({ midi, cents: 0 });

describe('useCurrentReading', () => {
  it('speaks for the note the reading was heard under', () => {
    const held = reading(60);
    const { result } = renderHook(
      ({ heard, index }: { heard: Steady | null; index: number | null }) =>
        useCurrentReading(heard, index),
      { initialProps: { heard: held, index: 0 } },
    );
    expect(result.current).toBe(60);
  });

  it('drops a reading the moment the cursor moves past its note', () => {
    // The pitch is still being held from the note before. Left alone it would
    // travel to the note that has just come up and sit over it as an answer to
    // a note the microphone has said nothing about.
    const held = reading(60);
    const { result, rerender } = renderHook(
      ({ heard, index }: { heard: Steady | null; index: number | null }) =>
        useCurrentReading(heard, index),
      { initialProps: { heard: held, index: 0 } },
    );

    rerender({ heard: held, index: 1 });
    expect(result.current).toBeNull();
  });

  it('keeps a note that is still arriving as the cursor moves on', () => {
    // Held or struck again across the bar line: the reading keeps coming, so it
    // is this note's as much as it was the last one's.
    const { result, rerender } = renderHook(
      ({ heard, index }: { heard: Steady | null; index: number | null }) =>
        useCurrentReading(heard, index),
      { initialProps: { heard: reading(60), index: 0 } },
    );

    // A fresh reading of the same pitch — a new object, as the detector gives.
    rerender({ heard: reading(60), index: 1 });
    expect(result.current).toBe(60);
  });

  it('takes up a new pitch under the note it arrives on', () => {
    const { result, rerender } = renderHook(
      ({ heard, index }: { heard: Steady | null; index: number | null }) =>
        useCurrentReading(heard, index),
      { initialProps: { heard: reading(60), index: 0 } },
    );

    rerender({ heard: reading(64), index: 1 });
    expect(result.current).toBe(64);
  });

  it('has nothing to say when nothing is being heard', () => {
    const { result } = renderHook(() => useCurrentReading(null, 0));
    expect(result.current).toBeNull();
  });
});
