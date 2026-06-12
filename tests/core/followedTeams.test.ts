import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Team } from '../../src/core/models';
import {
  followTeam,
  getFollowConfig,
  getFollowedTeams,
  unfollowTeam,
} from '../../src/core/storage';

// Minimal in-memory chrome.storage.sync so the storage helpers run without a browser.
function installMemoryChrome(initial: Record<string, unknown> = {}): void {
  const store: Record<string, unknown> = { ...initial };
  const area = {
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { sync: area, local: area },
  };
}

const VITALITY: Team = { id: '3455', name: 'Vitality', acronym: 'VIT' };
const FAZE: Team = { id: '3206', name: 'FaZe Clan', acronym: 'FaZe' };

beforeEach(() => {
  // Start with a game already selected, to prove games are preserved on team changes.
  installMemoryChrome({ followConfig: { games: ['csgo'], teamIds: [], competitionIds: [] } });
});

afterEach(() => {
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
});

describe('followTeam / unfollowTeam', () => {
  it('Follow_AddsToBothStores', async () => {
    await followTeam(VITALITY);

    expect(await getFollowedTeams()).toEqual([VITALITY]);
    const follow = await getFollowConfig();
    expect(follow.teamIds).toEqual(['3455']);
    // Existing game selection is preserved.
    expect(follow.games).toEqual(['csgo']);
  });

  it('Follow_DuplicateId_Deduped', async () => {
    await followTeam(VITALITY);
    await followTeam({ ...VITALITY, name: 'Vitality (dupe)' });

    expect(await getFollowedTeams()).toHaveLength(1);
    expect((await getFollowConfig()).teamIds).toEqual(['3455']);
  });

  it('Follow_StoresOnlyIdNameAcronym', async () => {
    // Extra fields on the input must not be persisted.
    await followTeam({ ...VITALITY, extra: 'noise' } as unknown as Team);
    const stored = (await getFollowedTeams())[0]!;
    expect(Object.keys(stored).sort()).toEqual(['acronym', 'id', 'name']);
  });

  it('Follow_Remove_UpdatesBoth', async () => {
    await followTeam(VITALITY);
    await followTeam(FAZE);
    await unfollowTeam('3455');

    expect(await getFollowedTeams()).toEqual([FAZE]);
    expect((await getFollowConfig()).teamIds).toEqual(['3206']);
  });

  it('Remove_LastTeam_EmptiesBothStores', async () => {
    await followTeam(VITALITY);
    await unfollowTeam('3455');

    expect(await getFollowedTeams()).toEqual([]);
    // Empty teamIds = "track all" again (additive feature, not a gate).
    expect((await getFollowConfig()).teamIds).toEqual([]);
  });
});
