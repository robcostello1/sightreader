import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { rolldown } from 'rolldown';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FRAME_SIZE, DEFAULT_HOP_SIZE } from './detector';
import { centsFromTarget, midiToHz } from '../lib/pitch';
import type { PitchSample } from '../lib/types';
import type { WorkletMessage } from './constants';

const SAMPLE_RATE = 44100;
const RENDER_QUANTUM = 128;

/**
 * Runs the real worklet bundle in a VM with stubbed AudioWorklet globals. This
 * is the only way to exercise the ring buffer, hop cadence and timestamp maths
 * without a browser — and those are exactly the parts the scorer will trust.
 */
class WorkletHarness {
  readonly messages: WorkletMessage[] = [];

  /** Pitch samples only — onsets are asserted separately. */
  get posted(): PitchSample[] {
    return this.messages.flatMap((m) => (m.type === 'pitch' ? [m.sample] : []));
  }

  get onsets() {
    return this.messages.flatMap((m) => (m.type === 'onset' ? [m.event] : []));
  }
  private readonly processor: { process: (inputs: Float32Array[][]) => boolean };
  private now = 0;

  constructor(code: string) {
    const messages = this.messages;
    const port = { postMessage: (message: WorkletMessage) => messages.push(message), onmessage: null };

    let Registered: (new (options?: unknown) => unknown) | undefined;
    const sandbox: Record<string, unknown> = {
      AudioWorkletProcessor: class {
        port = port;
      },
      registerProcessor: (_name: string, ctor: new (options?: unknown) => unknown) => {
        Registered = ctor;
      },
      sampleRate: SAMPLE_RATE,
    };
    // currentTime must advance as blocks are rendered, so expose it as a getter.
    Object.defineProperty(sandbox, 'currentTime', { get: () => this.now });

    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    if (!Registered) throw new Error('worklet did not call registerProcessor');
    this.processor = new Registered() as { process: (inputs: Float32Array[][]) => boolean };
  }

  /** Feeds `blocks` render quanta of a steady tone, advancing the clock as a real graph would. */
  render(hz: number, blocks: number): void {
    let phase = 0;
    for (let b = 0; b < blocks; b++) {
      const block = new Float32Array(RENDER_QUANTUM);
      for (let i = 0; i < RENDER_QUANTUM; i++) {
        // Harmonic stack, as in detector.test.ts — a bare sine is unrealistically easy.
        for (let h = 1; h <= 6; h++) block[i] += (0.5 / h) * Math.sin(2 * Math.PI * hz * h * phase);
        phase += 1 / SAMPLE_RATE;
      }
      this.processor.process([[block]]);
      this.now += RENDER_QUANTUM / SAMPLE_RATE;
    }
  }

  renderSilence(blocks: number): void {
    for (let b = 0; b < blocks; b++) {
      this.processor.process([[new Float32Array(RENDER_QUANTUM)]]);
      this.now += RENDER_QUANTUM / SAMPLE_RATE;
    }
  }
}

let code: string;

beforeAll(async () => {
  const entry = fileURLToPath(new URL('./pitch-processor.ts', import.meta.url));
  const build = await rolldown({ input: entry, platform: 'browser' });
  code = (await build.generate({ format: 'iife' })).output[0].code;
  await build.close();
}, 60_000);

describe('pitch-processor worklet', () => {
  it('emits nothing until the ring holds a full frame', () => {
    const harness = new WorkletHarness(code);
    // One hop short of a full frame.
    harness.render(midiToHz(45), (DEFAULT_FRAME_SIZE - DEFAULT_HOP_SIZE) / RENDER_QUANTUM);
    expect(harness.posted).toHaveLength(0);
  });

  it('emits one sample per hop once warmed up', () => {
    const harness = new WorkletHarness(code);
    const blocks = (DEFAULT_FRAME_SIZE + DEFAULT_HOP_SIZE * 4) / RENDER_QUANTUM;
    harness.render(midiToHz(45), blocks);
    // Warm-up consumes the first frame; every hop after that emits.
    expect(harness.posted).toHaveLength(5);
  });

  it('reports the played pitch through the full worklet path', () => {
    const harness = new WorkletHarness(code);
    harness.render(midiToHz(45), 64); // A2, 8192 samples
    const confident = harness.posted.filter((s) => s.confidence > 0.8);
    expect(confident.length).toBeGreaterThan(5);
    for (const sample of confident) {
      expect(Math.abs(centsFromTarget(sample.hz!, 45))).toBeLessThan(10);
    }
  });

  it('stamps samples on the AudioContext clock at the frame midpoint', () => {
    const harness = new WorkletHarness(code);
    harness.render(midiToHz(45), 64);

    const [first, second] = harness.posted;
    // First full frame ends at sample 2048; its midpoint is sample 1024.
    expect(first.timestamp).toBeCloseTo((1024 / SAMPLE_RATE) * 1000, 3);
    // Consecutive samples are exactly one hop apart.
    expect(second.timestamp - first.timestamp).toBeCloseTo((DEFAULT_HOP_SIZE / SAMPLE_RATE) * 1000, 3);

    const timestamps = harness.posted.map((s) => s.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it('posts onsets alongside pitch samples on the same clock', () => {
    const harness = new WorkletHarness(code);
    // Lead-in matters: the detector must be warmed up before the attack, or the
    // ring buffer is already full of steady tone by its first analysed frame.
    harness.renderSilence(32);
    harness.render(midiToHz(45), 64);

    expect(harness.onsets.length).toBeGreaterThan(0);
    const [onset] = harness.onsets;
    expect(onset.strength).toBeGreaterThan(1);
    // Onset timestamps share the pitch stream's clock and stay within its span.
    const times = harness.posted.map((s) => s.timestamp);
    expect(onset.timestamp).toBeGreaterThanOrEqual(times[0]);
    expect(onset.timestamp).toBeLessThanOrEqual(times[times.length - 1]);
  });

  it('reports silence rather than a guess when the input is quiet', () => {
    const harness = new WorkletHarness(code);
    harness.render(midiToHz(45), 64);
    harness.messages.length = 0;
    harness.renderSilence(64);
    const tail = harness.posted.slice(-3);
    expect(tail.length).toBeGreaterThan(0);
    for (const sample of tail) {
      expect(sample.hz).toBeNull();
      expect(sample.confidence).toBe(0);
    }
  });
});
