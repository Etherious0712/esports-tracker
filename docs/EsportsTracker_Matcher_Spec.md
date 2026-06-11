# EsportsTracker — Match Matcher Spec (core/matcher.ts)

> Implementation spec for the "brain" of page-level spoiler protection. Claude Code implements
> against this. **Pure logic only — this slice touches NO web pages, NO DOM, NO content script.**
> It is fully unit-testable. The content script that uses it is a later slice.
> British English throughout.

---

## 1. Why this is isolated

Page-level spoiler protection has two hard parts: (1) deciding what a piece of page text refers to
(this module), and (2) injecting masks into real pages (later). We build and harden the brain first,
in pure unit tests, before it ever touches a live site. Getting this wrong on a real page means
masking content the user wanted — the worst failure mode — so it must be proven in isolation first.

---

## 2. Strategy (locked decisions)

- **Conservative — prefer missing over over-masking.** If confidence is below threshold, return no
  match. A false positive (hiding wanted content) is worse than a false negative.
- **Two independent gates:**
  1. **Is this text a match?** Requires **a followed team's name/acronym AND a "vs" structure**
     (e.g. "T1 vs GENG", "T1 vs. GENG", "T1 versus GENG"). A bare team mention is NOT enough.
  2. **Should it be masked?** On top of gate 1, requires a **"looks like it carries a result"
     signal** (e.g. a score pattern like "2-1", or result words: wins/beats/def./defeats/
     eliminates/advance(s)/champion). Only then is it a spoiler to hide.
- A match that passes gate 1 but not gate 2 is recognised but **not** masked (e.g. a preview/VOD
  with no result hint).

---

## 3. Types

```ts
export interface MatchHint {
  /** Whether this text should be masked (passed BOTH gates). */
  shouldMask: boolean;
  /** Which followed team(s) were recognised, by id. Usually one or two. */
  matchedTeamIds: string[];
  /** 0..1 confidence the text refers to a real (followed) fixture. */
  confidence: number;
  /** Human-readable reason, for debugging/telemetry (not shown to users). */
  reason: string;
}

/** A flattened, normalised lookup built once from the follow list. */
export interface AliasIndex {
  /** normalised alias (name/acronym) → teamId */
  byAlias: Map<string, string>;
}
```

> Inputs come from the data layer's `Team` (`id`, `name`, `acronym`). Build the index from the
> teams the user follows. (Until the "follow teams" feature exists, the content-script slice can
> build the index from the teams present in cached matches — but THAT is the next slice's concern;
> this module just takes a list of teams.)

---

## 4. Core functions

### Blueprint: buildAliasIndex
```
Purpose:    Build a normalised alias → teamId lookup from a list of teams, once, for reuse.
Inputs:     teams: Team[]
Outputs:    AliasIndex
Components: buildAliasIndex(teams); normalise(text)
Rules:      for each team, register normalise(name) and (if non-empty) normalise(acronym).
Edge cases: empty acronym → skip it (don't register '');
            duplicate/ambiguous alias across teams (e.g. two teams share an acronym) → mark that
            alias ambiguous so the matcher can lower confidence / avoid it (do NOT silently pick one);
            very short aliases (length < 2 after normalise) → skip (too noisy, e.g. single letters).
Test plan:  name and acronym both registered; empty acronym skipped; ambiguous alias flagged;
            1-char alias skipped.
```

### Blueprint: normalise
```
Purpose:    Canonicalise text for comparison so case/spacing/width differences don't cause misses.
Inputs:     raw: string
Outputs:    normalised string (lowercased, trimmed, collapsed whitespace, common punctuation folded)
Edge cases: handle full-width vs half-width where cheap; strip surrounding punctuation;
            keep it simple and deterministic — no locale-specific surprises.
Test plan:  "T1" / "t1" / " t1 " → same; "GEN.G" vs "GENG" fold consistently.
```

