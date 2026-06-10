# EsportsTracker — Popup & In-Extension Spoiler Spec

> Implementation spec for the first user-visible slice: background fetch+cache, the popup
> match list, the in-extension `SpoilerGuard`, and a settings page. Claude Code implements
> against this. Builds on the shipped data layer + spoiler engine.
> UI framework: **Preact**. British English throughout.

---

## 1. Scope (locked — do not exceed)

**In**:
- Background service worker: **fetch + cache** matches periodically (fetch only — NO notifications yet).
- Popup: a **single list, reverse-chronological** (newest `beginAtUtc` first), reading from cache.
- `SpoilerGuard`: per match, **mask the score only** (team names + time always visible) with a
  **"👁 Show result"** button to reveal; reveal persists via the spoiler engine.
- Settings page: a **`hideRunning` toggle** + **game selection** (which of LoL/CS2 to track).

**Out (later slices — do NOT build now)**:
- Following specific teams/competitions (with empty follow list, the data layer already returns all
  matches for the selected games — that is enough to populate the popup).
- Notifications / reminders (the alarms wiring stays for a later slice).
- Page-level spoiler protection (content scripts), matcher, new-tab board.

---

## 2. Prerequisite gaps to fill first

Two small additions before the UI work:

1. **`SpoilerPrefs` storage** (missing in `storage.ts`): add
   `getSpoilerPrefs(): Promise<SpoilerPrefs>` and `setSpoilerPrefs(prefs): Promise<void>`,
   backed by `chrome.storage.sync` (key `spoilerPrefs`), defaulting to `DEFAULT_SPOILER_PREFS`.
   Follow the exact pattern of the existing `getNotificationPrefs`/`setNotificationPrefs`.
2. **Install Preact** and wire WXT for Preact (e.g. `@wxt-dev/module-preact` or the documented
   Preact setup). Add a `popup` and an `options` HTML entrypoint under `src/` per WXT conventions.

---

## 3. Background: fetch + cache

### Blueprint: background refresh
```
Purpose:    Periodically fetch matches for the followed games and write them to the local cache,
            so the popup always has data to show without blocking on the network.
Inputs:     FollowConfig (from storage); PANDASCORE_TOKEN (from env, injected at build)
Outputs:    side effect: setCachedMatches(matches) on success
Components: refreshMatches() in src/background/index.ts; uses PandaScoreSource + getFollowConfig
            + setCachedMatches
Data flow:  alarm/startup → getFollowConfig → if games empty, skip → PandaScoreSource.fetchMatches
            → setCachedMatches
Trigger:    chrome.alarms periodic (every ~10 min) + once on startup (onInstalled / onStartup).
            Reason in time windows, not exact instants (MV3 SW sleeps).
Edge cases: empty games list → skip fetch, leave cache as-is;
            fetch throws (Auth/RateLimit/DataSource) → log + keep the previous cache (don't clear it);
            token missing → log a clear error, skip
Test plan:  refreshMatches with empty games → no fetch, no cache write;
            fetch success → setCachedMatches called with normalised list;
            fetch throws → previous cache untouched
```
> The token is read from `import.meta.env` (WXT exposes env vars). Confirm WXT's env-var
> mechanism; never hardcode the token, never log it.

---

## 4. Popup

### 4.1 Data flow
```
popup mount → load in parallel:
   • getCachedMatches()        → matches
   • getSpoilerPrefs()         → prefs (for hideRunning)
   • getRevealedSet()          → revealed ids (ONE read, per spoiler spec)
   • getCacheTimestamp()       → "last updated" label
→ render list sorted by beginAtUtc DESC
→ each row: getSpoilerDecision(match, revealed.has(match.id), prefs) → mask or show
→ also trigger a background refresh on open (message the SW) so data freshens while viewing
```

### 4.2 Components (Preact)
- `App.tsx` — loads data, holds state, renders the list + a header (title, "last updated" from cache timestamp, a link/gear to settings).
- `MatchList.tsx` — receives `Match[]` + revealed set + prefs; maps to `MatchRow`.
- `MatchRow.tsx` — one match: competition, team A vs team B (names + acronyms), local kickoff time (use `core/time.ts`), status badge. Wraps the score area in `SpoilerGuard`.
- `SpoilerGuard.tsx` — see §5.

### 4.3 Empty / loading states
- No games selected yet → friendly prompt: "Pick games in settings to start tracking." + link to settings.
- Games selected but cache empty (first fetch not back) → a brief loading state; then the list.
- Time rendering: store/compare UTC; render local via `core/time.ts` (author is UTC+8, matches span zones).

