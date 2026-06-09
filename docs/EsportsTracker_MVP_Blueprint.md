# EsportsTracker — MVP Technical Blueprint

> Working codename EsportsTracker; rename freely. This document is the "build this first" minimum viable version. The goal is to **validate demand at zero cost**: do people actually want an in-browser, spoiler-free esports tracker?
> Companion document: `EsportsTracker_Full_Blueprint.md` (the full roadmap).

---

## 0. Goals & constraints (Phase 0)

**Problem to solve**: Esports fans (especially someone in Malaysia, where major events play late at night across EU/NA/KR time zones and they mostly watch VODs) get the result spoiled from every direction before they open the recording, ruining the experience. Existing extensions are either single-game or abandoned; nobody does "cross-event + spoiler-free + reminders" well inside the browser.

**Constraints**:
- Fully free tech stack; the only fixed cost is the one-time Chrome Web Store developer registration ($5).
- Solo developer; **no backend** in the MVP — all state lives locally in the browser.
- Manifest V3 (MV3 is the only option; new extensions must use it).
- Data from PandaScore's **free plan** (schedules/results/context), which is enough for a tracker.

**Definition of done**: the extension is published to the Chrome Web Store; users can follow teams/competitions, see schedules, get match reminders, and use spoiler-free mode to view finished matches without being spoiled. It produces weekly-active and retention signals to decide whether to invest in the full version.

**Explicitly NOT in the MVP** (deferred to the full version): backend/caching proxy, paid features, multi-browser, cross-device cloud sync, bracket-progression spoiler hiding, deep stats, multi-language.

---

## 1. MVP scope

**In (the core loop)**:
1. **Pick games**: support 1–2 games you personally follow to start (e.g. LoL + CS2). Don't over-reach.
2. **Follow teams / competitions**: user selects what to track.
3. **Schedule view**: the popup shows three sections — "Live / Upcoming / Recently finished".
4. **Match reminders**: native notification N minutes before start; after the match, a **spoiler-safe** "ready to watch the VOD" message.
5. **In-extension spoiler protection**: inside the extension's own popup/dashboard, finished-but-not-yet-revealed matches have their score masked; click to reveal.
6. **Page-level spoiler protection (the differentiator, extension-only)**: mask results on the real pages you browse — the thing a desktop app cannot do, and this project's moat. In the MVP, use a **text-matching** approach on a small number of the most spoiler-prone sites, masking elements that contain a followed team/competition and look like they carry a score. Start with **2–3 sites** (most pragmatic combination: Liquipedia for structure, YouTube titles/sidebar text, optionally Twitch); click to reveal.
7. **Local storage**: preferences in `chrome.storage.sync`, cached data in `chrome.storage.local`.

**Out (boundaries of page-level spoiler protection)**: **visual spoilers** in thumbnails/cover images (a player lifting a trophy, etc.) — cannot be detected cheaply/reliably client-side, explicitly excluded; fully automatic detection on arbitrary sites — only a small whitelist is covered; otherwise see the "explicitly NOT" list in Phase 0.

---

## 2. Tech choices

| Layer | Choice | Why |
|---|---|---|
| Extension framework | **WXT** (or Plasmo) | open-source, MV3-native, TS + HMR, removes a lot of boilerplate |
| Language | **TypeScript** | type safety; matches your engineering standards |
| UI | Preact or React (WXT supports both) | componentised popup/options, small footprint |
| Styling | Tailwind or plain CSS | free, fast |
| Data source | **PandaScore free plan** | schedules/results free, enough |
| Storage | `chrome.storage` (sync + local) | no backend |
| Reminders | `chrome.alarms` + `chrome.notifications` | built into the browser |
| Source control / CI | GitHub + Actions free tier | — |

---

## 3. MV3 architecture overview

