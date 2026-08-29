import { PITCH_PROCESSOR_NAME } from './constants';
import { PitchyDetector, type PitchyDetectorOptions } from './detector';

// AudioWorklet globals. Declared module-locally rather than in a .d.ts so they
// don't leak into the main app's type scope, where `sampleRate` in particular
// would mask real errors.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
declare const sampleRate: number;
declare const currentTime: number;

/**
 * Runs pitch detection on the audio thread and posts one PitchSample per hop.
 * Keeps a ring buffer of the last frameSize samples so each hop analyses a full
 * overlapping frame rather than only the 128 samples of one render quantum.
 */
class PitchProcessor extends AudioWorkletProcessor {
  private readonly detector: PitchyDetector;
  private readonly frameSize: number;
  private readonly hopSize: number;
  private readonly ring: Float32Array;
  private readonly frame: Float32Array;

  private ringWrite = 0;
  private totalSamples = 0;
  private sinceHop = 0;
  private running = true;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    this.detector = new PitchyDetector(
      (options?.processorOptions ?? {}) as PitchyDetectorOptions,
    );
    this.frameSize = this.detector.frameSize;
    this.hopSize = this.detector.hopSize;
    this.ring = new Float32Array(this.frameSize);
    this.frame = new Float32Array(this.frameSize);

    this.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'stop') this.running = false;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    // Input not connected yet — stay alive rather than letting the node be torn down.
    if (!channel) return this.running;

    for (let i = 0; i < channel.length; i++) {
      this.ring[this.ringWrite] = channel[i];
      this.ringWrite = (this.ringWrite + 1) % this.frameSize;
      this.totalSamples++;

      if (++this.sinceHop >= this.hopSize) {
        this.sinceHop = 0;
        this.emitSample(i);
      }
    }

    return this.running;
  }

  private emitSample(offsetInBlock: number): void {
    // Don't emit until the ring holds a full frame, or the leading zeros would
    // read as a spurious low-confidence pitch.
    if (this.totalSamples < this.frameSize) return;

    // Unwrap the ring into oldest -> newest order.
    const head = this.ringWrite;
    this.frame.set(this.ring.subarray(head), 0);
    this.frame.set(this.ring.subarray(0, head), this.frameSize - head);

    const { hz, confidence } = this.detector.detect(this.frame, sampleRate);

    // `currentTime` is the start of this render quantum, on the same
    // AudioContext clock the scheduler will use for note windows. The frame ends
    // at the sample just written; stamp its midpoint, the best single instant to
    // say "this pitch was sounding then".
    const frameEndSec = currentTime + (offsetInBlock + 1) / sampleRate;
    const timestamp = (frameEndSec - this.frameSize / 2 / sampleRate) * 1000;

    this.port.postMessage({ hz, confidence, timestamp });
  }
}

registerProcessor(PITCH_PROCESSOR_NAME, PitchProcessor);
