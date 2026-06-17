import { describe, expect, it } from 'vitest';
import type { Match, MatchStatus, NotificationPrefs } from '../../src/core/models';
import {
  buildMessage,
  computeNotifications,
  gateNotificationPrefs,
  pruneSentKeys,
} from '../../src/core/notifier';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BEGIN = '2026-06-09T12:00:00Z';
// leadMinutes = 15 → pre window is [11:45, 12:00].
const NOW_IN_WINDOW = '2026-06-09T11:50:00Z';
const NOW_TOO_EARLY = '2026-06-09T11:30:00Z';
const NOW_KICKOFF_PASSED = '2026-06-09T12:05:00Z';

const PREFS: NotificationPrefs = {
  enabled: true,
  leadMinutes: 15,
  notifyOnEnd: true,
  spoilerSafeWording: true,
};

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: '100',
    game: 'lol',
    competition: { id: 'c1', name: 'LCK' },
    name: 'A vs B',
    teamA: { id: 'a', name: 'Team Alpha', acronym: 'ALP' },
    teamB: { id: 'b', name: 'Team Beta', acronym: 'BET' },
    beginAtUtc: BEGIN,
    endAtUtc: null,
    status: 'notStarted',
    bestOf: 3,
    results: [
      { teamId: 'a', score: 0 },
      { teamId: 'b', score: 0 },
    ],
    winnerId: null,
    officialStreamUrl: null,
    ...overrides,
  };
}

function finished(overrides: Partial<Match> = {}): Match {
  return makeMatch({
    status: 'finished',
    endAtUtc: '2026-06-09T13:00:00Z',
    results: [
      { teamId: 'a', score: 2 },
      { teamId: 'b', score: 1 },
    ],
    winnerId: 'a',
    ...overrides,
  });
}

function withStatus(status: MatchStatus): Match {
  return makeMatch({ status });
}

// ── computeNotifications ──────────────────────────────────────────────────────

describe('computeNotifications', () => {
  it('Compute_Disabled_NothingFires', () => {
    const prefs = { ...PREFS, enabled: false };
    const plan = computeNotifications([makeMatch(), finished()], prefs, NOW_IN_WINDOW, new Set());
    expect(plan.toFire).toEqual([]);
    expect(plan.toMarkSent).toEqual([]);
  });

  it('Compute_WithinPreWindow_EmitsPre', () => {
    const plan = computeNotifications([makeMatch()], PREFS, NOW_IN_WINDOW, new Set());
    expect(plan.toFire).toHaveLength(1);
    expect(plan.toFire[0]!.kind).toBe('pre');
    expect(plan.toFire[0]!.key).toBe('100:pre');
  });

  it('Compute_OutsidePreWindow_NoPre', () => {
    const plan = computeNotifications([makeMatch()], PREFS, NOW_TOO_EARLY, new Set());
    expect(plan.toFire).toEqual([]);
    expect(plan.toMarkSent).toEqual([]);
  });

  it('Compute_KickoffPassed_NoLatePre', () => {
    const plan = computeNotifications([makeMatch()], PREFS, NOW_KICKOFF_PASSED, new Set());
    // Dropped — never fired late...
    expect(plan.toFire.some(n => n.kind === 'pre')).toBe(false);
    // ...but marked sent so it cannot fire on a later tick.
    expect(plan.toMarkSent).toContain('100:pre');
  });

  it('Compute_PreAlreadySent_NoDuplicate', () => {
    const plan = computeNotifications([makeMatch()], PREFS, NOW_IN_WINDOW, new Set(['100:pre']));
    expect(plan.toFire).toEqual([]);
    expect(plan.toMarkSent).toEqual([]);
  });

  it('Compute_Finished_EmitsEnd', () => {
    const plan = computeNotifications([finished()], PREFS, NOW_IN_WINDOW, new Set());
    expect(plan.toFire).toHaveLength(1);
    expect(plan.toFire[0]!.kind).toBe('end');
    expect(plan.toFire[0]!.key).toBe('100:end');
  });

  it('Compute_NotifyOnEndFalse_NoEnd', () => {
    const prefs = { ...PREFS, notifyOnEnd: false };
    const plan = computeNotifications([finished()], prefs, NOW_IN_WINDOW, new Set());
    expect(plan.toFire).toEqual([]);
  });

  it('Compute_EndAlreadySent_NoDuplicate', () => {
    const plan = computeNotifications([finished()], PREFS, NOW_IN_WINDOW, new Set(['100:end']));
    expect(plan.toFire).toEqual([]);
  });

  it('Compute_Cancelled_Nothing', () => {
    const plan = computeNotifications([withStatus('cancelled')], PREFS, NOW_IN_WINDOW, new Set());
    expect(plan.toFire).toEqual([]);
    expect(plan.toMarkSent).toEqual([]);
  });

  it('Compute_FinishedOnFirstSight_EndButNoLatePre', () => {
    // A match seen already finished is eligible for END but never a late PRE.
    const plan = computeNotifications([finished()], PREFS, NOW_KICKOFF_PASSED, new Set());
    expect(plan.toFire.map(n => n.kind)).toEqual(['end']);
    expect(plan.toMarkSent).toEqual([]); // no pre to drop (status was never notStarted)
  });
});