```
┌─────────────────────────────────────────────────────────┐
│                  Browser extension (MV3)                  │
│                                                           │
│  ┌────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  Popup UI  │   │  Options page│   │ (optional)     │  │
│  │ schedule / │   │ pick games / │   │  New Tab        │  │
│  │ spoiler    │   │ follow       │   │  today's matches│  │
│  └─────┬──────┘   └──────┬───────┘   └───────┬────────┘  │
│        │ read storage    │ write prefs       │            │
│        └─────────────────┼───────────────────┘            │
│                          ▼                                │
│              ┌────────────────────────┐                   │
│              │   chrome.storage        │                  │
│              │  sync: prefs/follow list│                  │
│              │  local: match cache /   │                  │
│              │         reveal state    │                  │
│              └───────────▲────────────┘                   │
│                          │ read/write                     │
│        ┌─────────────────┴───────────────────┐            │
│        │      Service Worker (background)      │           │
│        │  • chrome.alarms periodic poll (5–10m)│          │
│        │  • call DataSource for schedule/results│         │
│        │  • normalise → write cache            │           │
│        │  • compute & fire notifications (dedup)│          │
│        └────────┬──────────────────┬─────────────┘         │
│                 │ HTTPS            │ pushes "finished &    │
│                 │                  ▼  unrevealed" set       │
│                 │      ┌─────────────────────────────────┐ │
│                 │      │  Content Scripts (whitelist sites)│ │
│                 │      │  YouTube / Liquipedia / (Twitch)  │ │
│                 │      │  • scan page text, match follows  │ │
│                 │      │  • hit + looks like score → mask  │ │
│                 │      │    + reveal button                │ │
│                 │      └─────────────────────────────────┘ │
└─────────────────┼─────────────────────────────────────────┘
                  │
                  ▼
       ┌────────────────────┐
       │  PandaScore API    │
       │  (free plan)       │
       └────────────────────┘
```

---

## 4. Project structure

```
esports-tracker/
├── src/
│   ├── background/
│   │   └── index.ts            # service worker entry: register alarms, schedule refresh
│   ├── popup/
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── MatchList.tsx
│   │       └── SpoilerGuard.tsx   # score-mask component
│   ├── options/
│   │   └── App.tsx             # pick games, follow teams/competitions, notification prefs
│   ├── content/
│   │   ├── index.ts              # content script entry: dispatch by site
│   │   ├── sites/
│   │   │   ├── ISiteAdapter.ts   # site adapter interface (one impl per site)
│   │   │   ├── youtube.ts        # YouTube: scan title/sidebar text
│   │   │   ├── liquipedia.ts     # Liquipedia: structured, hit score cells
│   │   │   └── twitch.ts         # (optional) Twitch
│   │   └── mask.ts               # inject mask DOM + "Show result" button
│   ├── core/
│   │   ├── datasource/
│   │   │   ├── IDataSource.ts      # data source interface (for adding sources later)
│   │   │   └── PandaScoreSource.ts # PandaScore implementation
│   │   ├── models.ts              # Match / Team / Competition / FollowConfig types
│   │   ├── storage.ts             # typed storage read/write wrapper
│   │   ├── spoiler.ts             # spoiler state logic (shared: in-extension + page-level)
│   │   ├── matcher.ts             # text ↔ followed team/competition matching (page-level)
│   │   ├── notifier.ts            # notification generation + dedup
│   │   └── time.ts                # UTC ↔ local time formatting
│   └── manifest.ts                # WXT manifest config
├── tests/
├── wxt.config.ts
└── package.json
```

---

## 5. Data model (core/models.ts)

> See the dedicated `EsportsTracker_DataLayer_Spec.md` for the finalised model and the PandaScore mapping (derived from real API responses). The summary:

