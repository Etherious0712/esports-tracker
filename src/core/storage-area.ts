/**
 * Low-level storage abstraction, kept in its own module so both storage.ts and
 * logic modules (e.g. spoiler.ts) can depend on it without a circular import.
 */

/**
 * Minimal async key-value area — the subset of chrome.storage we depend on.
 * Declared as an interface so logic modules can accept a mock in tests instead
 * of touching the real chrome.storage, which does not exist under the Vitest/node
 * test runner.
 */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Adapts a real chrome.storage area to our StorageArea interface. */
function fromChrome(area: chrome.storage.StorageArea): StorageArea {
  return {
    get: key => area.get(key),
    set: items => area.set(items),
  };
}

/**
 * Returns the chrome.storage.local-backed area. Lazy (a function, not a constant)
 * so that merely importing a module that defaults to it does not dereference the
 * chrome global at load time — which would throw under the test runner.
 */
export function localArea(): StorageArea {
  return fromChrome(chrome.storage.local);
}

/** Returns the chrome.storage.sync-backed area. Lazy, for the same reason as localArea. */
export function syncArea(): StorageArea {
  return fromChrome(chrome.storage.sync);
}
