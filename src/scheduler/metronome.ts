import type { ClickEvent } from './schedule';

export interface MetronomeOptions {
  /** Hz for a normal beat; the accent is a fifth above. */
  clickHz?: number;
  accentHz?: number;
  durationMs?: number;
  gain?: number;
}

export interface ScheduledClicks {
  stop: () => void;
}

/**
 * Schedules clicks ahead of time on the AudioContext clock rather than firing
 * them from timers. The whole point of the count-in is to establish a reference
 * the player can trust, and setTimeout jitter would undermine that — these are
 * sample-accurate against the same clock the note windows use.
 */
export function scheduleClicks(
  context: AudioContext,
  clicks: readonly ClickEvent[],
  options: MetronomeOptions = {},
): ScheduledClicks {
  const clickHz = options.clickHz ?? 1000;
  const accentHz = options.accentHz ?? 1500;
  const durationSec = (options.durationMs ?? 30) / 1000;
  const peak = options.gain ?? 0.25;

  const nodes: { oscillator: OscillatorNode; gain: GainNode }[] = [];

  for (const click of clicks) {
    const at = click.timeMs / 1000;
    // Skip anything already in the past, which would otherwise fire immediately.
    if (at < context.currentTime) continue;

    const oscillator = context.createOscillator();
    oscillator.frequency.value = click.accent ? accentHz : clickHz;

    const gain = context.createGain();
    // Percussive envelope; a bare gate would click audibly at both ends.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(click.accent ? peak : peak * 0.7, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + durationSec);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + durationSec + 0.01);
    nodes.push({ oscillator, gain });
  }

  return {
    stop: () => {
      for (const { oscillator, gain } of nodes) {
        try {
          oscillator.stop();
        } catch {
          // Already stopped, or never started because the context closed.
        }
        oscillator.disconnect();
        gain.disconnect();
      }
      nodes.length = 0;
    },
  };
}
