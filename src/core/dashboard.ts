import type { Competition, GameId, Match } from './models';

// Pure grouping for the full-page dashboard: a flat Match[] → an ordered
// status → game → tournament → matches tree. No DOM, no I/O — the components
// just render the tree this produces.

/** The three statuses the dashboard surfaces, in display order. 'cancelled' is excluded. */
export type DashboardStatus = 'running' | 'notStarted' | 'finished';

export interface TournamentGroup {
  competition: Competition;
  matches: Match[];
}

export interface GameGroup {
  game: GameId;
  tournaments: TournamentGroup[];
}

export interface StatusSection {
  status: DashboardStatus;
  games: GameGroup[];
}

export type DashboardView = StatusSection[];

// Section display order: Live, then Upcoming, then Finished.
const SECTION_ORDER: DashboardStatus[] = ['running', 'notStarted', 'finished'];

// Stable game order within a section. Games outside this list sort after, by id.
const GAME_ORDER: GameId[] = ['lol', 'csgo'];

function gameRank(game: GameId): number {
  const index = GAME_ORDER.indexOf(game);
  return index === -1 ? GAME_ORDER.length : index;
}

/** Finished sorts most-recent-first; Live/Upcoming sort soonest-first. */
function isDescending(status: DashboardStatus): boolean {
  return status === 'finished';
}

function compareByTime(a: Match, b: Match, descending: boolean): number {
  const cmp = a.beginAtUtc.localeCompare(b.beginAtUtc);
  return descending ? -cmp : cmp;
}

/**
 * Groups matches into the dashboard tree. Empty status sections, game groups, and
 * tournament groups are omitted entirely. Within a section, matches are grouped by
 * game (GAME_ORDER) then by competition.id, and sorted by the section's direction.
 *
 * Tournament groups are ordered by their leading match (after the in-group sort):
 * Finished → newest tournament first; Live/Upcoming → soonest tournament first.
 * Ties break on competition.id for determinism.
 */
export function groupMatchesForDashboard(matches: Match[]): DashboardView {
  const view: DashboardView = [];
  for (const status of SECTION_ORDER) {
    const inStatus = matches.filter(match => match.status === status);
    if (inStatus.length === 0) continue;
    const games = buildGameGroups(inStatus, isDescending(status));
    if (games.length > 0) view.push({ status, games });
  }
  return view;
}

function buildGameGroups(matches: Match[], descending: boolean): GameGroup[] {
  const byGame = new Map<GameId, Match[]>();
  for (const match of matches) {
    const list = byGame.get(match.game) ?? [];
    list.push(match);
    byGame.set(match.game, list);
  }

  const games = [...byGame.keys()].sort(
    (a, b) => gameRank(a) - gameRank(b) || a.localeCompare(b),
  );

  const groups: GameGroup[] = [];
  for (const game of games) {
    const tournaments = buildTournamentGroups(byGame.get(game)!, descending);
    if (tournaments.length > 0) groups.push({ game, tournaments });
  }
  return groups;
}

function buildTournamentGroups(matches: Match[], descending: boolean): TournamentGroup[] {
  const byCompetition = new Map<string, Match[]>();
  for (const match of matches) {
    const list = byCompetition.get(match.competition.id) ?? [];
    list.push(match);
    byCompetition.set(match.competition.id, list);
  }

  const groups: TournamentGroup[] = [];
  for (const groupMatches of byCompetition.values()) {
    const sorted = [...groupMatches].sort((a, b) => compareByTime(a, b, descending));
    groups.push({ competition: sorted[0]!.competition, matches: sorted });
  }

  // Order groups by their leading match, matching the section's direction.
  groups.sort((a, b) => {
    const cmp = compareByTime(a.matches[0]!, b.matches[0]!, descending);
    return cmp !== 0 ? cmp : a.competition.id.localeCompare(b.competition.id);
  });
  return groups;
}
