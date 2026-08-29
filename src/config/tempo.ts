export const MIN_BPM = 60;
export const MAX_BPM = 240;
export const BPM_STEP = 5;

export function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm / BPM_STEP) * BPM_STEP));
}
