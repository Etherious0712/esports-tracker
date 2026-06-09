import type { FollowConfig, Match } from '../models';

export interface IDataSource {
  /**
   * Fetches recent, live, and upcoming matches within the scope defined by
   * follow. Returns an empty array — without throwing — when the follow list
   * is empty; callers should handle that case gracefully.
   *
   * Throws a subclass of DataSourceError on unrecoverable failures:
   *   AuthError       — 401/403 (bad token or plan restriction)
   *   RateLimitError  — 429
   *   DataSourceError — network errors, timeouts, unexpected status codes
   *
   * Callers are expected to catch DataSourceError and fall back to stale cache.
   */
  fetchMatches(follow: FollowConfig): Promise<Match[]>;
}

// ── Error hierarchy ────────────────────────────────────────────────────────────

export class DataSourceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DataSourceError';
  }
}

/** Thrown on HTTP 401 or 403 — the API token is missing, invalid, or the free
 *  plan does not cover the requested endpoint. */
export class AuthError extends DataSourceError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Thrown on HTTP 429. Callers must back off and serve stale cache. */
export class RateLimitError extends DataSourceError {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}
