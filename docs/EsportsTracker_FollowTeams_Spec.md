# EsportsTracker — Follow Teams Spec (search-based)

> Lets users follow specific teams, so masking/tracking narrows from "all matches of a game" to
> "matches involving my teams". This fixes the Liquipedia over-masking root cause.
> Search-based (NOT a full team-list download — verified: CS2 alone has ~4996 teams across 1000 pages,
> each row carrying full player rosters, so bulk download is infeasible). PandaScore's name search is used.
> British English throughout. Builds on the shipped data layer, storage, and settings page.

---

## 1. Decisions (locked)

- **Source**: PandaScore team **name search**, per the selected game. Verified working:
  `GET /{game}/teams?search%5Bname%5D=<query>` (i.e. `search[name]=`) returns partial, case-insensitive
  matches (e.g. "vitality" → "Vitality", "Vitality Academy").
- **Scope**: search the **currently selected game(s)** only (e.g. CS2 selected → search CS2 teams).
- **Result display**: **name + acronym** only (e.g. "Vitality (VIT)"). No logos (trademark), no location.
- **Empty follow list = track ALL matches of the selected game** (unchanged current behaviour) —
  so this is purely additive; users who don't set teams see no change.
- **MVP scope of effect**: selecting teams writes `FollowConfig.teamIds`. The existing data-layer
  `filterByFollow` already narrows matches when `teamIds` is non-empty, so the **popup and Liquipedia
  automatically narrow** once teams are set — no extra wiring needed (filterByFollow already shipped).
  (We are NOT building anything beyond the settings UI + the search source.)

> Note on effect: the spec answer "settings page only (MVP)" means we add no NEW filtering code —
> but because `filterByFollow` already keys off `teamIds`, setting teams naturally narrows existing
> surfaces. That is desirable and requires no new logic.

---

## 2. Data source addition

### Blueprint: PandaScoreSource.searchTeams
```
Purpose:    Search teams by name for a game, returning a small normalised list for the picker.
Inputs:     game: GameId; query: string (user input)
Outputs:    Promise<Team[]>  (normalised: id, name, acronym only)
Components: searchTeams(game, query); normaliseTeam(raw)
Data flow:  searchTeams → GET /{slug}/teams?search[name]=<encoded query>&per_page=N → raw[] →
            normaliseTeam each → Team[]
Normalisation: take ONLY id (String), name, acronym. DROP players[], image_url,
            dark_mode_image_url, location, current_videogame, slug — we don't need them and
            players[]/images are noise + a logo/trademark concern.
Edge cases: empty/blank query → return [] without a request (don't search on empty);
            query needs URL-encoding (the [ ] in search[name] must be percent-encoded);
            401/403/429 → reuse the existing error types; caller shows a soft error, not a crash;
            no matches → return [] (picker shows "no results");
            per_page small (e.g. 10) — a picker doesn't need hundreds.
Test plan:  normaliseTeam keeps only id/name/acronym from the real sample; empty query short-circuits;
            URL is correctly encoded; error status maps to the right error type.
```
> Reuse the existing injected `fetchFn` + `Authorization: Bearer` pattern from `fetchMatches`.
> Encode the query so the `[` `]` are percent-encoded (`search%5Bname%5D=`).

---

## 3. Storage

`FollowConfig.teamIds` already exists. The picker needs to show the NAMES of already-followed teams,
but `teamIds` stores only ids. Two options:

- **Chosen (simpler)**: store followed teams as a small list of `{id, name, acronym}` objects in a
  new sync key `followedTeams` (so settings can render them without a lookup), AND keep `teamIds`
  in `FollowConfig` as the source of truth the data layer reads. Keep them in sync on add/remove.
- (Alternative — id-only — would require re-fetching names to display; rejected for MVP simplicity.)

Add `getFollowedTeams()/setFollowedTeams()` (sync, key `followedTeams`) following the existing
storage patterns. On add/remove, update BOTH `followedTeams` and `FollowConfig.teamIds`.

> Keep it small: only id/name/acronym per followed team. No rosters, no images.

---

## 4. Settings UI (Preact, in the existing options page)

