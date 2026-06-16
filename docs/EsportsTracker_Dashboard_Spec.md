# EsportsTracker — Dashboard Spec (full-page grouped view)

> A richer surface than the popup list: a full-page dashboard reached from the popup, showing followed
> teams' matches grouped by status → game → tournament → time. Reuses the SAME cached data and the
> SAME spoiler engine/SpoilerGuard as the popup. British English throughout.

---

## 1. Decisions (locked)

- **Form factor**: a full HTML page (its own entrypoint), opened in a new tab from a popup button
  ("Expand full view").
- **Layout**: a single scrolling page with **status sections stacked**: **Live**, **Upcoming**,
  **Finished** (in that order). **Empty status sections are not rendered.**
- **Grouping within each status section**: **game → tournament (competition) → matches**.
- **Sorting of matches** within a tournament group:
  - **Finished**: most recent first (descending `beginAtUtc`).
  - **Upcoming / Live**: soonest first (ascending `beginAtUtc`).
- **Data source**: the SAME local cache as the popup (`getCachedMatches`). No new fetching — the
  dashboard is a re-organised view of already-cached matches. It can request a background refresh on
  open (like the popup does), but reads from cache.
- **Spoiler protection**: reuse `getSpoilerDecision` + `SpoilerGuard` + the reveal store, exactly as
  the popup does (including the `enabled` master switch and `hideRunning`). The dashboard does NOT
  implement its own masking.

---

## 2. Pure grouping logic (testable, no DOM)

Put the grouping in a pure module (e.g. `core/dashboard.ts` or `entrypoints/dashboard/grouping.ts`)
so it can be unit-tested independently of rendering.

### Blueprint: groupMatchesForDashboard
```
Purpose:    Organise a flat Match[] into the dashboard's status → game → tournament → matches tree,
            with the correct per-status sort. Pure: input Match[], output a structured tree.
Inputs:     matches: Match[]
Outputs:    DashboardView = ordered list of StatusSection
            StatusSection { status: 'running'|'notStarted'|'finished'; games: GameGroup[] }
            GameGroup    { game: GameId; tournaments: TournamentGroup[] }
            TournamentGroup { competition: Competition; matches: Match[] }
Rules:
  • Bucket matches by status. Map to three display sections in fixed order:
      Live      = status 'running'
      Upcoming  = status 'notStarted'
      Finished  = status 'finished'
    ('cancelled' matches are excluded from the dashboard — not useful here.)
  • Within a status section: group by game (stable order, e.g. the GAMES list order: lol, csgo),
    then by competition.id, then collect matches.
  • Sort matches within a tournament group:
      Finished  → beginAtUtc DESC (most recent first)
      Live      → beginAtUtc ASC  (soonest start first)
      Upcoming  → beginAtUtc ASC  (soonest first)
  • Drop empty branches entirely: a status section with no matches is omitted; likewise empty game or
    tournament groups never appear.
  • Tournament group order within a game: by the earliest (Upcoming/Live) or latest (Finished) match
    time in that group, consistent with the section's sort direction — so the most relevant tournament
    surfaces first. (Document the chosen rule; keep it deterministic.)
Edge cases:
  • empty input → empty DashboardView (the page shows a friendly empty state).
  • a match with an unknown/var game still groups under its GameId.
  • matches are already filtered to followed teams upstream (the cache reflects followed games; if a
    follow list is set, filterByFollow already narrowed it) — the dashboard does not re-filter.
Test plan:  see §5
```

> Keep the status→section mapping and the sort directions in this pure function. The component just
> renders the tree.

---

## 3. Entry point + navigation

- New WXT HTML entrypoint, e.g. `entrypoints/dashboard/` (index.html + App.tsx), built to
  `dashboard.html`.
- **Popup button**: add an "Expand full view" link/button in the popup header that opens
  `chrome.runtime.getURL('/dashboard.html')` in a new tab (same pattern as the existing Settings link).
- On mount, the dashboard:
  1. loads `getCachedMatches`, `getSpoilerPrefs`, `getRevealedSet`, `getCacheTimestamp` (parallel),
  2. runs `groupMatchesForDashboard`,
  3. renders sections; also fires the background `refresh` message (like the popup) so data freshens.

