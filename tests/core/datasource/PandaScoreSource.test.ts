import { describe, expect, it, vi } from 'vitest';
import {
  mapStatus,
  normaliseMatch,
  normaliseTeam,
  PandaScoreSource,
  pickOfficialStream,
} from '../../../src/core/datasource/PandaScoreSource';
import { AuthError } from '../../../src/core/datasource/IDataSource';
import { hasResult } from '../../../src/core/models';
import finishedFixture from '../../fixtures/pandascore/lol_match_finished.json';
import notStartedFixture from '../../fixtures/pandascore/lol_match_notstarted.json';
import dota2FinishedFixture from '../../fixtures/pandascore/dota2_match_finished.json';
import teamsSearchFixture from '../../fixtures/pandascore/csgo_teams_search.json';

// ── mapStatus ─────────────────────────────────────────────────────────────────

describe('mapStatus', () => {
  it('MapStatus_NotStarted_ReturnsNotStarted', () => {
    expect(mapStatus('not_started')).toBe('notStarted');
  });

  it('MapStatus_Running_ReturnsRunning', () => {
    expect(mapStatus('running')).toBe('running');
  });

  it('MapStatus_Finished_ReturnsFinished', () => {
    expect(mapStatus('finished')).toBe('finished');
  });

  it('MapStatus_Canceled_ReturnsBritishCancelled', () => {
    // PandaScore uses American 'canceled'; our model uses British 'cancelled'.
    expect(mapStatus('canceled')).toBe('cancelled');
  });

  it('MapStatus_UnknownValue_FallsBackToNotStarted', () => {
    expect(mapStatus('postponed')).toBe('notStarted');
  });
});

// ── pickOfficialStream ────────────────────────────────────────────────────────

describe('pickOfficialStream', () => {
  it('PickOfficialStream_MainAndOfficial_ReturnsRawUrl', () => {
    const streams = [{ main: true, official: true, raw_url: 'https://twitch.tv/a' }];
    expect(pickOfficialStream(streams)).toBe('https://twitch.tv/a');
  });

  it('PickOfficialStream_NoMainButHasOfficial_ReturnsOfficialUrl', () => {
    const streams = [
      { main: false, official: false, raw_url: 'https://twitch.tv/unofficial' },
      { main: false, official: true, raw_url: 'https://twitch.tv/official' },
    ];
    expect(pickOfficialStream(streams)).toBe('https://twitch.tv/official');
  });

  it('PickOfficialStream_MainTrueOfficial_TakesPrecedenceOverNonMain', () => {
    const streams = [
      { main: false, official: true, raw_url: 'https://twitch.tv/secondary' },
      { main: true, official: true, raw_url: 'https://twitch.tv/primary' },
    ];
    expect(pickOfficialStream(streams)).toBe('https://twitch.tv/primary');
  });

  it('PickOfficialStream_NoOfficialStreams_ReturnsNull', () => {
    const streams = [
      { main: true, official: false, raw_url: 'https://twitch.tv/fancast' },
    ];
    expect(pickOfficialStream(streams)).toBeNull();
  });

  it('PickOfficialStream_EmptyList_ReturnsNull', () => {
    expect(pickOfficialStream([])).toBeNull();
  });

  it('PickOfficialStream_NotStartedFixture_ReturnsMainOfficialStream', () => {
    // Fixture has streams_list[0] as main+official: https://www.huya.com/lpl
    const match = normaliseMatch(notStartedFixture, 'lol');
    expect(match?.officialStreamUrl).toBe('https://www.huya.com/lpl');
  });
});

// ── normaliseMatch — finished fixture ─────────────────────────────────────────

