# EsportsTracker — Spoiler Engine Spec (core/spoiler.ts)

> Implementation spec for the spoiler state machine. Claude Code implements against this.
> Depends on the data layer (`MatchStatus`, `Match`, `hasResult`) already shipped.
> Pure logic only — no DOM, no extension UI. Both the popup and the page-level content
> script reuse this module, so it must stay framework-free and unit-testable.
> British English throughout; naming consistent with `models.ts`.

---

## 1. Product decision (locked)

- **Finished matches are guarded by default** — their score/winner is hidden until revealed.
- **Running (in-progress) matches are NOT guarded by default.** Live scores show normally.
- A user setting **`hideRunning`** (default **false**) lets users opt in to guarding running
  matches too. Exposed as a toggle in the extension settings.
- `notStarted` and `cancelled` are never guarded (nothing to spoil).

Rationale: don't get in the way of people following a live broadcast, while letting VOD-watchers
who want full protection opt in.

---

## 2. Types

```ts
export interface SpoilerPrefs {
  /** When true, in-progress (running) matches are also guarded. Default false. */
  hideRunning: boolean;
}

export const DEFAULT_SPOILER_PREFS: SpoilerPrefs = {
  hideRunning: false,
};

export interface SpoilerDecision {
  hideScore: boolean;
  hideWinner: boolean;
}
```

> `SpoilerPrefs` is persisted via `chrome.storage.sync` (a user preference, syncs across the
> user's own devices). Reveal state (§4) is persisted via `chrome.storage.local` (per-device cache).

---

## 3. The pure decision function

### Blueprint: getSpoilerDecision
```
Purpose:    Decide whether a match's score/winner must be hidden. Pure function, no I/O.
Inputs:     match: Match; revealed: boolean (has the user already revealed THIS match);
            prefs: SpoilerPrefs
Outputs:    SpoilerDecision { hideScore, hideWinner }
Components: getSpoilerDecision(match, revealed, prefs)
Data flow:  caller loads revealed state + prefs → calls this per match → uses result to mask/show
Edge cases: revealed === true always wins → show everything;
            finished + not revealed → hide;
            running + not revealed + prefs.hideRunning → hide;
            running + not revealed + !prefs.hideRunning → show (DEFAULT);
            notStarted / cancelled → show (no result to spoil), regardless of prefs
Test plan:  see §5
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
> Note: the `switch` is exhaustive over `MatchStatus`. Keep it exhaustive (no `default`) so that
> if `MatchStatus` ever gains a new value, the type checker flags this function — a deliberate
> safety net, per strict-mode discipline.

---

## 4. Reveal state (persistence)

"Reveal once, revealed everywhere." Reveal state is shared between the popup and every content
script via `chrome.storage.local`, keyed by the authoritative `matchId` from the data layer.

### Blueprint: reveal-state store
```
Purpose:    Persist and query which matches the user has chosen to reveal.
Inputs:     matchId: string (reveal / isRevealed); none (getRevealedSet)
Outputs:    reveal → Promise<void>; getRevealedSet → Promise<Set<string>>
Components: reveal(matchId); getRevealedSet(); isRevealed(matchId) [convenience]
Data flow:  reveal() adds id to the stored set; readers load the set once and pass the boolean
            into getSpoilerDecision per match
Edge cases: revealing an already-revealed id is a no-op (idempotent);
            unknown id in isRevealed → false;
            never store scores here — only the set of revealed match ids;
            storage failure on read → treat as empty set (fail safe: guard rather than leak)
Test plan:  see §5
```

Design notes:
- Store a **single key** holding the set of revealed ids (e.g. `spoiler:revealed` → string[]),
  not one key per match — this lets a content script scanning a page load the whole set in one
  read instead of N reads (performance, per the content-script blueprint).
- Readers should call `getRevealedSet()` once, then check membership locally while iterating
  matches; do **not** call `isRevealed()` in a tight loop (it would re-read storage each time).
- Reveal state is intentionally `local` (per-device) in the MVP. Cross-device sync of reveal
  state is a Full-blueprint (Pro) item — do not build it now.

---

## 5. Test plan

| Scenario | Expectation |
|---|---|
| `GetSpoilerDecision_FinishedNotRevealed_Hides` | finished + revealed=false → hide both |
| `GetSpoilerDecision_FinishedRevealed_Shows` | finished + revealed=true → show both |
| `GetSpoilerDecision_RunningDefault_Shows` | running + revealed=false + hideRunning=false → show |
| `GetSpoilerDecision_RunningOptIn_Hides` | running + revealed=false + hideRunning=true → hide |
| `GetSpoilerDecision_RunningRevealed_Shows` | running + revealed=true → show (even if hideRunning=true) |
| `GetSpoilerDecision_NotStarted_Shows` | notStarted → show, regardless of prefs |
| `GetSpoilerDecision_Cancelled_Shows` | cancelled → show, regardless of prefs |
| `Reveal_NewId_AddsToSet` | reveal(id) then getRevealedSet() contains id |
| `Reveal_ExistingId_Idempotent` | revealing twice → set still has one entry, no error |
| `IsRevealed_UnknownId_False` | isRevealed(unknown) → false |
| `GetRevealedSet_StorageFailure_ReturnsEmpty` | storage read throws → empty set (fail safe) |

> Use a mocked storage (inject the storage wrapper, like fetch was injected into PandaScoreSource)
> so the reveal-state tests run without a real `chrome.storage`.

---

## Closing

✅ **This spec delivers**: the locked product decision (running not guarded by default, opt-in
toggle), `SpoilerPrefs` + defaults, the pure `getSpoilerDecision` function with an exhaustive
status switch, the shared reveal-state store design, and a full test plan.

📋 **Next steps**:
1. Put this spec in `docs/`.
2. Have Claude Code implement `src/core/spoiler.ts` per §2–§4 with Vitest tests per §5,
   injecting a mockable storage wrapper. No UI, no DOM, no content script yet. No commit.
3. After this lands, the next pieces are the popup match list + in-extension `SpoilerGuard`
   (which consume this module), then the matcher and page-level content script.

⚠️ **Watch**:
- Keep the status `switch` exhaustive (no `default`) so new statuses are caught by the type checker.
- Reveal state stores only match ids — never scores.
- Read the revealed set once per render/scan; don't call `isRevealed` in a loop.
- `hideRunning` lives in `storage.sync`; reveal state lives in `storage.local`. Don't mix them.
