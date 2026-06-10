# EsportsTracker — Notification Engine Spec (core/notifier.ts)

> Implementation spec for match reminders. Claude Code implements against this.
> Builds on the shipped data layer, spoiler engine, and the background refresh loop
> (the ~10-min alarm already runs). Pure logic in `core/notifier.ts`; the entrypoint
> wires `chrome.notifications`. British English throughout.

---

## 1. Scope (locked — follow the blueprint, add nothing extra)

**In**:
- **Pre-match reminder**: one notification ~`leadMinutes` (default 15) before kickoff.
- **Post-match reminder**: one "VOD ready" notification when a match finishes, **spoiler-safe**
  (no score) when `spoilerSafeWording` is true.
- **Dedup**: each match fires its pre and its end notification at most once, ever
  (idempotency keys `${matchId}:pre` / `${matchId}:end`).
- **Spoiler-safe wording** honoured per `NotificationPrefs`.
- Respect `NotificationPrefs.enabled` (master off switch) and `notifyOnEnd`.

**Out (later / not now)**:
- Per-team / per-competition rules, quiet hours, lead-time customisation UI (Full-blueprint rules engine).
- Any notification that includes a score when `spoilerSafeWording` is true.
- Click-through actions beyond opening the official stream link (keep MVP simple).

---

## 2. Existing pieces this builds on

- `NotificationPrefs` (already in `models.ts`): `enabled`, `leadMinutes`, `notifyOnEnd`, `spoilerSafeWording`.
- `getNotificationPrefs()` (already in `storage.ts`).
- The background refresh loop + ~10-min `chrome.alarms` (already running).
- `Match` with `beginAtUtc`, `endAtUtc`, `status`, `officialStreamUrl`.

---

## 3. Core logic (core/notifier.ts) — pure, no chrome APIs

### Blueprint: computeNotifications
```
Purpose:    Given the current matches, prefs, "now", and the set of already-sent keys,
            decide which notifications should fire right now. Pure: no I/O, no chrome.
Inputs:     matches: Match[]; prefs: NotificationPrefs; nowUtc: string (ISO);
            sent: Set<string> (already-fired idempotency keys)
Outputs:    PendingNotification[] = { key, kind: 'pre'|'end', match, title, message }
Components: computeNotifications(matches, prefs, nowUtc, sent); buildMessage(match, kind, prefs)
Data flow:  background alarm → load matches+prefs+sent → computeNotifications → fire each → record keys
Decision per match:
  • if !prefs.enabled → nothing
  • PRE: status === 'notStarted' AND now is within [begin - leadMinutes, begin]
         AND `${id}:pre` not in sent  → emit pre
  • END: prefs.notifyOnEnd AND status === 'finished'
         AND `${id}:end` not in sent  → emit end
Edge cases:
  • MV3 SW sleeps → use a WINDOW, not an exact instant. "Within leadMinutes before begin" means
    now >= begin-leadMinutes AND now <= begin. If the SW was asleep and now > begin (kickoff passed),
    do NOT fire a stale pre-notification (it's no longer useful) — skip and mark as sent so it
    never fires late. (Decide explicitly: a missed pre is dropped, not fired late.)
  • begin_at null was already filtered out at the data layer; matches here always have beginAtUtc.
  • cancelled → no pre, no end.
  • a match that is already 'finished' on first ever fetch (we never saw it notStarted) → still
    eligible for END (so you learn a followed match has a VOD), but NOT for a late PRE.
Test plan:  see §5
```

### Blueprint: buildMessage (spoiler-safe wording)
```
Purpose:    Produce the notification title/body, never leaking a score when spoilerSafeWording is on.
Inputs:     match, kind ('pre'|'end'), prefs
Outputs:    { title, message }
Rules:      PRE  → e.g. title "Match starting soon", message "TeamA vs TeamB — starts in ~15 min"
            END  (spoilerSafeWording true)  → "TeamA vs TeamB has finished — VOD ready to watch"
                 (NO score, NO winner)
            END  (spoilerSafeWording false) → may include the score, e.g. "TeamA 2 - 1 TeamB"
Edge cases: team names are fine (not spoilers); never include results/winner in the spoiler-safe path,
            not even in a tooltip/context field.
Test plan:  spoiler-safe end message contains neither score digits nor winner name;
            non-spoiler-safe end message may contain the score.
```