describe('normaliseMatch (finished fixture)', () => {
  it('NormaliseMatch_FinishedFixture_ReturnsNonNull', () => {
    expect(normaliseMatch(finishedFixture, 'lol')).not.toBeNull();
  });

  it('NormaliseMatch_FinishedFixture_MapsIdAsString', () => {
    const match = normaliseMatch(finishedFixture, 'lol');
    expect(match?.id).toBe('1520677');
  });

  it('NormaliseMatch_FinishedFixture_SetsGameId', () => {
    const match = normaliseMatch(finishedFixture, 'lol');
    expect(match?.game).toBe('lol');
  });

  it('NormaliseMatch_FinishedFixture_MapsCompetition', () => {
    const match = normaliseMatch(finishedFixture, 'lol');
    expect(match?.competition.id).toBe('5262');
    expect(match?.competition.name).toBe('Esports World Cup');
  });

  it('NormaliseMatch_FinishedFixture_MapsTeamAAndB', () => {
    const match = normaliseMatch(finishedFixture, 'lol');
    expect(match?.teamA).toStrictEqual({ id: '136357', name: 'Fluxo W7M', acronym: 'FXW7' });
    expect(match?.teamB).toStrictEqual({ id: '94', name: 'paiN Gaming', acronym: 'PNG' });
  });

  it('NormaliseMatch_FinishedFixture_MapsUtcTimes', () => {
    const match = normaliseMatch(finishedFixture, 'lol');
    expect(match?.beginAtUtc).toBe('2026-06-07T21:36:23Z');
    expect(match?.endAtUtc).toBe('2026-06-08T00:09:23Z');
  });

  it('NormaliseMatch_FinishedFixture_StatusIsFinished', () => {
    const match = normaliseMatch(finishedFixture, 'lol');
    expect(match?.status).toBe('finished');
  });

  it('NormaliseMatch_FinishedFixture_BestOfFromNumberOfGames', () => {
    const match = normaliseMatch(finishedFixture, 'lol');
    expect(match?.bestOf).toBe(3);
  });

  it('NormaliseMatch_FinishedFixture_WinnerIdAsString', () => {
    const match = normaliseMatch(finishedFixture, 'lol');
    expect(match?.winnerId).toBe('136357');
  });

  it('NormaliseMatch_FinishedFixture_OfficialStreamUrl', () => {
    const match = normaliseMatch(finishedFixture, 'lol');
    expect(match?.officialStreamUrl).toBe('https://www.twitch.tv/baiano');
  });

  it('NormaliseMatch_FinishedFixture_HasResultReturnsTrue', () => {
    const match = normaliseMatch(finishedFixture, 'lol')!;
    expect(hasResult(match)).toBe(true);
  });
});

// ── normaliseMatch — results correctness ──────────────────────────────────────

describe('normaliseMatch (results by teamId, not array order)', () => {
  it('NormaliseMatch_FinishedResults_ScoresAccessibleByTeamId', () => {
    const match = normaliseMatch(finishedFixture, 'lol')!;
    // FXW7 wins 2-1; find by teamId, not by array position.
    const fxw7 = match.results.find(r => r.teamId === '136357');
    const png = match.results.find(r => r.teamId === '94');
    expect(fxw7?.score).toBe(2);
    expect(png?.score).toBe(1);
  });

  it('NormaliseMatch_ResultsReversedOrder_ScoresStillCorrectByTeamId', () => {
    // Swap the order of results — normaliseMatch must preserve team_id mapping.
    const reversed = { ...finishedFixture, results: [...finishedFixture.results].reverse() };
    const match = normaliseMatch(reversed, 'lol')!;
    const fxw7 = match.results.find(r => r.teamId === '136357');
    expect(fxw7?.score).toBe(2);
  });
});

// ── normaliseMatch — not_started fixture ──────────────────────────────────────

describe('normaliseMatch (not_started fixture)', () => {
  it('NormaliseMatch_NotStarted_StatusIsNotStarted', () => {
    const match = normaliseMatch(notStartedFixture, 'lol');
    expect(match?.status).toBe('notStarted');
  });

  it('NormaliseMatch_NotStarted_WinnerIdIsNull', () => {
    const match = normaliseMatch(notStartedFixture, 'lol');
    expect(match?.winnerId).toBeNull();
  });

  it('NormaliseMatch_NotStarted_EndAtUtcIsNull', () => {
    const match = normaliseMatch(notStartedFixture, 'lol');
    expect(match?.endAtUtc).toBeNull();
  });

  it('NormaliseMatch_NotStarted_HasResultReturnsFalse', () => {
    // This is the critical trap: results[] is present with 0:0 but the match
    // has no settled result. hasResult() must check status, not results.
    const match = normaliseMatch(notStartedFixture, 'lol')!;
    expect(hasResult(match)).toBe(false);
  });

  it('NormaliseMatch_NotStarted_ResultsArrayPresentWithZeroScores', () => {
    // Confirms the trap: results IS populated even for not_started matches.
    const match = normaliseMatch(notStartedFixture, 'lol')!;
    expect(match.results).toHaveLength(2);
    expect(match.results.every(r => r.score === 0)).toBe(true);
  });
});

// ── normaliseMatch — status mapping ───────────────────────────────────────────

