import workletUrl from './pitch-processor.ts?audio-worklet';
import { PITCH_PROCESSOR_NAME, type WorkletMessage } from './constants';
import type { PitchyDetectorOptions } from './detector';
import type { OnsetDetectorOptions } from './onset';
import type { OnsetEvent, PitchSample } from '../lib/types';

export interface MicCaptureOptions extends PitchyDetectorOptions, OnsetDetectorOptions {
  /** Called once per hop (~11.6ms at the default 512-sample hop). */
  onSample: (sample: PitchSample) => void;
  /**
   * Called when an attack is detected. Peak-picking needs the frames after the
   * peak, so this arrives a few hops late — the event's own timestamp is the
   * accurate one, not the moment of the callback.
   */
  onOnset?: (event: OnsetEvent) => void;
  deviceId?: string;
}

export interface MicSession {
  readonly context: AudioContext;
  /**
   * Time-domain tap on the input, for showing that audio is arriving. Kept out
   * of the worklet and off the message port: a waveform only needs whatever the
   * current frame holds, so reading it per animation frame costs nothing the
   * detection path has to pay for.
   */
  readonly analyser: AnalyserNode;
  /** Hardware rate actually granted, which is not always 44.1kHz. */
  readonly sampleRate: number;
  stop: () => Promise<void>;
}

export function isMicCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    typeof AudioWorkletNode !== 'undefined'
  );
}

/**
 * Opens the microphone and starts the pitch stream.
 *
 * Must be called from a user-gesture handler: browsers refuse both the
 * getUserMedia prompt and AudioContext.resume() outside one.
 */
export async function startMicCapture(options: MicCaptureOptions): Promise<MicSession> {
  const { onSample, onOnset, deviceId, ...detectorOptions } = options;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // All three of these are tuned for speech and actively harm instrument
      // input: AGC pumps the level (which would wreck onset detection later),
      // and noise suppression mangles the harmonic structure the detector reads.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  });

  const context = new AudioContext({ latencyHint: 'interactive' });

  const teardownStream = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  let node: AudioWorkletNode;
  try {
    await context.audioWorklet.addModule(workletUrl);
    node = new AudioWorkletNode(context, PITCH_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: detectorOptions,
    });
  } catch (error) {
    teardownStream();
    await context.close();
    throw error;
  }

  node.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
    const message = event.data;
    if (message.type === 'pitch') onSample(message.sample);
    else onOnset?.(message.event);
  };

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  // The graph only pulls nodes that reach the destination, so route through a
  // silent gain rather than relying on a zero-output node being scheduled. The
  // processor writes nothing to its output, so this stays inaudible regardless.
  const silence = context.createGain();
  silence.gain.value = 0;
  source.connect(node).connect(silence).connect(context.destination);
  // Routed into the same muted gain so the graph pulls it; an analyser with no
  // path to the destination is not guaranteed to update.
  source.connect(analyser).connect(silence);

  // May be refused when the context was created without a user gesture, which
  // is the case when monitoring starts on page load. The session is still
  // usable; it resumes on the first interaction instead.
  if (context.state === 'suspended') {
    await context.resume().catch(() => undefined);
  }

  let stopped = false;
  return {
    context,
    analyser,
    sampleRate: context.sampleRate,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      node.port.postMessage({ type: 'stop' });
      node.port.onmessage = null;
      source.disconnect();
      analyser.disconnect();
      node.disconnect();
      silence.disconnect();
      teardownStream();
      await context.close();
    },
  };
}
