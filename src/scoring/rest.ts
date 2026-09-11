import { nearestMidi } from '../lib/pitch';
import type { PitchSample } from '../lib/types';
import type { ScoringConfig } from '../config/levels';

/**
 * How close two readings must be to count as the same note ringing on, in
 * semitones. A held note wanders a little; noise does not stay anywhere.
 */
const COHERENT_SEMITONES = 1;

/**
 * How long a sound must hold steady before it is somebody playing rather than
 * something happening. A metronome click lasts 30ms and a fret buzz less; a note
 * left ringing lasts as long as the rest does.
 */
export const MIN_SUSTAIN_MS = 120;

/** Room around a click where its own sound, and the detector's take on it, live. */
export const CLICK_SHADOW_MS = { before: 15, after: 70 };

export interface RestEvidence {
  /** Whether something was heard holding steady through the rest. */
  sounding: boolean;
  /** How long the longest steady run lasted, in ms. */
  longestMs: number;
  /** Samples left after the clicks were taken out. */
  considered: number;
  /** Why nothing could be decided, when nothing could. */
  tooShort: boolean;
}

/**
 * Reads a rest's samples for evidence that the player did not stop.
 *
 * Three things have to be told apart, and only one of them is a mistake: the
 * metronome, which the app plays itself and can therefore subtract exactly;
 * noise — a pedal, a fret, a chair — which is loud enough to detect but never
 * holds a pitch; and a note left ringing, which holds one for as long as it
 * rings. So what counts against a rest is not "a pitch was detected" but "one
 * pitch was detected steadily, for long enough that nothing else explains it".
 */
export function restEvidence(
  zone: readonly PitchSample[],
  config: ScoringConfig,
  clicks: readonly number[] = [],
  minSustainMs = MIN_SUSTAIN_MS,
): RestEvidence {
  const shadowed = (timestamp: number) =>
    clicks.some(
      (click) =>
        timestamp >= click - CLICK_SHADOW_MS.before && timestamp <= click + CLICK_SHADOW_MS.after,
    );

  const usable = zone.filter((sample) => !shadowed(sample.timestamp));
  const confident = usable.filter(
    (sample) => sample.hz !== null && sample.confidence >= config.confidenceGate,
  );

  // The longest run of confident readings that stay on one note. Consecutive in
  // the sample stream, so a gap of unvoiced frames ends a run rather than
  // bridging it.
  let longestMs = 0;
  let run: PitchSample[] = [];
  const flush = () => {
    if (run.length > 1) {
      longestMs = Math.max(longestMs, run[run.length - 1].timestamp - run[0].timestamp);
    }
    run = [];
  };
  let previous: PitchSample | null = null;
  for (const sample of usable) {
    const isConfident = sample.hz !== null && sample.confidence >= config.confidenceGate;
    if (!isConfident) {
      flush();
      previous = null;
      continue;
    }
    const wanders =
      previous !== null &&
      Math.abs(nearestMidi(sample.hz!) - nearestMidi(previous.hz!)) > COHERENT_SEMITONES;
    if (wanders) flush();
    run.push(sample);
    previous = sample;
  }
  flush();

  // A rest shorter than the steadiness test itself cannot fail it, and saying
  // it passed would be a verdict rather than the absence of one.
  const zoneMs =
    zone.length > 1 ? zone[zone.length - 1].timestamp - zone[0].timestamp : 0;
  const tooShort = zoneMs < minSustainMs || usable.length < config.minSamples;

  return {
    sounding: !tooShort && longestMs >= minSustainMs,
    longestMs,
    considered: confident.length,
    tooShort,
  };
}
