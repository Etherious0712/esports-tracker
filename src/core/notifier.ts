import type { Match, NotificationPrefs } from './models';

// Pure notification logic — no chrome APIs, no I/O. The background entrypoint
// wires this to chrome.notifications and persists the sent-set.

export type NotificationKind = 'pre' | 'end';

export interface PendingNotification {
  /** Idempotency key: `${matchId}:${kind}`. Doubles as the chrome notification id. */
  key: string;
  kind: NotificationKind;
  match: Match;
  title: string;
  message: string;
}

/**
 * The outcome of a compute pass.
 *
 * Note: this refines the spec's documented `PendingNotification[]` output into a
 * structured result, because the "drop a kickoff-passed pre but still mark it
 * sent" rule cannot be expressed by a flat list of things-to-fire. `toMarkSent`
 * carries keys that must be added to the sent-set WITHOUT firing a notification.
 */
export interface NotificationPlan {
  toFire: PendingNotification[];
  toMarkSent: string[];
}

const MS_PER_MINUTE = 60_000;

const PRE_TITLE = 'Match starting soon';
const END_TITLE_SAFE = 'VOD ready to watch';
const END_TITLE_WITH_SCORE = 'Match finished';

function preKey(matchId: string): string {
  return `${matchId}:pre`;
}

function endKey(matchId: string): string {
  return `${matchId}:end`;
}

/** Final score as "a - b", looked up by team id (never by array order). */
function formatScore(match: Match): string {
  const a = match.results.find(r => r.teamId === match.teamA.id)?.score ?? 0;
  const b = match.results.find(r => r.teamId === match.teamB.id)?.score ?? 0;
  return `${a} - ${b}`;
}

/**
 * Builds the title/body for a notification.
 *
 * Spoiler-safe rule: when prefs.spoilerSafeWording is true, the END message
 * carries NO score and NO indication of the winner — not in the title, the body,
 * or any field. Team names alone are not spoilers and may appear. Only the
 * non-safe path includes the score.
 */
export function buildMessage(
  match: Match,
  kind: NotificationKind,
  prefs: NotificationPrefs,
): { title: string; message: string } {
  const fixture = `${match.teamA.name} vs ${match.teamB.name}`;

  if (kind === 'pre') {
    return {
      title: PRE_TITLE,
      message: `${fixture} — starts in ~${prefs.leadMinutes} min`,
    };
  }

  if (prefs.spoilerSafeWording) {
    return {
      title: END_TITLE_SAFE,
      message: `${fixture} has finished — VOD ready to watch`,
    };
  }

  return {
    title: END_TITLE_WITH_SCORE,
    message: `${match.teamA.name} ${formatScore(match)} ${match.teamB.name}`,
  };
}

function buildPending(match: Match, kind: NotificationKind, prefs: NotificationPrefs): PendingNotification {
  const { title, message } = buildMessage(match, kind, prefs);
  return {
    key: kind === 'pre' ? preKey(match.id) : endKey(match.id),
    kind,
    match,
    title,
    message,
  };
}

/**
 * Decides which notifications should fire at `nowUtc`, given the already-sent keys.
 * Pure and deterministic — inject `nowUtc` and `sent` for testing.
 *
 * Per-match rules:
 *   PRE: notStarted AND now within [begin - leadMinutes, begin] AND not already sent.
 *        If kickoff has passed (now > begin) and the pre was never sent, it is DROPPED
 *        and marked sent — a missed pre is never fired late.
 *   END: notifyOnEnd AND finished AND not already sent.
 *
 * cancelled/running produce nothing. A match first seen already finished is still
 * eligible for END but never a late PRE (its status is not notStarted).
 */
export function computeNotifications(
  matches: Match[],
  prefs: NotificationPrefs,
  nowUtc: string,
  sent: Set<string>,
): NotificationPlan {
  const plan: NotificationPlan = { toFire: [], toMarkSent: [] };
  if (!prefs.enabled) return plan;

  const now = Date.parse(nowUtc);
  const leadMs = prefs.leadMinutes * MS_PER_MINUTE;

  for (const match of matches) {
    if (match.status === 'notStarted') {
      const key = preKey(match.id);
      if (!sent.has(key)) {
        const begin = Date.parse(match.beginAtUtc);
        const windowStart = begin - leadMs;
        if (now >= windowStart && now <= begin) {
          plan.toFire.push(buildPending(match, 'pre', prefs));
        } else if (now > begin) {
          // Kickoff already passed (SW was likely asleep) — drop, never fire late.
          plan.toMarkSent.push(key);
        }
      }
    }

    if (prefs.notifyOnEnd && match.status === 'finished') {
      const key = endKey(match.id);
      if (!sent.has(key)) {
        plan.toFire.push(buildPending(match, 'end', prefs));
      }
    }
  }

  return plan;
}

/**
 * Drops sent keys whose match is no longer in the cache, so the sent-set cannot
 * grow without bound. Pure. Key format is `${matchId}:${kind}`; matchIds are
 * numeric strings (no colon), so splitting on the last colon is safe.
 */
export function pruneSentKeys(sent: Set<string>, matches: Match[]): Set<string> {
  const liveIds = new Set(matches.map(m => m.id));
  const kept = new Set<string>();
  for (const key of sent) {
    const matchId = key.slice(0, key.lastIndexOf(':'));
    if (liveIds.has(matchId)) kept.add(key);
  }
  return kept;
}