```ts
export type GameId = 'lol' | 'csgo';            // MVP: 1–2 games only

export type MatchStatus = 'notStarted' | 'running' | 'finished' | 'cancelled';

export interface Team {
  id: string;
  name: string;
  acronym: string;
  // No official logo url stored — trademark avoidance; MVP uses initials/placeholder
}

export interface Competition { id: string; name: string; }  // PandaScore "league"

export type Match = {
  id: string;
  game: GameId;
  competition: Competition;
  name: string;
  teamA: Team;
  teamB: Team;
  beginAtUtc: string;          // ISO 8601 UTC; convert to local on render
  endAtUtc: string | null;
  status: MatchStatus;
  bestOf: number;              // from PandaScore number_of_games
  results: { teamId: string; score: number }[]; // ALWAYS present — see spec §1
  winnerId: string | null;
};

export interface FollowConfig {
  games: GameId[];
  teamIds: string[];
  competitionIds: string[];
}

export interface NotificationPrefs {
  enabled: boolean;
  leadMinutes: number;         // pre-match lead, default 15
  notifyOnEnd: boolean;        // post-match "ready to watch" (spoiler-safe wording)
  spoilerSafeWording: boolean; // notifications carry no score, default true
}
```

> **Critical trap (from real data)**: `results` is present even before a match starts (`[{score:0},{score:0}]`). Never infer "has a result" from `results`; use `status === 'finished'`. Full detail in the Data Layer Spec.

---

## 6. Core component blueprints

### Blueprint: DataSource abstraction
```
Purpose:    Decouple "where data comes from" from business logic, so adding Liquipedia/Riot/etc later doesn't touch upper layers.
Inputs:     FollowConfig (followed games/teams/competitions)
Outputs:    Promise<Match[]> (normalised to the internal Match model)
Components: IDataSource interface; PandaScoreSource impl; normalise() function
Data flow:  SW → DataSource.fetchMatches(follow) → HTTP → raw JSON → normalise() → Match[]
Edge cases: API rate-limit/timeout → throw DataSourceError, caller falls back to stale cache;
            empty follow list → return [] without a request; missing fields → safe defaults
Test plan:  normalise mapping over sample JSON; correct error type on rate limit; empty input short-circuits
```
Interface:
```ts
export interface IDataSource {
  /** Fetch recent/upcoming/live matches within the followed scope */
  fetchMatches(follow: FollowConfig): Promise<Match[]>;
}
```

### Blueprint: spoiler engine (core/spoiler.ts)
```
Purpose:    Decide whether a given match's score should be hidden, and manage "watched" state.
Inputs:     Match; that match's revealed state (from storage.local)
Outputs:    SpoilerDecision = { hideScore: boolean; hideWinner: boolean }
Components: getSpoilerDecision(match, revealed); reveal(matchId); isRevealed(matchId)
Data flow:  before UI render → getSpoilerDecision() → decide mask; user clicks "Show result" → reveal() writes storage
Edge cases: whether running matches are spoiler-guarded is a user pref (default: also guard);
            once revealed it must persist; bestOf should be de-emphasised when guarding (see §7)
Test plan:  finished+unrevealed → hideScore=true; after reveal → false and persisted;
            running honours the pref; cancelled → not a spoiler
```
Core rule:
```ts
export function getSpoilerDecision(
  match: Match,
  revealed: boolean,
  prefs: { hideRunning: boolean },
): { hideScore: boolean; hideWinner: boolean } {
  if (revealed) return { hideScore: false, hideWinner: false };
  if (match.status === 'finished') return { hideScore: true, hideWinner: true };
  if (match.status === 'running' && prefs.hideRunning)
    return { hideScore: true, hideWinner: true };
  return { hideScore: false, hideWinner: false }; // notStarted / cancelled
}
```

