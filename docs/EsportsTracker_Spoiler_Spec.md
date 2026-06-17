# EsportsTracker — Spoiler Engine Spec (core/spoiler.ts)

> Spec for the spoiler state machine in the reminder product. Pure logic in `core/spoiler.ts`
> (popup masking) plus the notification-wording gate in `core/notifier.ts` (§5.5). **Updated for the
> pivot**: page-level content script removed; spoiler protection now lives only in the popup list +
> notification wording, both governed by a single default-on master switch. British English throughout.

---

## 1. Product decisions (locked)

- **Spoiler protection is OPTIONAL, default ON.** A master switch `SpoilerPrefs.enabled` (default
  **true**) governs all in-popup masking. Off → scores are always shown (no masking at all).
- With protection on:
  - **Finished** matches are masked until revealed.
  - **Running** matches are masked only if `hideRunning` is on (default off).
  - **notStarted / cancelled** are never masked (no result to spoil).
- Default-on is deliberate: not spoiling the user is the product's differentiator and should be the
  first-run behaviour. Users who prefer to see scores immediately can switch it off.
- **`enabled` is the single visible spoiler switch and governs BOTH surfaces**: the popup masking
  (above) **and** the END-notification wording. When `enabled` is off, the post-match notification
  shows the score directly; when on, it stays spoiler-safe ("VOD ready", no score/winner). This
  avoids the confusing state where a user turns spoiler-free mode off, sees scores in the popup, but
  still receives a vague "VOD ready" notification. See §5.5.

---

## 2. Types

```ts
export interface SpoilerPrefs {
  /** Master switch. When false, no scores are ever masked. Default true. */
  enabled: boolean;
  /** When true, in-progress (running) matches are also guarded. Default false. */
  hideRunning: boolean;
}

export const DEFAULT_SPOILER_PREFS: SpoilerPrefs = {
  enabled: true,
  hideRunning: false,
};

export interface SpoilerDecision {
  hideScore: boolean;
  hideWinner: boolean;
}
```

> `SpoilerPrefs` persists via `chrome.storage.sync` (a user preference). Existing
> `getSpoilerPrefs`/`setSpoilerPrefs` already back it; the new `enabled` field defaults to true via
> `DEFAULT_SPOILER_PREFS` for users who have older stored prefs without the field.

---

## 3. The pure decision function

```
getSpoilerDecision(match, revealed, prefs) → SpoilerDecision
Order of checks:
  1. if !prefs.enabled  → return shown   (master switch off: never mask)
  2. if revealed         → return shown
  3. switch(status):
       finished                 → hidden
       running                  → prefs.hideRunning ? hidden : shown
       notStarted | cancelled   → shown
```

Reference implementation:
```ts
export function getSpoilerDecision(
  match: Match,
  revealed: boolean,
  prefs: SpoilerPrefs,
): SpoilerDecision {
  const shown: SpoilerDecision = { hideScore: false, hideWinner: false };
  const hidden: SpoilerDecision = { hideScore: true, hideWinner: true };

  if (!prefs.enabled) return shown;   // master switch off → never mask
  if (revealed) return shown;

  switch (match.status) {
    case 'finished':
      return hidden;
    case 'running':
      return prefs.hideRunning ? hidden : shown;
    case 'notStarted':
    case 'cancelled':
      return shown;
  }
}
```
> Keep the status `switch` exhaustive (no `default`) so a new `MatchStatus` value is caught at compile
> time. Remove the now-stale comment that says the page-level content script also calls this — only
> the popup does now.

---

## 4. Reveal state

Unchanged by this update. Reveal state is a single `chrome.storage.local` key holding the array of
revealed match ids; `getRevealedSet` / `reveal` / `isRevealed` as already implemented (fail-safe to
empty set on read error). Stores only ids, never scores.

> Note: when `enabled` is false, masking is off so reveal is moot; reveal state can remain stored and
> simply isn't consulted. No migration needed.

---

## 5. Settings UI

In the options page, alongside the existing `hideRunning` toggle, add a master toggle:
- **"Spoiler-free mode"** (or similar) bound to `SpoilerPrefs.enabled`, default on.
- When `enabled` is off, the `hideRunning` toggle is irrelevant — disable/grey it out (it has no
  effect while the master switch is off), or show it as inactive. Keep both persisted via
  `setSpoilerPrefs`.
- Persist immediately on change, consistent with the other settings.

> `SpoilerGuard.tsx` needs NO change — it only reads `decision.hideScore`. The master switch is
> handled upstream in `getSpoilerDecision`, so turning it off makes every decision "shown" and the
> guard renders real scores automatically.

> The options hint currently reads "Turn it off to always show scores." Update it to
> "…always show scores in the popup and notifications." so the single toggle's effect isn't
> under-stated now that it also governs notification wording (§5.5).

---

## 5.5 Notification wording gating (core/notifier.ts)

> **As-built state (verified, not assumed):** notification wording is driven by
> `NotificationPrefs.spoilerSafeWording` (default true) in `buildMessage`, which is a SEPARATE field
> from `SpoilerPrefs.enabled`. The options page exposes no notification toggle, so `spoilerSafeWording`
> currently sits at its default and is never user-controllable. Result: turning `enabled` off changes
> the popup but **not** notifications — the confusing state called out in §1. This section closes that.

