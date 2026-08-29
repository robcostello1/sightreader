import { useCallback, useEffect, useRef, useState } from 'react';
import { startMicCapture, type MicSession } from '../audio';
import type { PitchSample } from '../lib/types';

export type LivePitchStatus = 'idle' | 'starting' | 'listening' | 'error';

export interface LivePitch {
  status: LivePitchStatus;
  error: string | null;
  /** Most recent sample, refreshed at frame rate rather than per hop. */
  sample: PitchSample | null;
  sampleRate: number | null;
  start: () => void;
  stop: () => void;
}

/**
 * Bridges the pitch stream into React. Samples arrive ~86 times a second, far
 * faster than is worth re-rendering for, so the newest one is parked in a ref
 * and published once per animation frame.
 */
export function useLivePitch(): LivePitch {
  const [status, setStatus] = useState<LivePitchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<PitchSample | null>(null);
  const [sampleRate, setSampleRate] = useState<number | null>(null);

  const sessionRef = useRef<MicSession | null>(null);
  const latestRef = useRef<PitchSample | null>(null);
  const frameRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    void sessionRef.current?.stop();
    sessionRef.current = null;
    latestRef.current = null;
    setSample(null);
    setSampleRate(null);
    setStatus('idle');
  }, []);

  const start = useCallback(() => {
    if (sessionRef.current) return;
    setStatus('starting');
    setError(null);

    startMicCapture({
      onSample: (next) => {
        latestRef.current = next;
      },
    }).then(
      (session) => {
        sessionRef.current = session;
        setSampleRate(session.sampleRate);
        setStatus('listening');

        const publish = () => {
          setSample(latestRef.current);
          frameRef.current = requestAnimationFrame(publish);
        };
        frameRef.current = requestAnimationFrame(publish);
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      },
    );
  }, []);

  // Release the mic if the component unmounts mid-session.
  useEffect(() => stop, [stop]);

  return { status, error, sample, sampleRate, start, stop };
}
