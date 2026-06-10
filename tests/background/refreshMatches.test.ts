import { describe, expect, it, vi } from 'vitest';
import { refreshMatches, type RefreshDeps } from '../../src/background';
import type { FollowConfig, Match } from '../../src/core/models';

const EMPTY_FOLLOW: FollowConfig = { games: [], teamIds: [], competitionIds: [] };
const LOL_FOLLOW: FollowConfig = { games: ['lol'], teamIds: [], competitionIds: [] };

function sampleMatch(): Match {
  return {
    id: 'm1',
    game: 'lol',
    competition: { id: 'c1', name: 'LCK' },
    name: 'A vs B',
    teamA: { id: 'a', name: 'Team A', acronym: 'TA' },
    teamB: { id: 'b', name: 'Team B', acronym: 'TB' },
    beginAtUtc: '2026-06-09T10:00:00Z',
    endAtUtc: null,
    status: 'notStarted',
    bestOf: 3,
    results: [],
    winnerId: null,
    officialStreamUrl: null,
  };
}

describe('refreshMatches', () => {
  it('RefreshMatches_EmptyGames_NoFetchNoCacheWrite', async () => {
    const fetchMatches = vi.fn();
    const saveCachedMatches = vi.fn();
    const deps: RefreshDeps = {
      loadFollowConfig: async () => EMPTY_FOLLOW,
      fetchMatches,
      saveCachedMatches,
    };

    await refreshMatches(deps);

    expect(fetchMatches).not.toHaveBeenCalled();
    expect(saveCachedMatches).not.toHaveBeenCalled();
  });

  it('RefreshMatches_FetchSuccess_WritesCacheWithNormalisedList', async () => {
    const matches = [sampleMatch()];
    const saveCachedMatches = vi.fn().mockResolvedValue(undefined);
    const deps: RefreshDeps = {
      loadFollowConfig: async () => LOL_FOLLOW,
      fetchMatches: async () => matches,
      saveCachedMatches,
    };

    await refreshMatches(deps);

    expect(saveCachedMatches).toHaveBeenCalledTimes(1);
    expect(saveCachedMatches).toHaveBeenCalledWith(matches);
  });

  it('RefreshMatches_FetchThrows_PreviousCacheUntouched', async () => {
    const saveCachedMatches = vi.fn();
    const deps: RefreshDeps = {
      loadFollowConfig: async () => LOL_FOLLOW,
      fetchMatches: async () => {
        throw new Error('rate limited');
      },
      saveCachedMatches,
    };

    // Must not throw — failure is swallowed so the SW keeps running.
    await expect(refreshMatches(deps)).resolves.toBeUndefined();
    // Cache write never happens, so the previous cache is left intact.
    expect(saveCachedMatches).not.toHaveBeenCalled();
  });
});