// ── buildMessage (spoiler safety) ─────────────────────────────────────────────

describe('buildMessage', () => {
  it('BuildMessage_EndSpoilerSafe_NoScore', () => {
    const match = finished(); // A beat B 2-1
    const { title, message } = buildMessage(match, 'end', { ...PREFS, spoilerSafeWording: true });
    const combined = `${title} ${message}`;
    // No score digits anywhere.
    expect(/\d/.test(combined)).toBe(false);

    // No winner leak: the message must be identical if the winner/score were the
    // other way round. Team names appearing symmetrically is fine.
    const swapped = finished({
      results: [
        { teamId: 'a', score: 1 },
        { teamId: 'b', score: 2 },
      ],
      winnerId: 'b',
    });
    const swappedOut = buildMessage(swapped, 'end', { ...PREFS, spoilerSafeWording: true });
    expect(swappedOut.title).toBe(title);
    expect(swappedOut.message).toBe(message);
  });

  it('BuildMessage_EndNotSafe_HasScore', () => {
    const { message } = buildMessage(finished(), 'end', { ...PREFS, spoilerSafeWording: false });
    expect(message).toContain('2 - 1');
  });

  it('BuildMessage_Pre_MentionsLeadMinutesNoScore', () => {
    const { title, message } = buildMessage(makeMatch(), 'pre', PREFS);
    expect(title).toBe('Match starting soon');
    expect(message).toContain('15');
    expect(message).toContain('Team Alpha vs Team Beta');
  });
});

// ── gateNotificationPrefs (notification-wording gate) ─────────────────────────

describe('gateNotificationPrefs', () => {
  it('GateNotificationPrefs_SpoilerEnabledSafeWording_Unchanged', () => {
    const prefs: NotificationPrefs = { ...PREFS, spoilerSafeWording: true };
    expect(gateNotificationPrefs(prefs, true)).toEqual(prefs);
  });

  it('GateNotificationPrefs_SpoilerDisabledSafeWording_ForcesScore', () => {
    const prefs: NotificationPrefs = { ...PREFS, spoilerSafeWording: true };
    const gated = gateNotificationPrefs(prefs, false);
    expect(gated.spoilerSafeWording).toBe(false);
    // The END message now carries the score, governed by the single visible toggle.
    expect(buildMessage(finished(), 'end', gated).message).toContain('2 - 1');
  });

  it('GateNotificationPrefs_SpoilerEnabledNoSafeWording_Unchanged', () => {
    const prefs: NotificationPrefs = { ...PREFS, spoilerSafeWording: false };
    expect(gateNotificationPrefs(prefs, true)).toEqual(prefs);
  });

  it('GateNotificationPrefs_LeavesOtherFieldsIntact', () => {
    const prefs: NotificationPrefs = {
      enabled: true,
      leadMinutes: 15,
      notifyOnEnd: true,
      spoilerSafeWording: true,
    };
    const gated = gateNotificationPrefs(prefs, false);
    expect(gated.enabled).toBe(prefs.enabled);
    expect(gated.notifyOnEnd).toBe(prefs.notifyOnEnd);
    expect(gated.leadMinutes).toBe(prefs.leadMinutes);
  });

  it('GateNotificationPrefs_PreMessageIdenticalRegardlessOfSpoiler', () => {
    const prefs: NotificationPrefs = { ...PREFS, spoilerSafeWording: true };
    const enabled = buildMessage(makeMatch(), 'pre', gateNotificationPrefs(prefs, true));
    const disabled = buildMessage(makeMatch(), 'pre', gateNotificationPrefs(prefs, false));
    expect(disabled).toEqual(enabled);
  });
});

// ── pruneSentKeys ─────────────────────────────────────────────────────────────

describe('pruneSentKeys', () => {
  it('PruneSentKeys_DropsKeysForMatchesNotInCache', () => {
    const sent = new Set(['100:pre', '100:end', '999:end']);
    const pruned = pruneSentKeys(sent, [makeMatch({ id: '100' })]);
    expect(pruned).toStrictEqual(new Set(['100:pre', '100:end']));
  });

  it('PruneSentKeys_EmptyCache_DropsEverything', () => {
    const sent = new Set(['100:pre', '200:end']);
    expect(pruneSentKeys(sent, []).size).toBe(0);
  });
});
