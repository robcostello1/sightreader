/**
 * Small typed wrapper over localStorage.
 *
 * Every access is guarded: localStorage is absent in some test environments and
 * throws outright in Safari's private mode, and a preference failing to save is
 * never worth breaking the app over.
 */
const PREFIX = 'sightreader.';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads a stored value, running it past `validate` before trusting it. Stored
 * data outlives the code that wrote it — a level saved before the range changed,
 * or a position id since renamed — so anything unrecognised falls back.
 */
export function loadSetting<T>(key: string, validate: (value: unknown) => T | null, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return validate(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveSetting(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private mode: a lost preference is not worth a crash.
  }
}
