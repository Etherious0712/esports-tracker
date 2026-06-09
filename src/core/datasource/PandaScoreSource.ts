import type { FollowConfig, GameId, Match, MatchResult, MatchStatus, Team } from '../models';
import { AuthError, DataSourceError, RateLimitError, type IDataSource } from './IDataSource';

// ── Internal raw types (PandaScore JSON shape) ────────────────────────────────
// Platform-named fields keep their original spelling per CLAUDE.md §6.

interface RawTeam {
  id: number;
  name: string;
  // Optional defensively: PandaScore usually returns a string (possibly empty),
  // but we must not assume the field is present. resolveAcronym handles undefined.
  acronym?: string;
}

interface RawOpponent {
  type: string;
  opponent: RawTeam;
}

interface RawResult {
  team_id: number;
  score: number;
}

interface RawStream {
  main: boolean;
  official: boolean;
  raw_url: string;
}

interface RawLeague {
  id: number;
  name: string;
}

interface RawPandaScoreMatch {
  id: number;
  name: string;
  status: string;
  begin_at: string | null;
  end_at: string | null;
  number_of_games: number;
  winner_id: number | null;
  league: RawLeague;
  opponents: RawOpponent[];
  results: RawResult[];
  streams_list: RawStream[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PANDASCORE_BASE_URL = 'https://api.pandascore.co';
const MATCH_RESULTS_PER_PAGE = 50;

const GAME_ENDPOINT: Record<GameId, string> = {
  lol: 'lol',
  csgo: 'csgo',
};

const MATCH_ENDPOINT_TYPES = ['running', 'upcoming', 'past'] as const;
type MatchEndpointType = (typeof MATCH_ENDPOINT_TYPES)[number];

// ── Exported normalisation helpers (testable in isolation) ────────────────────

/**
 * Maps a PandaScore status string to our internal MatchStatus.
 * 'canceled' (American) → 'cancelled' (British) is handled here; the internal
 * model never uses the American spelling.
 */
export function mapStatus(status: string): MatchStatus {
  switch (status) {
    case 'not_started':
      return 'notStarted';
    case 'running':
      return 'running';
    case 'finished':
      return 'finished';
    case 'canceled':
      return 'cancelled';
    default:
      console.warn(`[PandaScoreSource] Unknown status '${status}' — defaulting to notStarted`);
      return 'notStarted';
  }
}

/**
 * Returns the raw URL of the best official stream:
 *   1. main === true && official === true
 *   2. any official === true
 *   3. null
 */
export function pickOfficialStream(
  streams: ReadonlyArray<{ main: boolean; official: boolean; raw_url: string }>,
): string | null {
  const mainOfficial = streams.find(s => s.main && s.official);
  if (mainOfficial !== undefined) return mainOfficial.raw_url;
  const anyOfficial = streams.find(s => s.official);
  return anyOfficial !== undefined ? anyOfficial.raw_url : null;
}

/**
 * Normalises a single raw PandaScore match object into our internal Match.
 * Returns null when the match cannot be normalised safely (TBD opponents,
 * missing scheduled time). Callers should filter out nulls.
 *
 * The `game` param is taken from the endpoint that returned this record since
 * videogame.slug values differ from our GameId labels.
 */
export function normaliseMatch(raw: unknown, game: GameId): Match | null {
  // Cast is intentional — raw comes directly from the PandaScore JSON response
  // and its shape is validated by the fixture-based integration tests.
  const r = raw as RawPandaScoreMatch;

  // TODO: matches with a null begin_at (TBD schedule) are currently dropped.
  // During UI work, decide whether to keep and surface these labelled "TBD"
  // rather than discarding them.
  if (!r.begin_at) return null;

  const oppA = r.opponents[0];
  const oppB = r.opponents[1];
  if (oppA === undefined || oppB === undefined) return null;

  return {
    id: String(r.id),
    game,
    competition: { id: String(r.league.id), name: r.league.name },
    name: r.name,
    teamA: buildTeam(oppA.opponent),
    teamB: buildTeam(oppB.opponent),
    beginAtUtc: r.begin_at,
    endAtUtc: r.end_at,
    status: mapStatus(r.status),
    bestOf: r.number_of_games,
    results: buildResults(r.results),
    winnerId: r.winner_id !== null ? String(r.winner_id) : null,
    officialStreamUrl: pickOfficialStream(r.streams_list),
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function buildTeam(raw: RawTeam): Team {
  return {
    id: String(raw.id),
    name: raw.name,
    acronym: resolveAcronym(raw.acronym, raw.name),
  };
}

/** Score rows must be matched by team_id, not by array order. */
function buildResults(rawResults: RawResult[]): MatchResult[] {
  return rawResults.map(r => ({ teamId: String(r.team_id), score: r.score }));
}

/**
 * Falls back to a 4-char truncation of the team name when PandaScore
 * returns an empty acronym string.
 */
function resolveAcronym(acronym: string | undefined, name: string): string {
  const trimmed = acronym?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : name.substring(0, 4).toUpperCase();
}

// ── PandaScoreSource class ────────────────────────────────────────────────────

type FetchFn = typeof globalThis.fetch;

export class PandaScoreSource implements IDataSource {
  constructor(
    private readonly apiToken: string,
    /** Injected to allow mocking in tests. Defaults to the global fetch. */
    private readonly fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
  ) {}

  async fetchMatches(follow: FollowConfig): Promise<Match[]> {
    if (follow.games.length === 0) return [];

    const requests = follow.games.flatMap(game =>
      MATCH_ENDPOINT_TYPES.map(type => this.fetchMatchPage(game, type)),
    );

    const settled = await Promise.allSettled(requests);
    const matches: Match[] = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        matches.push(...result.value);
      } else {
        // Individual endpoint failures degrade gracefully; the SW serves stale cache.
        console.warn('[PandaScoreSource] endpoint fetch failed:', result.reason);
      }
    }

    const filtered = this.filterByFollow(matches, follow);
    return filtered.sort((a, b) => a.beginAtUtc.localeCompare(b.beginAtUtc));
  }

  private async fetchMatchPage(game: GameId, type: MatchEndpointType): Promise<Match[]> {
    const slug = GAME_ENDPOINT[game];
    const url = `${PANDASCORE_BASE_URL}/${slug}/matches/${type}?per_page=${MATCH_RESULTS_PER_PAGE}&page=1`;

    const response = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`PandaScore auth failed (HTTP ${response.status})`);
    }
    if (response.status === 429) {
      throw new RateLimitError('PandaScore rate limit exceeded');
    }
    if (!response.ok) {
      throw new DataSourceError(`PandaScore request failed: HTTP ${response.status}`);
    }

    const rawItems = (await response.json()) as unknown[];
    return rawItems
      .map(item => normaliseMatch(item, game))
      .filter((m): m is Match => m !== null);
  }

  private filterByFollow(matches: Match[], follow: FollowConfig): Match[] {
    if (follow.teamIds.length === 0 && follow.competitionIds.length === 0) {
      return matches;
    }
    const teamSet = new Set(follow.teamIds);
    const compSet = new Set(follow.competitionIds);
    return matches.filter(
      m =>
        teamSet.has(m.teamA.id) ||
        teamSet.has(m.teamB.id) ||
        compSet.has(m.competition.id),
    );
  }
}