**Decision (locked):** `SpoilerPrefs.enabled` is the source of truth. `spoilerSafeWording` becomes a
subordinate of the master switch (semantically peer to `hideRunning`), gated at the call site. The
pure notifier logic is NOT changed — `computeNotifications` and `buildMessage` already handle
`spoilerSafeWording` correctly; we only adjust the value they receive.

Add one pure helper to `core/notifier.ts`:
```ts
/**
 * Gates spoiler-safe wording behind the spoiler master switch. When spoiler-free
 * mode is off, END notifications show the score even if spoilerSafeWording is true,
 * so the single visible toggle governs both popup masking and notification wording.
 * Apply at fire time (per alarm) so a mid-session toggle takes effect immediately.
 */
export function gateNotificationPrefs(
  prefs: NotificationPrefs,
  spoilerEnabled: boolean,
): NotificationPrefs {
  return spoilerEnabled ? prefs : { ...prefs, spoilerSafeWording: false };
}
```

**Background wiring (call site):** in the alarm/refresh handler that currently calls
`computeNotifications`, also read `getSpoilerPrefs()` and gate before computing. Reading per-tick
satisfies "read at fire time", so a mid-session toggle is honoured without extra plumbing:
```ts
const [notif, spoiler] = await Promise.all([getNotificationPrefs(), getSpoilerPrefs()]);
const effective = gateNotificationPrefs(notif, spoiler.enabled);
const plan = computeNotifications(matches, effective, nowUtc, sent);
```
> Claude Code: locate the existing `computeNotifications` call site in `background/` and apply the
> gate there. Do not change `computeNotifications` or `buildMessage` themselves.

**Scope boundary:** the gate only forces `spoilerSafeWording` to false when the master switch is off.
It must not touch `enabled` (the NotificationPrefs master off-switch), `notifyOnEnd`, `leadMinutes`,
or the PRE path — a pre-match reminder carries no score and is unaffected.

---

## 6. Test plan (Vitest)

| Scenario | Expectation |
|---|---|
| `Disabled_FinishedNotRevealed_Shows` | enabled=false, finished → shown (master switch wins) |
| `Disabled_RunningWithHideRunning_Shows` | enabled=false, running, hideRunning=true → shown |
| `Enabled_FinishedNotRevealed_Hides` | enabled=true, finished, not revealed → hidden |
| `Enabled_Revealed_Shows` | enabled=true, revealed → shown |
| `Enabled_RunningDefault_Shows` | enabled=true, running, hideRunning=false → shown |
| `Enabled_RunningOptIn_Hides` | enabled=true, running, hideRunning=true → hidden |
| `Enabled_NotStarted_Shows` / `Enabled_Cancelled_Shows` | shown regardless |
| default prefs | `DEFAULT_SPOILER_PREFS.enabled === true` |

Plus the existing reveal-state tests stay green. Update any existing test that constructs
`SpoilerPrefs` to include the new `enabled` field (default true).

### Notification gating (`gateNotificationPrefs`)

| Scenario | Expectation |
|---|---|
| `EnabledSafeWording_StaysSafe` | spoilerEnabled=true, spoilerSafeWording=true → unchanged (END stays spoiler-safe; regression) |
| `DisabledSafeWording_ForcesScore` | spoilerEnabled=false, spoilerSafeWording=true → `spoilerSafeWording` forced false; `buildMessage(end)` includes score |
| `EnabledNonSafe_Unchanged` | spoilerEnabled=true, spoilerSafeWording=false → unchanged (false) |
| `GateLeavesOtherFieldsIntact` | `enabled`, `notifyOnEnd`, `leadMinutes` unchanged by the gate |
| `GateDoesNotAffectPre` | PRE message identical regardless of `spoilerEnabled` |

---

## Closing

✅ **Already in place (verified against current code):** `SpoilerPrefs.enabled` exists and defaults
to true; `getSpoilerDecision` checks `!enabled` first; the options page exposes the "Spoiler-free
mode" toggle and greys out `hideRunning` when the master switch is off; `SpoilerGuard` is untouched.
The popup masking + settings UI (§2–§5) are done.

🔧 **Remaining work (the notification tail, §5.5):**
1. Overwrite the old Spoiler Spec in `docs/` with this version.
2. Claude Code: add `gateNotificationPrefs` to `core/notifier.ts`; in the `background/`
   `computeNotifications` call site, read `getSpoilerPrefs()` and gate before computing; add the
   `gateNotificationPrefs` tests; update the options hint copy. **No commit.**
3. Manual check: follow a finished match, turn spoiler-free mode OFF → the END notification shows the
   score; turn it ON → it stays "VOD ready" with no score.

⚠️ **Watch**:
- Gate only forces `spoilerSafeWording` to false when the master switch is off; touch nothing else
  in `NotificationPrefs`, and never the PRE path.
- Gate at the call site per alarm tick (fire-time read), so a mid-session toggle is honoured.
- Do NOT modify `computeNotifications` or `buildMessage` — they already handle `spoilerSafeWording`.
- Keep the `getSpoilerDecision` status switch exhaustive (no default).
- Remove the stale "page-level content script" comment in `core/spoiler.ts` if still present.