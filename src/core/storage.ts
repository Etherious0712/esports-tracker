import type { FollowConfig, Match, NotificationPrefs } from './models';
import { DEFAULT_FOLLOW_CONFIG, DEFAULT_NOTIFICATION_PREFS } from './models';

/**
 * Minimal async key-value area — the subset of chrome.storage we depend on.
 * Declared as an interface so logic modules (e.g. spoiler.ts) can accept a mock
 * in tests instead of touching the real chrome.storage, which does not exist
 * under the Vitest/node test runner.
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

// Storage keys — kept as constants so key names are never duplicated.
const KEY_FOLLOW_CONFIG = 'followConfig';
const KEY_NOTIFICATION_PREFS = 'notificationPrefs';
const KEY_CACHED_MATCHES = 'cachedMatches';
const KEY_CACHE_TIMESTAMP = 'cacheTimestamp';

// ── chrome.storage.sync (preferences — synced across devices in a future version) ──

export async function getFollowConfig(): Promise<FollowConfig> {
  const result = await chrome.storage.sync.get(KEY_FOLLOW_CONFIG);
  return (result[KEY_FOLLOW_CONFIG] as FollowConfig | undefined) ?? DEFAULT_FOLLOW_CONFIG;
}

export async function setFollowConfig(config: FollowConfig): Promise<void> {
  await chrome.storage.sync.set({ [KEY_FOLLOW_CONFIG]: config });
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const result = await chrome.storage.sync.get(KEY_NOTIFICATION_PREFS);
  return (
    (result[KEY_NOTIFICATION_PREFS] as NotificationPrefs | undefined) ??
    DEFAULT_NOTIFICATION_PREFS
  );
}

export async function setNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  await chrome.storage.sync.set({ [KEY_NOTIFICATION_PREFS]: prefs });
}

// ── chrome.storage.local (cache — not synced; can be large) ──

export async function getCachedMatches(): Promise<Match[]> {
  const result = await chrome.storage.local.get(KEY_CACHED_MATCHES);
  return (result[KEY_CACHED_MATCHES] as Match[] | undefined) ?? [];
}

export async function setCachedMatches(matches: Match[]): Promise<void> {
  await chrome.storage.local.set({
    [KEY_CACHED_MATCHES]: matches,
    [KEY_CACHE_TIMESTAMP]: new Date().toISOString(),
  });
}

/** Returns the UTC ISO 8601 timestamp of the last successful cache write, or null. */
export async function getCacheTimestamp(): Promise<string | null> {
  const result = await chrome.storage.local.get(KEY_CACHE_TIMESTAMP);
  return (result[KEY_CACHE_TIMESTAMP] as string | undefined) ?? null;
}
