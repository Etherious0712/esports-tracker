import type { FollowConfig, Match } from '../core/models';

/**
 * Dependencies for refreshMatches, injected so the function is unit-testable
 * without a real DataSource or chrome.storage. The entrypoint wires the real
 * implementations (PandaScoreSource + storage helpers).
 */
export interface RefreshDeps {
  loadFollowConfig: () => Promise<FollowConfig>;
  fetchMatches: (follow: FollowConfig) => Promise<Match[]>;
  saveCachedMatches: (matches: Match[]) => Promise<void>;
}

/**
 * Fetches matches for the followed games and writes them to the local cache.
 *
 * - Empty games list → skip the fetch entirely and leave the cache untouched.
 * - Fetch failure (Auth/RateLimit/DataSource/network) → log and keep the
 *   previous cache; stale data beats a blank popup, and we never clear on error.
 */
export async function refreshMatches(deps: RefreshDeps): Promise<void> {
  const follow = await deps.loadFollowConfig();
  if (follow.games.length === 0) {
    return;
  }

  try {
    const matches = await deps.fetchMatches(follow);
    await deps.saveCachedMatches(matches);
  } catch (error) {
    console.warn('[background] match refresh failed; keeping previous cache', error);
  }
}
