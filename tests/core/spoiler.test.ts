import { describe, expect, it } from 'vitest';
import type { Match, MatchStatus } from '../../src/core/models';
import type { StorageArea } from '../../src/core/storage';
import {
  DEFAULT_SPOILER_PREFS,
  getRevealedSet,
  getSpoilerDecision,
  isRevealed,
  reveal,
  type SpoilerPrefs,
} from '../../src/core/spoiler';

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Builds a minimal valid Match with the given status; other fields are irrelevant
 *  to spoiler decisions but must be present to satisfy the type. */
function makeMatch(status: MatchStatus): Match {
  return {
    id: 'm1',
    game: 'lol',
    competition: { id: 'c1', name: 'Test League' },
    name: 'Team A vs Team B',
    teamA: { id: 'a', name: 'Team A', acronym: 'TA' },
    teamB: { id: 'b', name: 'Team B', acronym: 'TB' },
    beginAtUtc: '2026-06-09T10:00:00Z',
    endAtUtc: null,
    status,
    bestOf: 3,
    results: [
      { teamId: 'a', score: 0 },
      { teamId: 'b', score: 0 },
    ],
    winnerId: null,
    officialStreamUrl: null,
  };
}

/** In-memory StorageArea for reveal-state tests — no real chrome.storage. */
function makeMemoryStore(initial: Record<string, unknown> = {}): StorageArea {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
  };
}

/** StorageArea whose reads always throw — exercises the fail-safe path. */
const failingStore: StorageArea = {
  get: async () => {
    throw new Error('storage unavailable');
  },
  set: async () => {
    throw new Error('storage unavailable');
  },
};

const HIDE_RUNNING: SpoilerPrefs = { hideRunning: true };

// ── getSpoilerDecision ────────────────────────────────────────────────────────

describe('getSpoilerDecision', () => {
  it('GetSpoilerDecision_FinishedNotRevealed_Hides', () => {
    const decision = getSpoilerDecision(makeMatch('finished'), false, DEFAULT_SPOILER_PREFS);
    expect(decision).toStrictEqual({ hideScore: true, hideWinner: true });
  });

  it('GetSpoilerDecision_FinishedRevealed_Shows', () => {
    const decision = getSpoilerDecision(makeMatch('finished'), true, DEFAULT_SPOILER_PREFS);
    expect(decision).toStrictEqual({ hideScore: false, hideWinner: false });
  });

  it('GetSpoilerDecision_RunningDefault_Shows', () => {
    const decision = getSpoilerDecision(makeMatch('running'), false, DEFAULT_SPOILER_PREFS);
    expect(decision).toStrictEqual({ hideScore: false, hideWinner: false });
  });

  it('GetSpoilerDecision_RunningOptIn_Hides', () => {
    const decision = getSpoilerDecision(makeMatch('running'), false, HIDE_RUNNING);
    expect(decision).toStrictEqual({ hideScore: true, hideWinner: true });
  });

  it('GetSpoilerDecision_RunningRevealed_Shows', () => {
    // revealed wins even when the user has opted into guarding running matches.
    const decision = getSpoilerDecision(makeMatch('running'), true, HIDE_RUNNING);
    expect(decision).toStrictEqual({ hideScore: false, hideWinner: false });
  });

  it('GetSpoilerDecision_NotStarted_Shows', () => {
    expect(getSpoilerDecision(makeMatch('notStarted'), false, DEFAULT_SPOILER_PREFS)).toStrictEqual({
      hideScore: false,
      hideWinner: false,
    });
    // prefs must not change the outcome for notStarted.
    expect(getSpoilerDecision(makeMatch('notStarted'), false, HIDE_RUNNING)).toStrictEqual({
      hideScore: false,
      hideWinner: false,
    });
  });

  it('GetSpoilerDecision_Cancelled_Shows', () => {
    expect(getSpoilerDecision(makeMatch('cancelled'), false, DEFAULT_SPOILER_PREFS)).toStrictEqual({
      hideScore: false,
      hideWinner: false,
    });
    expect(getSpoilerDecision(makeMatch('cancelled'), false, HIDE_RUNNING)).toStrictEqual({
      hideScore: false,
      hideWinner: false,
    });
  });
});

// ── reveal state ──────────────────────────────────────────────────────────────

describe('reveal state', () => {
  it('Reveal_NewId_AddsToSet', async () => {
    const store = makeMemoryStore();
    await reveal('match-42', store);
    const set = await getRevealedSet(store);
    expect(set.has('match-42')).toBe(true);
  });

  it('Reveal_ExistingId_Idempotent', async () => {
    const store = makeMemoryStore();
    await reveal('match-42', store);
    await reveal('match-42', store);
    const set = await getRevealedSet(store);
    expect([...set]).toStrictEqual(['match-42']);
  });

  it('IsRevealed_UnknownId_False', async () => {
    const store = makeMemoryStore();
    expect(await isRevealed('never-revealed', store)).toBe(false);
  });

  it('IsRevealed_RevealedId_True', async () => {
    const store = makeMemoryStore();
    await reveal('match-7', store);
    expect(await isRevealed('match-7', store)).toBe(true);
  });

  it('GetRevealedSet_StorageFailure_ReturnsEmpty', async () => {
    // Fail safe: a read error must yield an empty set so we guard, never leak.
    const set = await getRevealedSet(failingStore);
    expect(set.size).toBe(0);
  });

  it('GetRevealedSet_NonArrayStored_ReturnsEmpty', async () => {
    // Corrupted/legacy value under the key must not throw.
    const store = makeMemoryStore({ 'spoiler:revealed': 'not-an-array' });
    const set = await getRevealedSet(store);
    expect(set.size).toBe(0);
  });

  it('Reveal_MultipleIds_AllPersisted', async () => {
    const store = makeMemoryStore();
    await reveal('a', store);
    await reveal('b', store);
    const set = await getRevealedSet(store);
    expect(set).toStrictEqual(new Set(['a', 'b']));
  });
});