### Blueprint: matchText (the gates)
```
Purpose:    Decide whether a piece of page text refers to a followed fixture, and whether to mask it.
Inputs:     text: string; index: AliasIndex
Outputs:    MatchHint | null  (null when no followed team is recognised at all)
Components: matchText(text, index); hasVsStructure(text); hasResultSignal(text)
Logic:
  1. normalise text; scan for followed-team aliases present in it → matchedTeamIds
     - if none → return null
  2. GATE 1 (is-a-match): require hasVsStructure(text) AND at least one matched team.
     - if gate 1 fails → return a hint with shouldMask=false, low confidence (recognised a team
       name but not a fixture) — or null; pick one and be consistent (recommend: null, to keep the
       content script simple — "no fixture here").
  3. GATE 2 (should-mask): hasResultSignal(text) on top of gate 1.
     - shouldMask = (gate1 && gate2)
  4. confidence: higher when two followed teams both appear + vs + result signal; lower when only
     one team + vs. Encode a simple, documented scoring; never mask below threshold.
Edge cases:
  • ambiguous alias (from index) present → reduce confidence; if that pulls below threshold, don't mask
  • a result signal but no vs / no followed team → null (not our fixture)
  • two different followed teams both present without vs (e.g. a listing page) → gate 1 fails (no vs) → don't mask
  • case/whitespace/punctuation variants → handled by normalise
Test plan:  see §5
```

### Blueprint: helper signals
```
hasVsStructure(text):   matches " vs ", " vs. ", " versus " (normalised, word-boundaried).
hasResultSignal(text):  a score pattern (\b\d+\s*-\s*\d+\b) OR a result word from a small set
                        {wins, beats, defeats, def., eliminates, advances, advance, champion(s)}.
                        Keep the word list small and documented; err towards fewer words (conservative).
```

---

## 5. Test plan (Vitest, pure)

| Scenario | Text (example) | Expectation |
|---|---|---|
| Fixture + score → mask | "LCK | T1 vs GENG 2-1 | Highlights" | shouldMask=true, both teams, high confidence |
| Fixture, no result → no mask | "T1 vs GENG — Pre-match analysis" | hint, shouldMask=false (or null per chosen convention) |
| Bare team, no vs → null | "T1 best plays of 2026" | null (gate 1 fails) |
| Result words, not our team → null | "FNC beats MAD 2-0" (not followed) | null |
| Result word phrasing → mask | "T1 defeats GENG in the final" | shouldMask=true |
| Ambiguous acronym → low conf, no mask | "G2 vs XYZ 2-0" where G2 alias is ambiguous | shouldMask=false (below threshold) |
| Case/space variants → still match | "t1   VS   geng  2 - 1" | shouldMask=true |
| Empty acronym not indexed | team with acronym '' | name still matches; '' never matches everything |
| One followed team + vs + score → mask | "T1 vs SomeUnknown 2-1" | shouldMask=true (one followed team is enough per your gate-1 choice) |
| Result signal only, no vs → null | "T1 wins MSI" | null (no vs structure) |

> Note the last "T1 wins MSI" case: per your locked gate-1 rule (team + vs structure), this has no
> "vs" so it is NOT treated as a fixture and is NOT masked. Flagging because some real titles spoil
> without a "vs" ("T1 are world champions"). This is a deliberate, conservative gap in the MVP —
> revisit if it proves too leaky in practice. Documented here so it's a known trade-off, not a bug.

---

## Closing

✅ **This spec delivers**: the locked two-gate strategy, `MatchHint`/`AliasIndex` types,
`buildAliasIndex` + `normalise` + `matchText` + signal helpers, a conservative confidence model,
and a pure test plan. No DOM, no site code.

📋 **Next steps**:
1. Put this spec in `docs/`.
2. Have Claude Code implement `src/core/matcher.ts` with Vitest tests per §5. Pure logic only —
   no content script, no DOM, no site adapters. No commit.
3. After this lands and is well-tested, the next (final MVP) slice is the content script that USES
   this matcher on ONE site first — Liquipedia (most structured) — then YouTube.

⚠️ **Watch**:
- Conservative by default: never mask below the confidence threshold. Prefer missing over over-masking.
- Ambiguous aliases must lower confidence, never silently resolve to one team.
- The "no vs structure" gap (e.g. "T1 are champions") is a known, accepted MVP limitation — documented, revisit later.
- Keep the result-word list small and documented; a bloated list causes false masks.
- This slice writes pure logic only; resist any urge to start the content script here.