describe('normaliseMatch (status mapping)', () => {
  it('NormaliseMatch_CanceledStatus_MapsToBritishCancelled', () => {
    const raw = { ...finishedFixture, status: 'canceled' };
    const match = normaliseMatch(raw, 'lol');
    expect(match?.status).toBe('cancelled');
  });

  it('NormaliseMatch_RunningStatus_MapsToRunning', () => {
    const raw = { ...finishedFixture, status: 'running' };
    const match = normaliseMatch(raw, 'lol');
    expect(match?.status).toBe('running');
  });
});

// ── normaliseMatch — edge cases ───────────────────────────────────────────────

describe('normaliseMatch (edge cases)', () => {
  it('NormaliseMatch_EmptyOpponents_ReturnsNull', () => {
    const raw = { ...finishedFixture, opponents: [] };
    expect(normaliseMatch(raw, 'lol')).toBeNull();
  });

  it('NormaliseMatch_OneOpponent_ReturnsNull', () => {
    const raw = { ...finishedFixture, opponents: finishedFixture.opponents.slice(0, 1) };
    expect(normaliseMatch(raw, 'lol')).toBeNull();
  });

  it('NormaliseMatch_NullBeginAt_ReturnsNull', () => {
    const raw = { ...finishedFixture, begin_at: null };
    expect(normaliseMatch(raw, 'lol')).toBeNull();
  });

  it('NormaliseMatch_NullWinnerId_SetsWinnerIdNull', () => {
    const raw = { ...finishedFixture, winner_id: null };
    const match = normaliseMatch(raw, 'lol');
    expect(match?.winnerId).toBeNull();
  });

  it('NormaliseMatch_EmptyAcronym_FallsBackToNameTruncation', () => {
    const raw = {
      ...finishedFixture,
      opponents: [
        {
          ...finishedFixture.opponents[0],
          opponent: { ...finishedFixture.opponents[0]!.opponent, acronym: '' },
        },
        finishedFixture.opponents[1]!,
      ],
    };
    const match = normaliseMatch(raw, 'lol');
    // 'Fluxo W7M' → first 4 chars uppercased
    expect(match?.teamA.acronym).toBe('FLUX');
  });

  it('NormaliseMatch_EmptyStreamsList_SetsOfficialStreamUrlNull', () => {
    const raw = { ...finishedFixture, streams_list: [] };
    const match = normaliseMatch(raw, 'lol');
    expect(match?.officialStreamUrl).toBeNull();
  });
});

// ── PandaScoreSource.fetchMatches ─────────────────────────────────────────────

describe('PandaScoreSource.fetchMatches', () => {
  it('FetchMatches_EmptyGames_ReturnsEmptyArrayWithoutFetching', async () => {
    const mockFetch = vi.fn();
    const source = new PandaScoreSource('token', mockFetch as typeof fetch);
    const result = await source.fetchMatches({ games: [], teamIds: [], competitionIds: [] });
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('FetchMatches_SingleGame_CallsAllThreeEndpoints', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [finishedFixture],
    });
    const source = new PandaScoreSource('token', mockFetch as typeof fetch);
    await source.fetchMatches({ games: ['lol'], teamIds: [], competitionIds: [] });
    expect(mockFetch).toHaveBeenCalledTimes(3); // running + upcoming + past
  });

  it('FetchMatches_SingleGame_PassesBearerToken', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    const source = new PandaScoreSource('my-secret-token', mockFetch as typeof fetch);
    await source.fetchMatches({ games: ['lol'], teamIds: [], competitionIds: [] });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer my-secret-token',
    );
  });

  it('FetchMatches_RateLimitOnAllEndpoints_ReturnsEmptyGracefully', async () => {
    // 429 errors are caught per-endpoint; fetchMatches degrades rather than throwing.
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const source = new PandaScoreSource('token', mockFetch as typeof fetch);
    const result = await source.fetchMatches({ games: ['lol'], teamIds: [], competitionIds: [] });
    expect(result).toEqual([]);
  });

  it('FetchMatches_AuthFailure_ReturnsEmptyGracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const source = new PandaScoreSource('bad-token', mockFetch as typeof fetch);
    const result = await source.fetchMatches({ games: ['lol'], teamIds: [], competitionIds: [] });
    expect(result).toEqual([]);
  });

  it('FetchMatches_FilterByTeamId_OnlyReturnsFollowedTeamMatches', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [finishedFixture, notStartedFixture],
    });
    const source = new PandaScoreSource('token', mockFetch as typeof fetch);
    // Follow FXW7 (id 136357) from the finished fixture only
    const result = await source.fetchMatches({
      games: ['lol'],
      teamIds: ['136357'],
      competitionIds: [],
    });
    expect(result.every(m => m.teamA.id === '136357' || m.teamB.id === '136357')).toBe(true);
  });

  it('FetchMatches_ResultsSortedByBeginAtUtcAscending', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      // notStarted begins after finished — return them in reverse to test sorting.
      json: async () => [notStartedFixture, finishedFixture],
    });
    const source = new PandaScoreSource('token', mockFetch as typeof fetch);
    const result = await source.fetchMatches({ games: ['lol'], teamIds: [], competitionIds: [] });
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.beginAtUtc <= result[i]!.beginAtUtc).toBe(true);
    }
  });
});