---

## 4. Background wiring (entrypoint, uses chrome.notifications)

```
On each alarm tick (and after a refresh):
  1. load cached matches (getCachedMatches), prefs (getNotificationPrefs), sent-set (storage.local)
  2. nowUtc = nowUtcIso() (core/time.ts)
  3. pending = computeNotifications(matches, prefs, nowUtc, sent)
  4. for each pending: chrome.notifications.create(key, {...}); add key to sent
  5. persist the updated sent-set
```
- **Sent-set storage**: a single `chrome.storage.local` key (e.g. `notifier:sent`) holding the array
  of fired keys — same single-key pattern as the reveal set. Inject a mockable storage for tests.
- **Clicking a notification** (optional, simple): if `match.officialStreamUrl` exists, open it via
  `chrome.tabs.create`. Keep this minimal; skip if it complicates the slice.
- **Sent-set growth**: prune keys for matches no longer in cache (or cap size) so it doesn't grow
  unbounded. A simple prune: keep only keys whose matchId is still in the current cache.
- Requires the `notifications` permission — already in the manifest.

---

## 5. Test plan (Vitest, pure logic)

| Scenario | Expectation |
|---|---|
| `Compute_Disabled_NothingFires` | prefs.enabled=false → [] |
| `Compute_WithinPreWindow_EmitsPre` | notStarted, now in [begin-lead, begin], not sent → one pre |
| `Compute_OutsidePreWindow_NoPre` | now earlier than begin-lead → no pre |
| `Compute_KickoffPassed_NoLatePre` | now > begin, pre not sent → no pre (dropped, marked sent) |
| `Compute_PreAlreadySent_NoDuplicate` | `${id}:pre` in sent → no pre |
| `Compute_Finished_EmitsEnd` | finished, notifyOnEnd=true, not sent → one end |
| `Compute_NotifyOnEndFalse_NoEnd` | notifyOnEnd=false → no end |
| `Compute_EndAlreadySent_NoDuplicate` | `${id}:end` in sent → no end |
| `Compute_Cancelled_Nothing` | cancelled → neither pre nor end |
| `BuildMessage_EndSpoilerSafe_NoScore` | spoilerSafeWording=true → message has no score/winner |
| `BuildMessage_EndNotSafe_HasScore` | spoilerSafeWording=false → message includes score |

> Inject `nowUtc` and the `sent` set as parameters so time-based behaviour is deterministic in tests.

---

## Closing

✅ **This spec delivers**: scope (blueprint-faithful), the pure `computeNotifications` +
`buildMessage` design with the "drop missed pre, don't fire late" decision, the background
wiring with a single-key sent-set and pruning, and a full pure-logic test plan.

📋 **Next steps**:
1. Put this spec in `docs/`.
2. Have Claude Code implement `core/notifier.ts` (pure) + the entrypoint wiring, with Vitest tests
   per §5, injecting `nowUtc` and a mockable storage. No content scripts, no rules engine. No commit.
3. Manual check: with a followed game, confirm a real OS notification appears for an upcoming match
   (you may need to temporarily lower leadMinutes or pick a match starting soon to see it live), and
   that the post-match notification carries no score.
4. After this lands, only the page-level spoiler protection (content script + matcher) remains for MVP.

⚠️ **Watch**:
- Spoiler-safe path must never carry a score/winner — title, body, or any field.
- MV3 SW sleeps: judge by window; a missed pre is dropped (and marked sent), never fired late.
- Dedup is per `${matchId}:pre|end`; the sent-set is the source of truth — persist it after firing.
- Prune the sent-set against the current cache so it can't grow forever.
- This slice adds NO score to any notification when spoiler-safe wording is on (the whole point).
