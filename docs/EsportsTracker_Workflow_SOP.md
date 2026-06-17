# EsportsTracker — Working SOP (token-efficient collaboration)

> How we (the planning chat + Claude Code) work together with minimal token waste, without losing the
> disciplines that keep this project clean. At the start of a new chat, point me here ("follow the SOP
> in docs/EsportsTracker_Workflow_SOP.md") and I'll work this way.

---

## 1. Why this exists

The default habits — pasting whole files into chat, writing full specs for every change, relaying
Claude Code's full reports — burn tokens fast and make long chats expensive. This SOP keeps the useful
disciplines (verify-before-build, one slice at a time, clean commits) while cutting the waste.

---

## 2. Showing me code — DON'T paste whole files

When I need to see existing code to plan a change, prefer the smallest thing that answers the question:

- **First choice — grep with line numbers**:
  ```bash
  grep -n "SYMBOL\|OTHER_SYMBOL" path/to/file.ts
  ```
  Paste only the matching lines. Most of the time I only need a function signature, a constant, or a
  type — not the whole file.
- **Second choice — a small range**: if I need context around a function, paste ~10–30 lines, not the
  file.
- **Only paste a whole file** if I explicitly ask for it (rare — usually when a change is large or the
  file is small).
- For "does X already exist / how is X wired", a grep across the repo is cheaper than opening files:
  ```bash
  grep -rn "SYMBOL" src/
  ```

> This is the single biggest saving. A 300-line file pasted "just in case" is the main waste.

---

## 3. Specs — only for big features

- **Small / mechanical change** (add a game, add a field, tweak copy, a contained bugfix): **no spec**.
  I give a short Claude Code instruction directly in chat. Example: adding Dota 2 was four/five
  one-line edits — no document needed.
- **Big feature** (a new surface, new module, multi-file behaviour, anything with real design
  decisions): **write a spec to `docs/`** as the contract. Worth the tokens because it prevents
  rework and documents intent.
- Rule of thumb: if the instruction fits in a short chat message and there are no real design choices,
  skip the spec.

---

## 4. Claude Code reports — ask for concise

Tell Claude Code to report tersely. A good report is:
- which files changed (names, one line each),
- `tsc --noEmit` result + test count,
- anything unexpected (a compile error it had to fix, a judgement call, a risk).

It should **NOT** paste full file contents or large diffs back unless asked. When relaying to me, paste
that terse report — not re-pasted code.

> Suggested standing instruction to Claude Code (also add to CLAUDE.md): "Report concisely: changed
> files, tsc + test results, and any surprises. Do not paste full file contents or large diffs unless
> I ask."

---

## 5. One slice at a time (unchanged discipline, also saves tokens)

- One feature/change per cycle; finish it (verify + commit) before starting the next.
- Smaller slices = smaller context = fewer tokens, and easier review. This was already the rule; it
  also happens to be token-efficient.

---

## 6. Start a fresh chat at clean boundaries

A long chat carries its whole history every turn, which gets expensive. **When a feature is done and
committed, that's the moment to start a new chat.**

- Continuity survives: project memory + `docs/` (blueprints, specs, this SOP) + `CLAUDE.md` let a new
  chat pick up without re-explaining.
- At the start of a new chat, a one-line orientation is enough, e.g. "Continue EsportsTracker; next is
  <thing>; follow the SOP." I can read the relevant `docs/` file rather than having it pasted.
- Don't start a new chat mid-slice (you'd lose in-flight context); do it at a finished, committed boundary.

---

## 7. Verify-before-build stays (it's cheap and saves more than it costs)

The discipline that caught the `results`-always-present trap and the Dota 2 `begin_at: null` / BO2-draw
edges is NOT what wastes tokens — a couple of `curl` outputs is small and prevents expensive rework.
Keep verifying new external assumptions (e.g. each new game's real response) before coding. Paste only
the relevant slice of the response (`head -c`), not megabytes.

---

## 8. Adding a new game — the repeatable recipe (no per-game spec)

Because games are added repeatedly, here is the fixed checklist (this replaces writing a spec each time):

1. **Verify** the new game's PandaScore endpoint slug and real response shape:
   ```bash
   curl -s -H "Authorization: Bearer YOUR_TOKEN" "https://api.pandascore.co/<slug>/matches/past?per_page=5" | head -c 6000
   curl -s -H "Authorization: Bearer YOUR_TOKEN" "https://api.pandascore.co/<slug>/matches/upcoming?per_page=1" | head -c 3000
   ```
   Paste the slices. Confirm `status` / `results` / `winner_id` / `opponents` / `league` /
   `streams_list` / `number_of_games` match our `RawPandaScoreMatch` assumptions, and note any edge
   (null `begin_at`, BO2 draws, etc.). `-s` without `-I` returns body only (no email header).
2. **Four/five mechanical edits** (the `Record<GameId, …>` types force the ones you'd otherwise miss):
   - `models.ts`: extend `GameId`.
   - `PandaScoreSource.ts`: add to `GAME_ENDPOINT`.
   - `options/App.tsx`: add to the `GAMES` list.
   - `dashboard.ts`: add to `GAME_ORDER`.
   - `dashboard/components/GameGroup.tsx`: add to `GAME_LABEL`.
   - (Trust tsc: any other `Record<GameId, …>` will fail to compile until updated.)
3. **Fixture + test**: commit a real, token-free response under `tests/fixtures/pandascore/` and add a
   normalisation test. Pick a match with a **non-null `begin_at`** (else `normaliseMatch` drops it).
4. `tsc --noEmit` + tests, verify in the browser (select the game; popup/dashboard show it; spoiler
   still works), then commit.

> Verify the slug per game — they're not all obvious (CS2 = `csgo`, Dota 2 = `dota2`). Don't assume.

---

## Closing

✅ This SOP keeps the project's disciplines (verify-first, one slice, clean commits, British English,
minimal permissions, don't-commit-Claude-files) while cutting token waste: grep instead of whole files,
specs only for big features, concise Claude Code reports, fresh chats at clean boundaries, and a fixed
per-game recipe instead of per-game specs.

📋 To apply: at the start of a chat, say "follow the SOP". Add the §4 reporting instruction to CLAUDE.md
so Claude Code reports tersely by default.
