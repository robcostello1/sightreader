/**
 * Build order step 1-2: getUserMedia -> AudioContext -> AudioWorkletNode,
 * emitting PitchSample and OnsetEvent streams. The worklet source lives in
 * public/worklets/ so Vite serves it at a stable URL for addModule().
 *
 * Implementations plug in behind the PitchDetector interface in lib/types.
 */
export {};