Add a "Followed teams" section below the existing game selection:
```
[ search input: "Search teams…" ]         ← debounced (~300ms)
   ↓ (while typing, for the selected game)
[ result rows: "Vitality (VIT)        [+ Follow] " ]   ← name + acronym only
   ...
Followed:
[ "Vitality (VIT)   [× Remove]" ]          ← current followedTeams, each removable
```
Behaviour:
- Search runs only when the query is non-empty and a game is selected; debounce input.
- If no game selected → show a hint "Select a game first".
- Clicking Follow adds to followedTeams + teamIds (dedupe by id); Remove deletes from both.
- Show a subtle loading/empty/error state for the search.
- Persist immediately (consistent with the existing settings).

### Blueprint: settings teams section
```
Purpose:    Let the user search and follow/unfollow teams for the selected game.
Inputs:     selected games (FollowConfig.games), current followedTeams
Outputs:    setFollowedTeams + setFollowConfig(teamIds) on change
Components: TeamSearch (input + debounced query + results), FollowedList (chips/rows with remove)
Data flow:  type → debounce → PandaScoreSource.searchTeams(game, q) → render results →
            Follow → persist → reflect in FollowedList
Edge cases: multiple selected games → search each and merge, or search the first/primary game
            (KEEP SIMPLE: if multiple games selected, search all selected games and label results
            by game, OR restrict to one game at a time — pick the simplest: search all selected
            games, dedupe by id); duplicate follow → ignored; remove → instant;
            search error → inline message, keep existing follows intact
Test plan:  add/remove updates both stores; debounce; empty query no-request; dedupe; persists on reopen
```
> The token is needed for search; the options page can call `searchTeams` directly (it runs in the
> extension context with env access), or message the background to do it. Prefer whichever keeps the
> token out of content scripts — options page is privileged, so calling directly is fine.

---

## 5. Tests (Vitest)

| Scenario | Expectation |
|---|---|
| `SearchTeams_Normalises_KeepsOnlyIdNameAcronym` | real sample → Team[] with no players/images/location |
| `SearchTeams_EmptyQuery_NoRequest` | blank query → [] and no fetch |
| `SearchTeams_EncodesQuery` | URL contains `search%5Bname%5D=` and encoded query |
| `SearchTeams_AuthError_Maps` | 401 → AuthError |
| `Follow_AddsToBothStores` | follow → followedTeams and teamIds both updated, deduped |
| `Follow_Remove_UpdatesBoth` | remove → gone from both |
| settings render (jsdom) | typing triggers debounced search; results show name+acronym; follow/remove persist |

> Inject the storage + fetch mocks as before; no real chrome/network in tests.

---

## 6. Manual verification (you, in Chrome)

1. Build, load, open settings, select CS2.
2. Search "vita" → see "Vitality (VIT)", "Vitality Academy (VIT.A)".
3. Follow "Vitality" → it appears under Followed; reopen settings → still there.
4. Open the popup → now only matches involving followed teams appear (because `filterByFollow`
   keys off `teamIds`). With teams followed, the list is narrowed.
5. Open a Liquipedia CS2 matchlist → now ONLY rows with your followed teams are masked; everything
   else is untouched (the over-masking is gone).
6. Remove all followed teams → behaviour returns to "track all" (empty list = all).

> This is the step that should visibly fix the "everything is masked" problem from the screenshot.

---

## Closing

✅ **This spec delivers**: a search-based follow-teams feature — `searchTeams` source (normalised to
id/name/acronym only), `followedTeams` storage kept in sync with `FollowConfig.teamIds`, a debounced
settings picker showing name+acronym, and tests. No bulk team download (infeasible at ~5000 teams),
no new filtering logic (the shipped `filterByFollow` already narrows once `teamIds` is set).

📋 **Next steps**:
1. Put this spec in `docs/`.
2. Have Claude Code implement `searchTeams` + storage + the settings section + tests. No commit.
3. You run §6 — the key check is that Liquipedia now masks ONLY followed teams (fixing the screenshot
   problem), and the popup narrows.
4. After this lands, return to the Liquipedia mask UI polish (the grey blocks / button layout).

⚠️ **Watch**:
- Normalise teams to id/name/acronym ONLY — drop players[] and all image urls (noise + trademark).
- URL-encode the search param (`search%5Bname%5D=`); empty query must not fire a request.
- Keep `followedTeams` and `FollowConfig.teamIds` in sync (both updated on every add/remove).
- Empty follow list must still mean "track all" — this feature is additive, not a gate.
- Don't bulk-download the team list; search only.