---

## 4. Rendering (Preact)

- `DashboardApp` — loads data + prefs + revealed set, builds the view, holds reveal state.
- `StatusSection` — a heading (Live / Upcoming / Finished) + its game groups. Not rendered if empty.
- `GameGroup` — game label + its tournament groups.
- `TournamentGroup` — competition name + its matches.
- `DashboardMatchRow` — one match: teams (names + acronyms), local time (via `core/time.ts`), and the
  score area wrapped in the SAME `SpoilerGuard` used by the popup (pass the `getSpoilerDecision`
  result). A link to `officialStreamUrl` where present.
- Reveal handling mirrors the popup: clicking reveal calls `reveal(matchId)` and updates local state
  so the row re-renders unmasked. (Reuse the popup's approach; the reveal store is shared, so a match
  revealed in the popup is already revealed here on load.)
- Empty state: if there are no matches at all, show a friendly message with a link to Settings (mirror
  the popup's empty state wording).

> Reuse, don't duplicate: import `SpoilerGuard`, `getSpoilerDecision`, time formatting, and the reveal
> functions. The dashboard is a new layout over existing logic, not a reimplementation.

---

## 5. Test plan (Vitest)

Pure grouping (no DOM):
| Scenario | Expectation |
|---|---|
| `Group_BucketsByStatus` | running→Live, notStarted→Upcoming, finished→Finished; cancelled excluded |
| `Group_SectionOrder` | sections returned in order Live, Upcoming, Finished |
| `Group_OmitsEmptySections` | a status with no matches is absent from the output |
| `Group_NestsGameThenTournament` | within a section, grouped by game then competition.id |
| `Group_FinishedSortDesc` | finished matches within a tournament are beginAtUtc DESC |
| `Group_UpcomingSortAsc` | upcoming matches within a tournament are beginAtUtc ASC |
| `Group_TournamentOrder` | tournament groups ordered by section-appropriate relevance, deterministic |
| `Group_EmptyInput` | [] → empty view |

Rendering (jsdom, lighter):
| Scenario | Expectation |
|---|---|
| renders only non-empty sections | empty Live section not in the DOM |
| score masked when guarded | a finished match shows the SpoilerGuard placeholder, not the score |
| reveal shows score | clicking reveal renders the real score |

---

## 6. Manual verification (you, in browser)

1. Build, load, follow a few teams across both games with some finished + upcoming matches cached.
2. Open the popup → click "Expand full view" → the dashboard opens in a new tab.
3. Confirm: sections appear as Live / Upcoming / Finished (only non-empty ones); within each, matches
   are grouped by game then tournament; Finished newest-first, Upcoming soonest-first.
4. A finished match's score is masked with a reveal button (spoiler engine reused) — unless you turned
   spoiler-free mode off, in which case scores show.
5. Reveal a score → it shows; reopen the dashboard → still revealed (shared reveal store).
6. Compare with the popup — same data, richer organisation.

---

## Closing

✅ **This spec delivers**: a full-page grouped dashboard (status → game → tournament → time) opened
from the popup, built on a pure, testable grouping function and reusing the existing spoiler engine,
SpoilerGuard, reveal store, and cache — no new data fetching, no duplicated masking logic.

📋 **Next steps**:
1. Put this spec in `docs/`.
2. Claude Code: implement the pure grouping module + tests, then the dashboard entrypoint + Preact
   components reusing SpoilerGuard/spoiler/time, then the popup "Expand full view" button. No commit.
3. You verify §6 in the browser — especially the grouping/sort and that spoiler masking is reused.

⚠️ **Watch**:
- Reuse `SpoilerGuard` + `getSpoilerDecision` + reveal store — do NOT reimplement masking (and respect
  the `enabled` master switch automatically by reusing them).
- Omit empty sections/groups entirely.
- Per-status sort direction differs (Finished DESC, Upcoming/Live ASC) — keep it in the pure function.
- Reads from cache only; no new PandaScore calls (a background refresh ping is fine).
- Keep the grouping logic pure and unit-tested; the components only render the tree.
