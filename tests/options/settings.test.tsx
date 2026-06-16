// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowConfig, NotificationPrefs, Team } from '../../src/core/models';
import type { SpoilerPrefs } from '../../src/core/spoiler';

// Mock the storage module so the settings page persists through vi.fn()s rather
// than a real chrome.storage. Defaults are overridden per test via mockResolvedValue.
const getFollowConfig = vi.fn<() => Promise<FollowConfig>>();
const setFollowConfig = vi.fn<(c: FollowConfig) => Promise<void>>();
const getSpoilerPrefs = vi.fn<() => Promise<SpoilerPrefs>>();
const setSpoilerPrefs = vi.fn<(p: SpoilerPrefs) => Promise<void>>();
const getFollowedTeams = vi.fn<() => Promise<Team[]>>();

vi.mock('../../src/core/storage', () => ({
  getFollowConfig,
  setFollowConfig,
  getSpoilerPrefs,
  setSpoilerPrefs,
  getFollowedTeams,
  followTeam: vi.fn(),
  unfollowTeam: vi.fn(),
  // Present in the real module; unused here but kept so the shape matches.
  getNotificationPrefs: vi.fn<() => Promise<NotificationPrefs>>(),
  setNotificationPrefs: vi.fn(),
}));

// The settings page messages the service worker after a change.
const sendMessage = vi.fn(() => Promise.resolve(undefined));

// Imported after the mock is registered.
const { App } = await import('../../src/entrypoints/options/App');

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage } };
  getFollowConfig.mockResolvedValue({ games: [], teamIds: [], competitionIds: [] });
  setFollowConfig.mockResolvedValue();
  getSpoilerPrefs.mockResolvedValue({ enabled: true, hideRunning: false });
  setSpoilerPrefs.mockResolvedValue();
  getFollowedTeams.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe('Settings page', () => {
  it('Settings_SelectGame_PersistsViaSetFollowConfig', async () => {
    const { getByLabelText, findByText } = render(<App />);
    // Wait for the "no games" hint, which only renders once loading has finished.
    await findByText(/no games selected/i);

    fireEvent.click(getByLabelText('League of Legends'));

    await waitFor(() => expect(setFollowConfig).toHaveBeenCalledTimes(1));
    const saved = setFollowConfig.mock.calls[0]![0];
    expect(saved.games).toContain('lol');
  });

  it('Settings_ToggleHideRunning_PersistsViaSetSpoilerPrefs', async () => {
    const { getByLabelText, findByText } = render(<App />);
    await findByText(/no games selected/i);

    fireEvent.click(getByLabelText(/guard in-progress matches too/i));

    await waitFor(() => expect(setSpoilerPrefs).toHaveBeenCalledTimes(1));
    // Writes the FULL prefs so the enabled flag isn't dropped.
    expect(setSpoilerPrefs).toHaveBeenCalledWith({ enabled: true, hideRunning: true });
  });

  it('Settings_LoadsExistingValues_OnOpen', async () => {
    getFollowConfig.mockResolvedValue({ games: ['lol'], teamIds: [], competitionIds: [] });
    getSpoilerPrefs.mockResolvedValue({ enabled: true, hideRunning: true });

    const { getByLabelText } = render(<App />);

    await waitFor(() => {
      expect((getByLabelText('League of Legends') as HTMLInputElement).checked).toBe(true);
      expect((getByLabelText(/guard in-progress/i) as HTMLInputElement).checked).toBe(true);
    });
  });

  it('Settings_SelectGame_RequestsBackgroundRefresh', async () => {
    const { getByLabelText, findByText } = render(<App />);
    await findByText(/no games selected/i);

    fireEvent.click(getByLabelText('Counter-Strike 2'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'refresh' }));
  });
});