---

## 5. SpoilerGuard (in-extension)

### Blueprint: SpoilerGuard component
```
Purpose:    Hide ONLY the score of a guarded match; reveal on click. Team names and time stay visible.
Inputs:     match: Match; decision: SpoilerDecision (from getSpoilerDecision); onReveal: (id)=>void
Outputs:    rendered score area — either the real score, or a mask + "👁 Show result" button
Components: SpoilerGuard.tsx
Behaviour:  decision.hideScore === false → render the real score (e.g. "3 - 0")
            decision.hideScore === true  → render a neutral mask (e.g. "— : —" or a blurred chip)
                                           plus a "👁 Show result" button
            button click → call reveal(match.id) (spoiler engine) → onReveal(id) so the parent
                           updates its revealed set and re-renders → score now shows
Edge cases: the mask MUST NOT contain the real score anywhere — not in text, title, aria-label,
            or a hidden/blur-only DOM node. Render a placeholder; only fetch/show the real score
            after reveal. (A CSS blur over real text still leaks via DOM inspection — do not do that.)
            notStarted shows no score anyway (0:0 is not a result) — show "vs" / scheduled time, not "0 - 0".
Test plan:  hidden decision → renders button, no score string in the DOM;
            click → reveal called with match.id, score becomes visible;
            shown decision → score visible, no button
```
> The "no score in the DOM while masked" rule is the same discipline as the page-level content
> script: never put the result where it can leak. This is testable with jsdom (assert the score
> string is absent from the container until revealed).

---

## 6. Settings page

### Blueprint: settings
```
Purpose:    Let the user pick which games to track and toggle hideRunning.
Inputs:     getFollowConfig(), getSpoilerPrefs()
Outputs:    setFollowConfig(...) on game change; setSpoilerPrefs(...) on toggle
Components: options/App.tsx with two controls:
            • Game selection: checkboxes for LoL / CS2 → writes FollowConfig.games
            • "Guard in-progress matches too" toggle → writes SpoilerPrefs.hideRunning
Data flow:  load current values → user changes → persist immediately → (popup re-reads on next open)
Edge cases: deselecting all games → allowed, but show a hint that the popup will be empty;
            persist on each change (no separate "save" button needed for this small set);
            changing games should prompt/trigger a background refresh so the cache matches the new selection
Test plan:  toggling hideRunning persists via setSpoilerPrefs; selecting a game persists via setFollowConfig;
            values load correctly on reopen
```
> "Follow specific teams" is intentionally NOT here yet — it is the next slice.

---

## 7. Manual verification (you, in Chrome)

After tests pass, load the unpacked extension and check by eye:
1. `npm run build` (or `npm run dev`) → produces the unpacked extension in `.output/`.
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the
   `.output/chrome-mv3` (or equivalent) folder.
3. Open settings → select **LoL** → confirm no errors.
4. Click the toolbar icon → the popup should list real LoL matches, newest first.
5. A **finished** match shows team names + time, but the score is masked with a "👁 Show result"
   button. Click it → score appears, and it stays revealed if you reopen the popup.
6. A **running** match (if any) shows its score by default (hideRunning off). Turn hideRunning on
   in settings → reopen → running match score is now masked too.

> Loading unpacked needs a Chromium browser on your system. If on WSL without a Linux browser,
> load the `.output` folder using Chrome on the Windows side (it can read the WSL path via
> `\\wsl$\...`), or run a Chromium browser inside WSL.

---

## Closing

✅ **This spec delivers**: scope (locked, no team-following, no notifications), the two prerequisite
gaps (SpoilerPrefs storage + Preact setup), background fetch+cache, popup data flow + components,
the score-only SpoilerGuard with the no-leak rule, the settings page (games + hideRunning), and a
manual Chrome verification checklist.

📋 **Next steps**:
1. Put this spec in `docs/`.
2. Have Claude Code implement per §2–§6 with Vitest tests for the testable parts (refreshMatches,
   SpoilerGuard render logic, settings persistence). UI components that need a DOM use jsdom.
   No notifications, no content scripts, no team-following. No commit.
3. You then run the §7 manual checks in Chrome and confirm it looks right before commit.

⚠️ **Watch**:
- The mask must never carry the real score in the DOM (no blur-over-real-text). Placeholder only.
- Token from env, never hardcoded, never logged.
- Background fetch failure must keep the previous cache, not clear it.
- This slice stays within scope — following teams and notifications are separate, later slices.