### Blueprint: notification engine (core/notifier.ts)
```
Purpose:    Fire "pre-match" and "post-match ready to watch" notifications at the right time, spoiler-free and without duplicates.
Inputs:     Match[], NotificationPrefs, already-notified record (a Set<string> in storage.local)
Outputs:    side effects: chrome.notifications.create(...); update the notified record
Components: computeNotifications(matches, prefs, sent); buildMessage() (spoiler-safe wording)
Data flow:  SW alarm fires → fetch data → computeNotifications → filter already-sent → notify → record
Edge cases: SW sleeps and misses the exact instant (MV3) → judge by a time *window*, not an exact moment;
            duplicate fires for the same match → idempotency key `${matchId}:pre` / `${matchId}:end`;
            time zones → compare in UTC, convert to local only for display
Test plan:  fires once within the pre-match window; spoilerSafeWording omits score;
            entries already in sent are not re-sent; cancelled matches get no post-match notice
```
Spoiler-safe wording example: when on, send "⏰ Your followed match TeamA vs TeamB has finished — you can watch the VOD now", **with no score**; only when off may it say "TeamA 2-1 TeamB".

### Blueprint: match matcher (core/matcher.ts) — the "brain" of page-level spoiler protection
```
Purpose:    Decide whether a piece of page text corresponds to a match the user follows that is finished-and-not-yet-revealed.
            This is the hardest, most outcome-defining part of page-level spoiler protection — too broad masks unrelated
            content, too narrow misses spoilers.
Inputs:     a page element's visible text (string); followed team/competition alias table; the "finished & unrevealed" set
Outputs:    MatchHint | null = { matchId, confidence: number, reason }
Components: buildAliasIndex(teams, competitions) (incl. acronyms / common spellings); matchText(text, index, finishedSet)
Data flow:  content script takes element text → matchText() → on hit, returns a hint for the mask decision
Edge cases: same-name/acronym ambiguity ("G2" multiple teams) → require a confidence threshold; prefer missing over wrong;
            language/case/full-width differences → normalise before comparing;
            team name present but actually "preview / no score" content → also needs a "looks like a score" signal to mask
Test plan:  followed team's post-match title → hit; unrelated video → no hit; acronym ambiguity → low confidence → no mask;
            case/multilingual variants → still hit
```
> Key trade-off: **a false positive (hiding content the user wanted) hurts more than a false negative (missing one spoiler)** — masking a wanted, unrelated video leads to immediate uninstalls. So the matcher defaults to conservative: better to miss the occasional spoiler than to mask wrongly.

### Blueprint: page-level spoiler content script (content/)
```
Purpose:    On real pages of whitelisted sites, mask the result elements of followed, finished-and-unrevealed matches;
            reveal on click. This is the extension's one capability a desktop app cannot match.
Inputs:     current site (decides which SiteAdapter); the follow table and finished-and-unrevealed set from storage
Outputs:    side effects: inject a mask layer + "Show result" button on hit elements; on click, reveal and persist via spoiler.reveal
Components: site dispatcher; ISiteAdapter (one per site: select candidate elements + extract text);
            matcher.matchText(); mask.applyMask(el) / removeMask(el); MutationObserver for dynamic loads
Data flow:  page load/DOM change → SiteAdapter selects candidate elements → take text → matcher decides →
            hit & unrevealed → applyMask; user clicks reveal → reveal(matchId) writes storage → all same-matchId reveal
Edge cases: SPA / infinite scroll dynamic inserts (YouTube) → MUST use MutationObserver, not a single pass;
            site redesign breaks selectors → SiteAdapter isolates impact; one site breaking must not break others;
            the mask itself must not leak (don't put score into DOM text/aria-label; use a placeholder);
            performance → throttle + scan candidate containers only, not the whole page;
            after reveal on one page, other pages/in-extension must be consistent (shared spoiler state)
Test plan:  Liquipedia score cell masked, click reveals & persists; YouTube title with followed team masked,
            unrelated video not masked; dynamically inserted elements handled too;
            on stale selectors, fail safe (no throw, no false masking)
```
Site adapter interface (each site only implements "which elements, and what is each one's visible text"):
```ts
export interface ISiteAdapter {
  /** does this adapter apply to the current page */
  matches(url: string): boolean;
  /** candidate elements on the page that might carry a spoiler */
  collectCandidates(root: ParentNode): HTMLElement[];
  /** visible text from a candidate, used for matching */
  extractText(el: HTMLElement): string;
}
```
> Pragmatic MVP scope: **do Liquipedia first (most structured, easiest to get right)**, then add YouTube (title/sidebar text + team-name matching). Twitch as appropriate. Each new site is one more `ISiteAdapter`, isolated from the rest.

