import { loadSetting, saveSetting } from '../lib/storage';

/**
 * What we know about microphone access.
 *
 * `unknown` covers both a first visit and a browser that will prompt again;
 * either way the explainer runs before anything asks. `denied` is remembered so
 * a returning player lands in degraded mode rather than at a dialog they have
 * already refused.
 */
export type MicPermission = 'unknown' | 'granted' | 'denied';

const KEY = 'micPermission';

const read = (value: unknown): MicPermission | null =>
  value === 'granted' || value === 'denied' ? value : null;

export function loadMicPermission(): MicPermission {
  return loadSetting(KEY, read, 'unknown');
}

export function saveMicPermission(state: MicPermission): void {
  saveSetting(KEY, state);
}

/**
 * What the browser itself says, which outranks anything stored: permission can
 * be revoked from the address bar long after we recorded it as granted.
 *
 * Returns null when the browser cannot answer — Safari does not support the
 * microphone descriptor, and some engines throw rather than reject — in which
 * case the stored value stands and the first getUserMedia call settles it.
 */
export async function queryMicPermission(): Promise<MicPermission | null> {
  if (typeof navigator === 'undefined' || navigator.permissions === undefined) return null;
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });
    if (status.state === 'granted') return 'granted';
    if (status.state === 'denied') return 'denied';
    // 'prompt': the browser will ask, so we are back to not knowing.
    return 'unknown';
  } catch {
    return null;
  }
}

/**
 * Whether a failed getUserMedia was the user saying no, as opposed to there
 * being no microphone, the page not being in a secure context, or the device
 * being held by something else. Only a refusal should be remembered — the rest
 * are worth retrying.
 */
export function isPermissionDenial(cause: unknown): boolean {
  if (typeof DOMException !== 'undefined' && cause instanceof DOMException) {
    return cause.name === 'NotAllowedError' || cause.name === 'SecurityError';
  }
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    (cause as { name?: unknown }).name === 'NotAllowedError'
  );
}
