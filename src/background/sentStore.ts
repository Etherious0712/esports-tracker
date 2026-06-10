import { localArea, type StorageArea } from '../core/storage-area';

// Single chrome.storage.local key holding the array of fired notification keys —
// same single-key pattern as the spoiler reveal set. Injectable for tests.
const KEY_SENT = 'notifier:sent';

/**
 * Returns the set of already-fired notification keys.
 * Fail safe: on a read error, returns an empty set. The cost of a wrongly-empty
 * set is at most a duplicate notification, which is preferable to crashing the
 * background worker.
 */
export async function getSentSet(store: StorageArea = localArea()): Promise<Set<string>> {
  try {
    const result = await store.get(KEY_SENT);
    const keys = result[KEY_SENT];
    if (!Array.isArray(keys)) return new Set();
    return new Set(keys.filter((k): k is string => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

/** Persists the sent-set as an array under the single key. */
export async function saveSentSet(sent: Set<string>, store: StorageArea = localArea()): Promise<void> {
  await store.set({ [KEY_SENT]: [...sent] });
}