---

## 6b. Spoiler protection: how the two paths cooperate

Page-level (content script) and in-extension (popup) share one "watched" state (`core/spoiler.ts` + storage), so:
- Click "Show result" on YouTube, and back in the popup that match is revealed too — **reveal once, revealed everywhere**.
- Both paths first ask `spoiler.ts`: should this match be hidden? The only difference is **which DOM gets masked** (in-extension masks its own score component; page-level masks external elements).
- Shared-state storage key design is in §7.

---

## 7. Key design decisions

- **Spoiler protection on by default**: finished matches are masked by default — the soul of the product. But give a clear "Show result / Mark as watched" entry; don't make it hard to find.
- **Shared "watched" state key**: use `revealed:<matchId>` in `chrome.storage.local` (or a single aggregated `Set<matchId>` key). The popup and every site content script **read/write the same record**, guaranteeing "reveal once, revealed everywhere". matchId must be consistent across all sites (the authoritative id from the DataSource).
- **False positives hurt more than false negatives** (page-level only): the matcher defaults to conservative; if confidence is too low, don't mask — masking wanted, unrelated content triggers immediate uninstalls and bad reviews.
- **Handle weak spoilers too**: `bestOf`, match duration, bracket progression can all spoil indirectly. The MVP should at least **not prominently show `bestOf`** when spoiler mode is on; bracket/progression is full-version scope.
- **Time zones**: the author is in Malaysia (UTC+8), but matches span time zones. **Store UTC, convert to local on render**; never localise in the storage layer.
- **MV3 service workers sleep**: don't rely on "to-the-minute" timing. Use `chrome.alarms` (minimum period ~1 minute, recommend 5–10) to wake periodically and judge by a time window, rather than assuming the SW stays alive.
- **Minimal permissions, but page-level spoiler protection needs whitelisted host permissions**: request `storage`, `alarms`, `notifications`, plus host permission for `api.pandascore.co` **and the few sites the spoiler feature covers** (e.g. `*://*.youtube.com/*`, `*://liquipedia.net/*`). **Never use `<all_urls>`** — list only the sites actually injected. Content scripts match only those sites. On the store listing, explain why (e.g. "YouTube permission: used to mask scores on that site") to reduce user worry — extension trust is a new product's biggest hurdle.
- **Content scripts only read the DOM to mask; they make no external requests and read no user data**: their only side effect is adding a mask to hit elements. State this in the privacy policy.

---

## 8. manifest permissions (WXT config sketch)

```ts
// wxt.config.ts (excerpt)
manifest: {
  name: 'EsportsTracker',
  permissions: ['storage', 'alarms', 'notifications'],
  host_permissions: [
    'https://api.pandascore.co/*',
    // —— only sites the page-level spoiler feature covers; never <all_urls> ——
    '*://*.youtube.com/*',
    '*://liquipedia.net/*',
    // '*://*.twitch.tv/*',   // optional, as appropriate
  ],
}
// content script matches map one-to-one to the sites above (WXT defineContentScript);
// each site maps to one ISiteAdapter; adding a site = one host + one adapter.
```

---

## 9. Test plan (Phase 5)

