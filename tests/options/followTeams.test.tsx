// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowConfig, GameId, NotificationPrefs, Team } from '../../src/core/models';
import type { SpoilerPrefs } from '../../src/core/spoiler';

const getFollowConfig = vi.fn<() => Promise<FollowConfig>>();
const getSpoilerPrefs = vi.fn<() => Promise<SpoilerPrefs>>();
const getFollowedTeams = vi.fn<() => Promise<Team[]>>();
const followTeam = vi.fn<(t: Team) => Promise<void>>();
const unfollowTeam = vi.fn<(id: string) => Promise<void>>();

vi.mock('../../src/core/storage', () => ({
  getFollowConfig,
  setFollowConfig: vi.fn(),
  getSpoilerPrefs,
  setSpoilerPrefs: vi.fn(),
  getFollowedTeams,
  followTeam,
  unfollowTeam,
  getNotificationPrefs: vi.fn<() => Promise<NotificationPrefs>>(),
  setNotificationPrefs: vi.fn(),
}));

const sendMessage = vi.fn(() => Promise.resolve(undefined));

const { App } = await import('../../src/entrypoints/options/App');

const VITALITY: Team = { id: '3455', name: 'Vitality', acronym: 'VIT' };

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage } };
  getFollowConfig.mockResolvedValue({ games: ['csgo'], teamIds: [], competitionIds: [] });
  getSpoilerPrefs.mockResolvedValue({ enabled: true, hideRunning: false });
  getFollowedTeams.mockResolvedValue([]);
  followTeam.mockResolvedValue();
  unfollowTeam.mockResolvedValue();
});

afterEach(() => cleanup());

describe('Followed teams settings', () => {
  it('NoGameSelected_ShowsSelectGameHint', async () => {
    getFollowConfig.mockResolvedValue({ games: [], teamIds: [], competitionIds: [] });
    const search = vi.fn<(g: GameId, q: string) => Promise<Team[]>>().mockResolvedValue([]);
    const { findByText, queryByPlaceholderText } = render(<App searchTeams={search} />);

    await findByText(/select a game first/i);
    expect(queryByPlaceholderText('Search teams…')).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it('Typing_DebouncedSearch_ShowsResults', async () => {
    const search = vi.fn<(g: GameId, q: string) => Promise<Team[]>>().mockResolvedValue([VITALITY]);
    const { findByPlaceholderText, findByText } = render(<App searchTeams={search} />);

    const input = await findByPlaceholderText('Search teams…');
    fireEvent.input(input, { target: { value: 'vita' } });

    // Debounced — fires once for the selected game, with the trimmed query.
    await waitFor(() => expect(search).toHaveBeenCalledWith('csgo', 'vita'));
    await findByText(/Vitality \(VIT\)/);
  });

  it('EmptyQuery_NoSearch', async () => {
    const search = vi.fn<(g: GameId, q: string) => Promise<Team[]>>().mockResolvedValue([]);
    const { findByPlaceholderText } = render(<App searchTeams={search} />);

    const input = await findByPlaceholderText('Search teams…');
    fireEvent.input(input, { target: { value: '   ' } });

    // Give the debounce window time to (not) fire.
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(search).not.toHaveBeenCalled();
  });

  it('FollowResult_PersistsAndAppearsInFollowed', async () => {
    const search = vi.fn<(g: GameId, q: string) => Promise<Team[]>>().mockResolvedValue([VITALITY]);
    const { findByPlaceholderText, findByText, getAllByText } = render(<App searchTeams={search} />);

    fireEvent.input(await findByPlaceholderText('Search teams…'), { target: { value: 'vita' } });
    const followButton = (await findByText('+ Follow')) as HTMLButtonElement;
    fireEvent.click(followButton);

    await waitFor(() => expect(followTeam).toHaveBeenCalledWith(VITALITY));
    // Appears under the Followed list with a Remove control (and still in results).
    await findByText('× Remove');
    expect(getAllByText(/Vitality \(VIT\)/).length).toBeGreaterThan(0);
  });

  it('RemoveFollowed_PersistsRemoval', async () => {
    getFollowedTeams.mockResolvedValue([VITALITY]);
    const search = vi.fn<(g: GameId, q: string) => Promise<Team[]>>().mockResolvedValue([]);
    const { findByText } = render(<App searchTeams={search} />);

    const removeButton = (await findByText('× Remove')) as HTMLButtonElement;
    fireEvent.click(removeButton);

    await waitFor(() => expect(unfollowTeam).toHaveBeenCalledWith('3455'));
  });

  it('SearchError_ShowsInlineMessage', async () => {
    const search = vi
      .fn<(g: GameId, q: string) => Promise<Team[]>>()
      .mockRejectedValue(new Error('boom'));
    const { findByPlaceholderText, findByText } = render(<App searchTeams={search} />);

    fireEvent.input(await findByPlaceholderText('Search teams…'), { target: { value: 'vita' } });

    await findByText(/search failed/i);
  });
});
