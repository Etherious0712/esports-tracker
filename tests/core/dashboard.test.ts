import { describe, expect, it } from 'vitest';
import { groupMatchesForDashboard } from '../../src/core/dashboard';
import type { GameId, Match, MatchStatus } from '../../src/core/models';

let counter = 0;

interface MatchOverrides {
  status?: MatchStatus;
  game?: GameId;
  competitionId?: string;
  beginAtUtc?: string;
}

function makeMatch(overrides: MatchOverrides = {}): Match {
  const id = `m${counter++}`;
  const competitionId = overrides.competitionId ?? 'c1';
  return {
    id,
    game: overrides.game ?? 'lol',
    competition: { id: competitionId, name: `Comp ${competitionId}` },
    name: id,
    teamA: { id: `${id}-a`, name: 'Team A', acronym: 'TA' },
    teamB: { id: `${id}-b`, name: 'Team B', acronym: 'TB' },
    beginAtUtc: overrides.beginAtUtc ?? '2026-06-10T12:00:00Z',
    endAtUtc: null,
    status: overrides.status ?? 'finished',
    bestOf: 3,
    results: [],
    winnerId: null,
    officialStreamUrl: null,
  };
}

describe('groupMatchesForDashboard', () => {
  it('Group_BucketsByStatus', () => {
    const view = groupMatchesForDashboard([
      makeMatch({ status: 'running' }),
      makeMatch({ status: 'notStarted' }),
      makeMatch({ status: 'finished' }),
      makeMatch({ status: 'cancelled' }),
    ]);
    expect(view.map(s => s.status)).toEqual(['running', 'notStarted', 'finished']);
    // cancelled is excluded entirely.
    expect(view.some(s => (s.status as string) === 'cancelled')).toBe(false);
  });

  it('Group_SectionOrder', () => {
    // Provide in a jumbled order; output must still be Live, Upcoming, Finished.
    const view = groupMatchesForDashboard([
      makeMatch({ status: 'finished' }),
      makeMatch({ status: 'running' }),
      makeMatch({ status: 'notStarted' }),
    ]);
    expect(view.map(s => s.status)).toEqual(['running', 'notStarted', 'finished']);
  });

  it('Group_OmitsEmptySections', () => {
    const view = groupMatchesForDashboard([makeMatch({ status: 'finished' })]);
    expect(view).toHaveLength(1);
    expect(view[0]!.status).toBe('finished');
  });

  it('Group_NestsGameThenTournament', () => {
    const view = groupMatchesForDashboard([
      makeMatch({ status: 'finished', game: 'csgo', competitionId: 'cs1' }),
      makeMatch({ status: 'finished', game: 'lol', competitionId: 'lolA' }),
      makeMatch({ status: 'finished', game: 'lol', competitionId: 'lolB' }),
    ]);
    const section = view[0]!;
    // Games in GAME_ORDER (lol before csgo).
    expect(section.games.map(g => g.game)).toEqual(['lol', 'csgo']);
    const lol = section.games[0]!;
    expect(new Set(lol.tournaments.map(t => t.competition.id))).toEqual(new Set(['lolA', 'lolB']));
    expect(section.games[1]!.tournaments.map(t => t.competition.id)).toEqual(['cs1']);
  });

  it('Group_FinishedSortDesc', () => {
    const view = groupMatchesForDashboard([
      makeMatch({ status: 'finished', competitionId: 'c1', beginAtUtc: '2026-06-01T00:00:00Z' }),
      makeMatch({ status: 'finished', competitionId: 'c1', beginAtUtc: '2026-06-03T00:00:00Z' }),
      makeMatch({ status: 'finished', competitionId: 'c1', beginAtUtc: '2026-06-02T00:00:00Z' }),
    ]);
    const times = view[0]!.games[0]!.tournaments[0]!.matches.map(m => m.beginAtUtc);
    expect(times).toEqual([
      '2026-06-03T00:00:00Z',
      '2026-06-02T00:00:00Z',
      '2026-06-01T00:00:00Z',
    ]);
  });

  it('Group_UpcomingSortAsc', () => {
    const view = groupMatchesForDashboard([
      makeMatch({ status: 'notStarted', competitionId: 'c1', beginAtUtc: '2026-06-03T00:00:00Z' }),
      makeMatch({ status: 'notStarted', competitionId: 'c1', beginAtUtc: '2026-06-01T00:00:00Z' }),
      makeMatch({ status: 'notStarted', competitionId: 'c1', beginAtUtc: '2026-06-02T00:00:00Z' }),
    ]);
    const times = view[0]!.games[0]!.tournaments[0]!.matches.map(m => m.beginAtUtc);
    expect(times).toEqual([
      '2026-06-01T00:00:00Z',
      '2026-06-02T00:00:00Z',
      '2026-06-03T00:00:00Z',
    ]);
  });

  it('Group_TournamentOrder_FinishedNewestFirst', () => {
    // Two tournaments in one game; Finished section → newest tournament surfaces first.
    const view = groupMatchesForDashboard([
      makeMatch({ status: 'finished', competitionId: 'older', beginAtUtc: '2026-06-01T00:00:00Z' }),
      makeMatch({ status: 'finished', competitionId: 'newer', beginAtUtc: '2026-06-09T00:00:00Z' }),
    ]);
    expect(view[0]!.games[0]!.tournaments.map(t => t.competition.id)).toEqual(['newer', 'older']);
  });

  it('Group_TournamentOrder_UpcomingSoonestFirst', () => {
    const view = groupMatchesForDashboard([
      makeMatch({ status: 'notStarted', competitionId: 'later', beginAtUtc: '2026-06-09T00:00:00Z' }),
      makeMatch({ status: 'notStarted', competitionId: 'sooner', beginAtUtc: '2026-06-02T00:00:00Z' }),
    ]);
    expect(view[0]!.games[0]!.tournaments.map(t => t.competition.id)).toEqual(['sooner', 'later']);
  });

  it('Group_TournamentOrder_DeterministicTieBreak', () => {
    // Same leading time → break ties by competition.id ascending.
    const view = groupMatchesForDashboard([
      makeMatch({ status: 'notStarted', competitionId: 'bbb', beginAtUtc: '2026-06-02T00:00:00Z' }),
      makeMatch({ status: 'notStarted', competitionId: 'aaa', beginAtUtc: '2026-06-02T00:00:00Z' }),
    ]);
    expect(view[0]!.games[0]!.tournaments.map(t => t.competition.id)).toEqual(['aaa', 'bbb']);
  });

  it('Group_EmptyInput', () => {
    expect(groupMatchesForDashboard([])).toEqual([]);
  });

  it('Group_OnlyCancelled_EmptyView', () => {
    expect(groupMatchesForDashboard([makeMatch({ status: 'cancelled' })])).toEqual([]);
  });
});
