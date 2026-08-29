/**
 * Build order step 1: mic capture -> AudioWorklet -> pitch stream with
 * confidence values. Onset detection (step 2) lands alongside this.
 */
export { startMicCapture, isMicCaptureSupported } from './capture';
export type { MicCaptureOptions, MicSession } from './capture';
export { PitchyDetector, computeRms, DEFAULT_FRAME_SIZE, DEFAULT_HOP_SIZE } from './detector';
export type { PitchyDetectorOptions } from './detector';
export { PITCH_PROCESSOR_NAME } from './constants';
