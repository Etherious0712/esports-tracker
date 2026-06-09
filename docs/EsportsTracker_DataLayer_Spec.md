# EsportsTracker — Data Layer Spec

> Finalised from real PandaScore free-token responses (one LoL `past` match and one `upcoming` match).
> This is the implementation spec for `core/models.ts` and `PandaScoreSource`. Claude Code implements against this.
> Naming follows British English; PandaScore JSON field names are platform-named, so their original spelling is kept.

---

## 1. Facts confirmed from real responses

| Fact | Evidence | Implementation impact |
|---|---|---|
| `status` values | `"finished"` / `"not_started"` (also `running` / `canceled`) | State machine keys off `status` |
| **`results` is always present** | even `not_started` returns `[{score:0},{score:0}]` | **Never decide "has a result" from whether `results` exists; use `status === 'finished'`** |
| Score-to-team link | `results[].team_id` | Associate by `team_id` with `opponents`, **not** by array order |
| Winner | top-level `winner_id` (`null` when `not_started`) | Use `winner_id`; cleaner than the `winner` object |
| Format | `number_of_games` (=5) + `match_type` ("best_of") | **No `bestOf` field exists**; map to our own `bestOf` |
| Time | `begin_at` = `"...Z"` UTC ISO 8601 | Store UTC, convert to local only on render |
| End time | `end_at`: present when `finished`, `null` when `not_started` | Nullable |
| Teams | `opponents[].opponent.{name, acronym}` | Take only these two; **ignore `image_url` / `dark_mode_image_url` (logos — trademark risk)** |
| League | `league.name` ("LCK" / "LCP") | Take name; ignore league `image_url` |
| `live` | differs per match (one `true`, one `false`) | Do not assume it exists; nullable |
| `games[]` | per-game winner/status present | Not used in MVP; per-game spoiler is Full-blueprint scope. But "games completed" is a weak spoiler signal |

---

## 2. Internal data model (core/models.ts)

> Our own fields use British spelling. External PandaScore fields are referenced by their original name in the mapping layer.

```ts
export type GameId = 'lol' | 'csgo'; // MVP scope, per games actually enabled

export type MatchStatus = 'notStarted' | 'running' | 'finished' | 'cancelled';
// Note: 'cancelled' is British (our internal value); PandaScore uses 'canceled' — converted in the mapping layer.

export interface Team {
  id: string;          // PandaScore team id, as string
  name: string;        // e.g. "Dplus KIA"
  acronym: string;     // e.g. "DK" (may be empty string — fall back gracefully)
  // No logo / image url stored — trademark avoidance
}

export interface Competition {   // maps to PandaScore "league"
  id: string;
  name: string;        // e.g. "LCK"
}

export interface MatchResult {
  teamId: string;
  score: number;
}

export interface Match {
  id: string;
  game: GameId;
  competition: Competition;
  name: string;              // e.g. "Lower bracket round 1: DK vs BRO"
  teamA: Team;
  teamB: Team;
  beginAtUtc: string;        // ISO 8601 UTC (from begin_at)
  endAtUtc: string | null;   // nullable
  status: MatchStatus;
  bestOf: number;            // from number_of_games (meaningful when match_type === 'best_of')
  results: MatchResult[];    // always present; meaningful only when status === 'finished'
  winnerId: string | null;   // null when notStarted
  officialStreamUrl: string | null; // see §4: main + official from streams_list
}
```

### Derived helper (not stored; computed on demand)
```ts
/** Whether a settled result exists — the only trustworthy test is status, NOT whether results is non-empty */
export function hasResult(m: Match): boolean {
  return m.status === 'finished';
}
```

---

## 3. Status mapping (PandaScore → internal)

```
PandaScore status   →  internal MatchStatus
"not_started"       →  'notStarted'
"running"           →  'running'
"finished"          →  'finished'
"canceled"          →  'cancelled'   // spelling conversion
other / unknown     →  'notStarted'  // safe fallback + log a warning
```

---

## 4. Data source blueprint