| Scenario | What it tests | Framework |
|---|---|---|
| Happy path | follow 1 team → fetch matches → correct sectioning | Vitest |
| Normalisation | PandaScore sample JSON → correct Match mapping | Vitest |
| Spoiler state machine | finished/running/revealed combinations → correct decision | Vitest |
| Match matcher | followed-team post-match title hits; unrelated misses; acronym ambiguity → low confidence → no mask | Vitest |
| Page-level masking | given sample DOM → hit elements masked, unrelated untouched; reveal persists & consistent across pages | Vitest (jsdom) |
| Dynamic loading | MutationObserver handles elements inserted after load | Vitest (jsdom) / manual |
| Notification dedup | same match not re-sent; idempotency key correct | Vitest |
| Time zone | UTC input → correct local render (incl. day boundary) | Vitest |
| Error/degrade | API rate-limit/timeout → use stale cache, don't crash | Vitest (mock fetch) |
| Adapter resilience | SiteAdapter selectors stale → no throw, no false masking | Vitest |
| MV3 lifecycle | SW woken by alarm after sleep still works | manual + load extension |
| E2E | mask appears/click reveals on a real page | Playwright (you have the skill) |

Naming follows `<Method>_<Scenario>_<ExpectedResult>`, e.g. `GetSpoilerDecision_FinishedNotRevealed_HidesScore`.

---

## 10. Launch & validation

1. Register a Chrome Web Store developer account (one-time $5).
2. Prepare a **privacy policy** (required by CWS, even if it only states "data is stored locally and never uploaded").
3. Mark the listing **"Unofficial"**; do not use official team/competition logos.
4. After launch, post to r/<your game>, Indie Hackers, Product Hunt.
5. **Track weekly-active/retention + store rating, not install count.** Set a clear "meet this bar before investing in the full version" threshold (e.g. weekly active ≥ X%, rating ≥ 4.3).

---

## Closing

✅ **This blueprint delivers**: a directly buildable MVP architecture — MV3 structure, folders, data model, and blueprints for five core components (data source / in-extension spoiler / notifier / **match matcher** / **page-level spoiler content script**), with permissions, the cooperation logic, and a test plan — all backendless, free stack. **Page-level spoiler protection is the extension's one edge over a desktop app, and is written in as a core module.**

📋 **Suggested next steps**:
1. Decide which 1–2 games the MVP supports (per what you follow), and which 2–3 sites page-level spoiler protection covers first (suggest starting with Liquipedia).
2. Initialise the project with WXT; run a hello-world through the store-submission flow.
3. Recommended build order: "data source → cache → popup list" → in-extension spoiler → notifier → **matcher → page-level spoiler (Liquipedia first, then YouTube)**. Put the hardest page-level work after the data layer and matcher are solid.
4. If you like, I can turn any component (e.g. `spoiler.ts`, `matcher.ts`, a given `ISiteAdapter`) into ready-to-use code.

⚠️ **Known limitations & assumptions**:
- **The page-level matching is the biggest engineering risk**: deciding "is this content a spoiler?" from text is inherently heuristic, with false positives/negatives. Default conservative (prefer missing), and build per-site `ISiteAdapter`s. **Visual spoilers (thumbnails of a player celebrating, etc.) are explicitly out of MVP scope** — not cheaply/reliably detectable client-side.
- **Sites change**: YouTube/Twitch DOM changes often; SiteAdapter selectors will break and need maintenance. Isolate each site so one breaking doesn't take down the rest. Liquipedia is most stable — do it first.
- **API key exposure risk**: if the MVP calls PandaScore directly from the service worker, the key is bundled into the client and extractable. This is the trade-off accepted for "no backend" in the MVP, **and should be the first thing fixed in the full version** (a caching proxy keeps the key server-side). If you don't mind "a free Cloudflare Worker still counts as free stack", you can add that thin proxy even in the MVP for more safety.
- Assumes the PandaScore free plan covers the schedules/results for your chosen games (verify the fields after registering).
- Direct client calls will hit rate limits as usage grows — exactly why the full version introduces the caching proxy.
- Page-level spoiler protection needs host permission on whitelisted sites — **this triggers a permission prompt at install** and may deter some users. Explain the purpose on the listing and in the privacy policy ("only used to mask scores on these sites; no data collected").
- Team/competition names are fine to use; **logos/brand assets are trademarks** — always avoid them.
