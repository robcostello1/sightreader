/**
 * Build order steps 1-2: mic capture -> AudioWorklet -> pitch stream with
 * confidence values, plus spectral-flux onset detection on the same frames.
 */
export { startMicCapture, startSilentSession, isMicCaptureSupported } from './capture';
export {
  isPermissionDenial,
  loadMicPermission,
  queryMicPermission,
  saveMicPermission,
} from './permission';
export type { MicPermission } from './permission';
export type { MicCaptureOptions, MicSession } from './capture';
export { PitchyDetector, computeRms, DEFAULT_FRAME_SIZE, DEFAULT_HOP_SIZE } from './detector';
export type { PitchyDetectorOptions } from './detector';
export { SpectralFluxOnsetDetector, ONSET_PRESETS, DEFAULT_ONSET_WINDOW } from './onset';
export type { OnsetDetectorOptions, InstrumentPreset } from './onset';
export { NOMINAL_HOP_MS } from './constants';
export { PITCH_PROCESSOR_NAME } from './constants';
export type { WorkletMessage } from './constants';
