import type { PitchSample } from '../lib/types';
import type { ClickEvent } from './schedule';

/**
 * The click, as actually made. Named rather than left as defaults because
 * something has to recognise this sound coming back through the microphone —
 * see isClickBleed — and two literals that happen to agree is not the same as
 * one fact.
 */
export const CLICK_HZ = 1000;
/** The accent, a fifth above. */
export const ACCENT_HZ = 1500;
export const CLICK_MS = 30;

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
  const clickHz = options.clickHz ?? CLICK_HZ;
  const accentHz = options.accentHz ?? ACCENT_HZ;
  const durationSec = (options.durationMs ?? CLICK_MS) / 1000;
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


/**
 * How long after a click a sample can still be carrying it. The click itself is
 * CLICK_MS, and what runs past that is the detector's own analysis window — a
 * frame straddling the click hears it — plus the room and the trip out of the
 * speaker and back in.
 */
const BLEED_MS = CLICK_MS + 70;

/** How far off the click's pitch a reading can be and still be the click. */
const BLEED_CENTS = 70;

/**
 * Whether a reading is the metronome coming back in through the microphone.
 *
 * Playing along to a click out loud means the microphone hears it, and between
 * the player's own notes there is nothing else to hear, so the detector locks
 * onto it and reports a confident B — which is a true reading of the room and a
 * false one of the player.
 *
 * The app made the sound, so it knows both when it happened and what pitch it
 * was, and both have to agree before a reading is thrown away: matching on the
 * moment alone would blind the display on every beat, which is exactly where
 * the player's own attack falls. Detectors also land an octave out on a pure
 * tone, so the octaves either side count as the click too.
 *
 * A reading this rejects is blanked rather than dropped — see the caller. It
 * matters for scoring as much as for the display: occupancy is the share of
 * confident frames that were the target note, so a click landing inside a note
 * dilutes it, and a click landing inside a rest is a pitch where silence was
 * asked for.
 */
export function isClickBleed(sample: PitchSample, clicks: readonly ClickEvent[]): boolean {
  const { hz, timestamp } = sample;
  if (hz === null || hz <= 0) return false;

  return clicks.some((click) => {
    const since = timestamp - click.timeMs;
    if (since < 0 || since > BLEED_MS) return false;
    const clickHz = click.accent ? ACCENT_HZ : CLICK_HZ;
    return [0.5, 1, 2].some(
      (octave) => Math.abs(1200 * Math.log2(hz / (clickHz * octave))) <= BLEED_CENTS,
    );
  });
}
