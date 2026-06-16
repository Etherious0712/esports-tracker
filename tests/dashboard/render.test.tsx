// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Match, MatchStatus } from '../../src/core/models';

// In-memory chrome.storage area matching the subset storage.ts/spoiler.ts use.
function memoryArea(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
  };
}

function installChrome(cachedMatches: Match[]): void {
  const local = memoryArea({
    cachedMatches,
    cacheTimestamp: '2026-06-10T00:00:00Z',
    'spoiler:revealed': [],
  });
  const sync = memoryArea({ spoilerPrefs: { enabled: true, hideRunning: false } });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage: vi.fn(() => Promise.resolve()), getURL: (p: string) => p },
    storage: { local, sync },
  };
}

function makeMatch(status: MatchStatus, overrides: Partial<Match> = {}): Match {
  return {
    id: `${status}-1`,
    game: 'lol',
    competition: { id: `${status}-comp`, name: `${status} Cup` },
    name: 'A vs B',
    teamA: { id: 'a', name: 'Team Alpha', acronym: 'ALP' },
    teamB: { id: 'b', name: 'Team Beta', acronym: 'BET' },
    beginAtUtc: '2026-06-09T10:00:00Z',
    endAtUtc: status === 'finished' ? '2026-06-09T11:00:00Z' : null,
    status,
    bestOf: 3,
    results: [
      { teamId: 'a', score: 2 },
      { teamId: 'b', score: 1 },
    ],
    winnerId: status === 'finished' ? 'a' : null,
    officialStreamUrl: null,
    ...overrides,
  };
}

// Imported after the chrome mock pattern is established (module reads chrome lazily).
const { App } = await import('../../src/entrypoints/dashboard/App');

// Section headings are <h1>s; the nav items are buttons. Query sections by the
// heading role so "Upcoming" (also a nav button label) is unambiguous.
const heading = (name: string) => ({ role: 'heading' as const, name });

afterEach(() => {
  cleanup();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
});

describe('DashboardApp two-view rendering', () => {
  it('DefaultTabIsMain_ShowsLiveAndFinished_NotUpcoming', async () => {
    installChrome([makeMatch('running'), makeMatch('finished'), makeMatch('notStarted')]);
    const { findByRole, queryByRole } = render(<App />);

    // Loaded once the nav appears.
    await findByRole('button', { name: 'Live & Results' });
    expect(queryByRole(heading('Live').role, { name: 'Live' })).not.toBeNull();
    expect(queryByRole(heading('Finished').role, { name: 'Finished' })).not.toBeNull();
    // Upcoming section heading is not rendered on the main tab.
    expect(queryByRole('heading', { name: 'Upcoming' })).toBeNull();
  });

  it('SwitchToUpcoming_SwapsContent', async () => {
    installChrome([makeMatch('running'), makeMatch('finished'), makeMatch('notStarted')]);
    const { findByRole, queryByRole } = render(<App />);

    fireEvent.click(await findByRole('button', { name: 'Upcoming' }));

    await waitFor(() => expect(queryByRole('heading', { name: 'Upcoming' })).not.toBeNull());
    expect(queryByRole('heading', { name: 'Live' })).toBeNull();
    expect(queryByRole('heading', { name: 'Finished' })).toBeNull();
  });

  it('MainWithOnlyFinished_ShowsFinishedNoLive', async () => {
    installChrome([makeMatch('finished')]);
    const { findByRole, queryByRole } = render(<App />);

    await findByRole('button', { name: 'Live & Results' });
    expect(queryByRole('heading', { name: 'Finished' })).not.toBeNull();
    expect(queryByRole('heading', { name: 'Live' })).toBeNull();
    expect(queryByRole('heading', { name: 'Upcoming' })).toBeNull();
  });

  it('MainEmpty_ShowsPerViewLine', async () => {
    // Only upcoming exists → the main tab (default) has nothing live or finished.
    installChrome([makeMatch('notStarted')]);
    const { findByText } = render(<App />);
    await findByText('No live or finished matches right now.');
  });

  it('UpcomingEmpty_ShowsPerViewLine', async () => {
    installChrome([makeMatch('finished')]);
    const { findByRole, findByText } = render(<App />);

    fireEvent.click(await findByRole('button', { name: 'Upcoming' }));
    await findByText('No upcoming matches.');
  });

  it('WholeViewEmpty_ShowsPageEmptyState', async () => {
    installChrome([]);
    const { findByText, queryByRole } = render(<App />);
    await findByText(/pick games in settings/i);
    // No nav when there's no data at all.
    expect(queryByRole('button', { name: 'Live & Results' })).toBeNull();
  });

  it('SpoilerReused_FinishedMaskedAndRevealable', async () => {
    installChrome([makeMatch('finished')]);
    const { findByRole, container } = render(<App />);

    await findByRole('button', { name: 'Live & Results' });
    expect(container.textContent).toContain('— : —');
    expect(container.textContent).not.toContain('2 - 1');

    fireEvent.click(await findByRole('button', { name: /show result/i }));
    await waitFor(() => expect(container.textContent).toContain('2 - 1'));
  });
});
