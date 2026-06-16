# EsportsTracker — Spoiler Engine Spec (core/spoiler.ts)

> Spec for the spoiler state machine in the reminder product. Pure logic in `core/spoiler.ts`;
> the popup consumes it. **Updated for the pivot**: page-level content script removed; spoiler
> protection now lives only in the popup list + notification wording, and is governed by a
> default-on master switch. British English throughout.

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

---

## Closing

✅ **This spec delivers**: the optional, default-on master switch (`enabled`), the updated
`getSpoilerDecision` ordering (master switch checked first), the settings toggle, and tests — with no
change needed to `SpoilerGuard`.

📋 **Next steps**:
1. Put this spec in `docs/` (overwrite the old Spoiler Spec).
2. Claude Code: add `enabled` to `SpoilerPrefs`/defaults, update `getSpoilerDecision`, add the settings
   toggle, update tests, and remove the stale page-level comment. No commit.
3. Manual check: toggle the master switch off → finished-match scores show immediately in the popup;
   toggle on → they mask again.

⚠️ **Watch**:
- Check `!enabled` FIRST in `getSpoilerDecision` (before revealed/status).
- Default `enabled` to true so existing stored prefs (without the field) stay spoiler-free.
- Keep the status switch exhaustive (no default).
- `SpoilerGuard` is unchanged — don't touch it.
- Remove the stale "page-level content script" comment.