### Blueprint: PandaScoreSource (implements IDataSource)
```
Purpose:    Fetch matches within the followed scope from PandaScore and normalise to internal Match[].
Inputs:     FollowConfig (games / teamIds / competitionIds); endpoint type (upcoming|past|running)
Outputs:    Promise<Match[]> (normalised, sorted by beginAtUtc)
Components: fetchMatches(); normaliseMatch(raw); mapStatus(raw); pickOfficialStream(streamsList)
Data flow:  fetchMatches → GET /{game}/matches/{type} → raw[] → normaliseMatch per item → Match[]
Edge cases:
  • results is always non-empty → cannot use it to detect a result (use status)
  • winner_id may be null (notStarted/running)
  • acronym may be an empty string → fall back to a truncation of name
  • end_at / live / videogame_version may be null
  • opponents fewer than 2 (TBD matchup) → skip the match or mark incomplete; must not crash
  • 401/403 → throw AuthError (token/plan issue); 429 → RateLimitError (caller falls back to cache)
  • network error/timeout → DataSourceError; caller degrades to stale chrome.storage.local cache
Test plan:
  • snapshot-test normalisation using the two real fixtures (past / upcoming) committed to the repo
  • not_started 0:0 → hasResult=false, winnerId=null
  • finished → results correctly matched by team_id, winnerId correct
  • canceled → mapped to 'cancelled'
  • missing fields / empty opponents → no throw
```

### Endpoints (verified working)
- `GET https://api.pandascore.co/{game}/matches/upcoming`
- `GET https://api.pandascore.co/{game}/matches/past`
- `GET https://api.pandascore.co/{game}/matches/running`
- Auth: `Authorization: Bearer <token>` (token from `.env`, **never committed**)
- Pagination: `per_page`, `page`; narrow by followed teams/competitions client-side or via filter params.

### Official stream link (streams_list)
```
pickOfficialStream(streamsList):
  take raw_url where main === true && official === true;
  else any official === true;
  else null.
  (For the spoiler-safe "VOD/stream available" reminder.)
```

---

## 5. Normalisation mapping table (raw → Match)

| Internal field | Source (PandaScore raw) | Note |
|---|---|---|
| `id` | `id` | to string |
| `game` | `videogame.slug` or the game param of the call | map to GameId |
| `competition.id` / `.name` | `league.id` / `league.name` | ignore league.image_url |
| `name` | `name` | as-is |
| `teamA` / `teamB` | `opponents[0].opponent` / `opponents[1].opponent` | take id/name/acronym only |
| `beginAtUtc` | `begin_at` | already UTC ISO 8601 |
| `endAtUtc` | `end_at` | nullable |
| `status` | `status` | via §3 mapping |
| `bestOf` | `number_of_games` | present even when match_type isn't best_of, but semantics centre on best_of |
| `results` | `results[]` → `{teamId:String(team_id), score}` | always present |
| `winnerId` | `winner_id` | nullable, to string |
| `officialStreamUrl` | `streams_list` | see §4 |

---

## 6. Test fixtures (must be committed)

Save the two real responses captured during verification (token-free, safe to commit) as the normalisation snapshot baseline:
```
tests/fixtures/pandascore/lol_match_finished.json    (from past)
tests/fixtures/pandascore/lol_match_notstarted.json  (from upcoming)
```
> These fixtures contain no token and are safe to commit; they give the normaliser regression coverage against the real structure. When PandaScore changes a field, the snapshot test flags it immediately.

---

## Closing

✅ **This spec delivers**: a finalised `core/models.ts`, status mapping, `PandaScoreSource` normalisation blueprint and mapping table, and the fixture requirement — all based on real responses. The key traps (`results` always non-empty, scores matched by `team_id`, no `bestOf` field, `canceled` → `cancelled` spelling) are locked in.

📋 **Next steps**:
1. Put this spec in `docs/` and save the two responses under `tests/fixtures/`.
2. Have Claude Code implement `models.ts` and `PandaScoreSource` per §2–§5, with normalisation tests using the §6 fixtures.
3. Once this passes, the next piece to finalise is `core/spoiler.ts` (the spoiler state machine), which depends on the `status` / `hasResult` semantics defined here.

⚠️ **Still to watch**:
- The free plan's **rate limit** is untested; the implementation must include 429 handling + stale-cache fallback.
- Only LoL was verified; before starting CS2 (`csgo`) or other games, fetch one `past`/`upcoming` each to confirm the structure matches (usually it does, but `number_of_games` and game-specific fields may differ).
- The token lives only in `.env`; **never** carry any logo url into the normalised data.
