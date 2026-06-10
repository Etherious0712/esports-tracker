import type { Match } from './models';
import { localArea, type StorageArea } from './storage-area';

// ── Preferences (persisted via chrome.storage.sync — a user preference) ───────

export interface SpoilerPrefs {
  /** When true, in-progress (running) matches are also guarded. Default false. */
  hideRunning: boolean;
}

export const DEFAULT_SPOILER_PREFS: SpoilerPrefs = {
  hideRunning: false,
};

export interface SpoilerDecision {
  hideScore: boolean;
  hideWinner: boolean;
}

// ── Pure decision function (no I/O) ───────────────────────────────────────────

/**
 * Decides whether a match's score/winner must be hidden. Pure: no storage, no DOM.
 * Both the popup and the page-level content script call this per match.
 *
 * The status switch is intentionally exhaustive with no `default`: if MatchStatus
 * ever gains a new value, the type checker flags this function so the new case is
 * decided deliberately rather than silently defaulting to "shown" (a potential leak).
 */
export function getSpoilerDecision(
  match: Match,
  revealed: boolean,
  prefs: SpoilerPrefs,
): SpoilerDecision {
  const shown: SpoilerDecision = { hideScore: false, hideWinner: false };
  const hidden: SpoilerDecision = { hideScore: true, hideWinner: true };

  if (revealed) return shown;

  switch (match.status) {
    case 'finished':
      return hidden;
    case 'running':
      return prefs.hideRunning ? hidden : shown;
    case 'notStarted':
    case 'cancelled':
      return shown;
  }
}

// ── Reveal state ("reveal once, revealed everywhere") ─────────────────────────
//
// Stored under a single key holding the array of revealed match ids, so a content
// script scanning a page loads the whole set in one read rather than N reads.
// Persisted to chrome.storage.local (per-device). Stores only match ids — NEVER scores.

const KEY_REVEALED = 'spoiler:revealed';

/**
 * Returns the set of revealed match ids.
 *
 * Fail safe: if storage cannot be read, returns an empty set so we guard rather
 * than risk leaking a result. Read this once per render/scan and check membership
 * locally; do not call isRevealed in a tight loop (it re-reads storage each time).
 */
export async function getRevealedSet(store: StorageArea = localArea()): Promise<Set<string>> {
  try {
    const result = await store.get(KEY_REVEALED);
    const ids = result[KEY_REVEALED];
    if (!Array.isArray(ids)) return new Set();
    return new Set(ids.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

/** Marks a match as revealed. Idempotent: revealing an already-revealed id is a no-op. */
export async function reveal(matchId: string, store: StorageArea = localArea()): Promise<void> {
  const revealed = await getRevealedSet(store);
  if (revealed.has(matchId)) return;
  revealed.add(matchId);
  await store.set({ [KEY_REVEALED]: [...revealed] });
}

/**
 * Convenience check for a single id. Reads storage on each call, so prefer
 * getRevealedSet() + local membership checks when iterating many matches.
 */
export async function isRevealed(matchId: string, store: StorageArea = localArea()): Promise<boolean> {
  const revealed = await getRevealedSet(store);
  return revealed.has(matchId);
}