// ── normaliseMatch — Dota 2 fixture ───────────────────────────────────────────

describe('normaliseMatch (dota2 finished fixture)', () => {
  it('NormaliseMatch_Dota2Finished_MapsCoreFields', () => {
    const match = normaliseMatch(dota2FinishedFixture, 'dota2');
    expect(match).not.toBeNull();
    expect(match?.game).toBe('dota2');
    expect(match?.status).toBe('finished');
    expect(match?.bestOf).toBe(3);
    expect(match?.competition).toStrictEqual({ id: '4106', name: 'The International' });
  });

  it('NormaliseMatch_Dota2Finished_WinnerAndResultsByTeamId', () => {
    const match = normaliseMatch(dota2FinishedFixture, 'dota2')!;
    expect(match.winnerId).toBe('137772');
    expect(hasResult(match)).toBe(true);
    // Scores associated by team_id, not array order.
    expect(match.results.find(r => r.teamId === '137772')?.score).toBe(2);
    expect(match.results.find(r => r.teamId === '137771')?.score).toBe(0);
  });

  it('NormaliseMatch_Dota2Finished_NullAcronymFallsBack', () => {
    // "Game Master" has acronym null in the real response → name-truncation fallback.
    const match = normaliseMatch(dota2FinishedFixture, 'dota2')!;
    expect(match.teamB.id).toBe('137771');
    expect(match.teamB.acronym).toBe('GAME');
  });
});

// ── normaliseTeam ─────────────────────────────────────────────────────────────

describe('normaliseTeam', () => {
  it('NormaliseTeam_KeepsOnlyIdNameAcronym', () => {
    const team = normaliseTeam(teamsSearchFixture[0]);
    expect(team).toStrictEqual({ id: '3455', name: 'Vitality', acronym: 'VIT' });
    // Exactly these keys — no players[], image_url, location, slug, current_videogame.
    expect(Object.keys(team).sort()).toEqual(['acronym', 'id', 'name']);
  });

  it('NormaliseTeam_IdCoercedToString', () => {
    expect(normaliseTeam(teamsSearchFixture[1]).id).toBe('138618');
  });
});

// ── PandaScoreSource.searchTeams ──────────────────────────────────────────────

describe('PandaScoreSource.searchTeams', () => {
  it('SearchTeams_Normalises_KeepsOnlyIdNameAcronym', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => teamsSearchFixture,
    });
    const source = new PandaScoreSource('token', mockFetch as typeof fetch);

    const teams = await source.searchTeams('csgo', 'vitality');

    expect(teams).toStrictEqual([
      { id: '3455', name: 'Vitality', acronym: 'VIT' },
      { id: '138618', name: 'Vitality Academy', acronym: 'VIT.A' },
    ]);
  });

  it('SearchTeams_EmptyQuery_NoRequest', async () => {
    const mockFetch = vi.fn();
    const source = new PandaScoreSource('token', mockFetch as typeof fetch);

    expect(await source.searchTeams('csgo', '   ')).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('SearchTeams_EncodesQuery', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const source = new PandaScoreSource('token', mockFetch as typeof fetch);

    await source.searchTeams('csgo', 'team vitality');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/csgo/teams?');
    expect(url).toContain('search%5Bname%5D=team%20vitality');
    expect(url).toContain('per_page=10');
  });

  it('SearchTeams_PassesBearerToken', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const source = new PandaScoreSource('secret', mockFetch as typeof fetch);

    await source.searchTeams('csgo', 'vita');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer secret');
  });

  it('SearchTeams_AuthError_Maps', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const source = new PandaScoreSource('bad', mockFetch as typeof fetch);

    await expect(source.searchTeams('csgo', 'vita')).rejects.toBeInstanceOf(AuthError);
  });

  it('SearchTeams_NoMatches_ReturnsEmpty', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const source = new PandaScoreSource('token', mockFetch as typeof fetch);

    expect(await source.searchTeams('csgo', 'zzzznomatch')).toEqual([]);
  });
});
