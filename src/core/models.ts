// Extend GameId only once a new game's PandaScore structure has been verified.
export type GameId = 'lol' | 'csgo' | 'dota2';

// 'cancelled' uses British spelling; mapped from PandaScore's 'canceled' in the
// datasource layer — the conversion lives there so our model stays consistent.
export type MatchStatus = 'notStarted' | 'running' | 'finished' | 'cancelled';

export interface Team {
  id: string;
  name: string;
  /** May be an empty string for teams without an official acronym. */
  acronym: string;
}

/** Maps to a PandaScore "league". */
export interface Competition {
  id: string;
  name: string;
}

export interface MatchResult {
  teamId: string;
  score: number;
}

export interface Match {
  id: string;
  game: GameId;
  competition: Competition;
  /** Human-readable match label from PandaScore (e.g. "Upper Bracket Final: T1 vs G2"). */
  name: string;
  teamA: Team;
  teamB: Team;
  /** ISO 8601 UTC. Convert to local time only at the render layer. */
  beginAtUtc: string;
  endAtUtc: string | null;
  status: MatchStatus;
  /** From PandaScore number_of_games. Meaningful when match_type === 'best_of'. */
  bestOf: number;
  /**
   * Always present in PandaScore responses — even not_started matches return
   * [{score:0},{score:0}]. Never use results to decide whether a match is
   * settled; use status === 'finished' via hasResult().
   */
  results: MatchResult[];
  winnerId: string | null;
  officialStreamUrl: string | null;
}

/**
 * The only reliable way to test whether a match has a settled result.
 * results[] being non-empty is NOT sufficient — PandaScore populates it
 * with zeroes before a match starts.
 */
export function hasResult(match: Match): boolean {
  return match.status === 'finished';
}

export interface FollowConfig {
  games: GameId[];
  teamIds: string[];
  competitionIds: string[];
}

export interface NotificationPrefs {
  enabled: boolean;
  /** Minutes before kick-off to send the pre-match reminder. Default 15. */
  leadMinutes: number;
  /** Send a "VOD ready" notification after a match ends (spoiler-safe wording). */
  notifyOnEnd: boolean;
  /** When true, post-match notifications omit the score. Default true. */
  spoilerSafeWording: boolean;
}

export const DEFAULT_FOLLOW_CONFIG: FollowConfig = {
  games: [],
  teamIds: [],
  competitionIds: [],
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  leadMinutes: 15,
  notifyOnEnd: true,
  spoilerSafeWording: true,
};
