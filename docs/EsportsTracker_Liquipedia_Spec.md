# EsportsTracker — Liquipedia Content Script Spec

> The final MVP slice: page-level spoiler protection on ONE site — Liquipedia — using the
> already-shipped matcher + spoiler engine. This is the first time we modify a third party's page.
> Selectors below are taken from REAL Liquipedia matchlist HTML (CS wiki, June 2026), not guessed.
> British English throughout. Scope is deliberately narrow; YouTube is a later slice.

---

## 1. Scope (locked)

**In**:
- Site: **Liquipedia only** (`*://liquipedia.net/*`, already in host_permissions).
- Target: **matchlist score displays** (`div.brkts-matchlist-match`) — the most common, most structured.
- Mask **everything that reveals the result**, per the user's decision:
  1. the two outer score cells,
  2. the detailed per-map scores inside the match-info popup,
  3. the winner highlight (so you can't infer the winner from styling).
- Masking style: replace the score text with a neutral placeholder styled as a grey block
  (NOT CSS blur over real text — the real value must not remain in the DOM). Store the original
  value to restore on reveal. A click reveals; reveal persists via the spoiler engine ("reveal
  once, revealed everywhere", shared with the popup).

**Out (later / backlog)**:
- Brackets, single-match pages, group cross-tables (only matchlists for now).
- YouTube and any other site.
- Weak leaks: VOD-count (Bo length), the `(BoN)` label, map names. Documented as known gaps.
- The "follow teams" feature — until it exists, build the alias index from the teams present in
  the **cached matches** (the games the user tracks). See §5.

---

## 2. Real DOM structure (from captured HTML)

A matchlist match row:
```
div.brkts-matchlist-match
  ├─ div.brkts-matchlist-cell.brkts-matchlist-opponent[.brkts-matchlist-slot-winner]   ← team A (winner class if won)
  │     aria-label="<FULL TEAM NAME>"                                                   ← e.g. "Lynn Vision Gaming"
  │     └─ ... span.name "LVG"                                                          ← short/acronym shown
  ├─ div.brkts-matchlist-cell.brkts-matchlist-score[.brkts-matchlist-slot-bold]         ← SCORE CELL (team A)
  │     aria-label="<FULL TEAM NAME>"
  │     └─ div.brkts-matchlist-cell-content "13"                                         ← the score text
  ├─ div.brkts-match-info-icon
  ├─ div.brkts-matchlist-cell.brkts-matchlist-score ...                                 ← SCORE CELL (team B)
  │     └─ div.brkts-matchlist-cell-content "8"
  ├─ div.brkts-matchlist-cell.brkts-matchlist-opponent ...                              ← team B
  └─ div.brkts-popup.brkts-match-info-popup                                             ← DETAIL POPUP (hidden until hover/click)
        ├─ div.match-info-header
        │   ├─ div.match-info-header-opponent[.match-info-header-winner|.match-info-header-loser]
        │   └─ div.match-info-header-scoreholder
        │         span.match-info-header-scoreholder-score[.match-info-header-winner] "13"
        │         span.match-info-header-scoreholder-divider ":"
        │         span.match-info-header-scoreholder-score "8"
        │         span.match-info-header-scoreholder-lower "(Bo1)"
        └─ div.brkts-popup-body
              div.brkts-popup-body-detailed-scores-main-score "13"                       ← per-map main score
              span.brkts-popup-body-detailed-score "8" / "5" ...                         ← per-map round scores
```

Key facts:
- **Full team name** is in the cell's `aria-label` (more reliable than the `span.name` acronym) — use it for matching.
- **Winner** is signalled by class `brkts-matchlist-slot-winner` (outer) and `match-info-header-winner` (popup).
- The popup exists in the DOM even before the user opens it — so its scores must be masked too,
  pre-emptively, not on hover.

---

## 3. What to mask per match (the "fixture unit")

For each `div.brkts-matchlist-match` that the matcher says to mask:

1. **Outer score text**: every `div.brkts-matchlist-score .brkts-matchlist-cell-content` → replace text with placeholder; stash original in a `data-*` attribute or a WeakMap.
2. **Winner highlight (outer)**: remove/neutralise `brkts-matchlist-slot-winner` so bold/colour doesn't reveal the winner. Stash that it was present, to restore.
3. **Popup main score**: `span.match-info-header-scoreholder-score` → placeholder.
4. **Popup winner classes**: `match-info-header-winner` / `match-info-header-loser` on opponents and scores → neutralise.
5. **Popup detailed per-map scores**: `.brkts-popup-body-detailed-scores-main-score` and
   `.brkts-popup-body-detailed-score` → placeholder.
6. Leave team names, logos, time, and the match structure intact — only results are masked.
7. Insert one **"👁 Show result"** affordance per match (e.g. a small overlay/button on the score area).

> Reveal restores ALL of the above from the stashed originals.

---

## 4. How to identify the team names for the matcher

For a given match row, build the text the matcher sees from the two opponents' **aria-labels**
(full names) joined as a fixture, e.g. `"Lynn Vision Gaming vs M80"`. Because the matchlist is
inherently a fixture (two opponents in one row), you can treat a row's two team names as the
"text" with an implicit vs — but STILL run them through the matcher against the followed-team
alias index so only followed teams are masked. A row whose teams are not followed is left alone.

> Note: on Liquipedia the row IS a known fixture, so the matcher's vs-structure gate is satisfied
> structurally. The matcher's job here is the **"is this a followed team"** filter (+ confidence /
> ambiguity handling), not fixture detection. Pass the two aria-label names; if neither maps to a
> followed team, skip the row.

---

## 5. Building the alias index (interim, until "follow teams" exists)

- Read cached matches (`getCachedMatches`), collect their teams (`teamA`/`teamB`), `buildAliasIndex`.
- This means: matches on Liquipedia are masked only for teams that appear in the user's tracked
  games' cached data. Good enough for MVP; tighten when "follow teams" ships.
- The content script gets this data by messaging the background/reading storage (content scripts
  can use `chrome.storage` directly).

---

## 6. Component blueprints

### Blueprint: LiquipediaAdapter (implements the site-adapter idea)
```
Purpose:    Find matchlist match rows, extract the two team names, mask all result-bearing parts.
Inputs:     document/root; alias index; revealed set; spoiler decision per match
Outputs:    side effects: masks applied; reveal affordance added
Components: collectMatchRows(root); extractTeams(row)→[nameA,nameB];
            maskRow(row) / unmaskRow(row); a stable per-row id for reveal state
Data flow:  scan rows → for each: extractTeams → matcher.matchText (followed filter) →
            if shouldMask && !revealed → maskRow + add reveal button
Edge cases: popup scores present in DOM pre-hover → mask them too;
            a row may have empty/“ ” scores (not finished) → nothing to mask, skip;
            re-running must be idempotent (don't double-mask / double-stash);
            selectors stale (site redesign) → find nothing, do nothing, never throw, never false-mask;
            reveal must restore outer + popup + winner classes from stash
Test plan:  see §8 (jsdom against the captured fixture HTML)
```

### Blueprint: reveal identity (per match)
```
Problem:    The spoiler engine keys reveal state by the data layer's matchId, but a Liquipedia row
            has no PandaScore id. We need a stable id for the row.
Decision:   Derive a deterministic key from the two normalised full team names + the match date/time
            text in the row (e.g. `lp:${normalise(nameA)}|${normalise(nameB)}|${dateText}`). This is
            stable across reloads of the same page and distinct per fixture. Store reveal under this
            key via the spoiler engine's reveal-set (it stores arbitrary string ids).
Note:       This Liquipedia-local key won't match the popup's PandaScore-id reveal (different id
            spaces) in the MVP — i.e. revealing on Liquipedia won't auto-reveal the same match in the
            popup. Cross-source reveal unification is a backlog item; flag it, don't solve it now.
Edge cases: missing date text → fall back to names only (slightly weaker uniqueness, acceptable).
```

### Blueprint: MutationObserver wiring
```
Purpose:    Liquipedia is largely server-rendered, but collapsible matchlists and navigation can
            insert/replace nodes. Re-apply masking to newly added match rows.
Inputs:     a MutationObserver on a sensible container (or document.body) 
Outputs:    re-run maskRow on added brkts-matchlist-match nodes
Edge cases: throttle/debounce to avoid thrashing; disconnect on page unload;
            never re-stash an already-masked row (idempotency via a marker attribute, e.g. data-et-masked)
```

---

## 7. Masking implementation rules (the no-leak discipline)

- The real score/winner must NOT remain anywhere in the DOM while masked: replace text content,
  and move the original into a JS-side store (WeakMap keyed by the element) OR a `data-et-orig`
  attribute that is REMOVED from the visible score node — actually prefer a **WeakMap**, because a
  `data-*` attribute is still in the DOM and thus still a leak. Use a WeakMap<Element,string>.
- Neutralise winner classes by removing them and recording (in the same WeakMap/segment store) which
  elements had them, to restore on reveal.
- The placeholder is inert text (e.g. `–`) or an empty greyed box; it encodes nothing about the result.
- Mark a processed row with `data-et-masked="1"` for idempotency (this attribute reveals nothing).
- CSS for the grey-block look ships with the content script (inject a small stylesheet); do not rely
  on blur of real text.

> This mirrors the SpoilerGuard and notifier discipline: the result is never computed into the DOM
> while hidden. F12 must not reveal it.

---

## 8. Test plan (Vitest + jsdom, against captured fixture HTML)

Save a trimmed real matchlist as `tests/fixtures/liquipedia/matchlist.html` (the captured CS-wiki
sample, no tokens, safe to commit). Then:

| Scenario | Expectation |
|---|---|
| Followed teams in a row → masked | outer + popup + detailed scores replaced; winner class removed |
| No score string anywhere | after masking, the row's DOM contains none of the original score digits |
| Non-followed row → untouched | a row with no followed team keeps its scores |
| Reveal restores exactly | after reveal, outer/popup/detailed scores and winner classes match the original |
| Idempotent | running mask twice doesn't double-stash or corrupt; data-et-masked respected |
| Not-finished row (empty score) | skipped, no error |
| Stale selectors (altered HTML) | no throw, nothing masked |
| Reveal id stable | same row across two parses yields the same reveal key |

> The "no score string anywhere" test is the critical one — assert the original digits are absent
> from `row.innerHTML` (including the popup subtree) after masking.

---

## 9. Manual verification (you, in a real browser)

After tests pass and `npm run build`:
1. Load the unpacked extension; ensure a game is selected so cached matches (hence followed teams) exist.
2. Open a real Liquipedia matchlist page for that game with finished matches.
3. Confirm: scores on rows for your tracked teams are greyed out; a "👁 Show result" affordance appears.
4. Open a match's detail popup (hover/click) → its detailed scores are ALSO masked.
5. Inspect with F12 on a masked score → the real number is NOT in the DOM.
6. Click "Show result" → outer + popup scores + winner highlight reappear correctly.
7. Confirm rows for teams you don't track are left untouched (no over-masking).

> WSL note: use Chrome/Brave on the Windows side pointed at the WSL `.output` path, as before.

---

## Closing

✅ **This spec delivers**: exact selectors from real HTML, the full-mask scope (outer + popup +
detailed + winner), a WeakMap-based no-leak masking discipline, a deterministic per-row reveal id,
MutationObserver wiring, an interim alias-index source, and jsdom + manual test plans.

📋 **Next steps**:
1. Put this spec in `docs/`; save the captured matchlist HTML as a `tests/fixtures/liquipedia/` file.
2. Have Claude Code implement the Liquipedia content script + adapter + masking, with jsdom tests
   per §8. No YouTube, no other sites. No commit.
3. You run the §9 manual checks in a real browser, especially the F12 no-leak check.
4. After this lands, the MVP is feature-complete. Remaining: backlog items (follow-teams, dashboard,
   real icon, YouTube adapter, cross-source reveal unification, weak-leak hardening).

⚠️ **Watch**:
- Pre-mask the popup scores (they're in the DOM before hover) — easy to miss, real leak.
- Winner highlight is a spoiler on its own — neutralise it.
- Use a WeakMap for originals, not a data-* attribute (an attribute is still a DOM leak).
- Idempotency + fail-safe on stale selectors (no throw, no false-mask).
- Conservative: only mask rows whose teams are followed; never over-mask. Far better to miss than to over-mask.
- Liquipedia reveal id is separate from the popup's PandaScore id in the MVP — known gap, not a bug.
