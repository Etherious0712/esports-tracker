# EsportsTracker — MVP Blueprint

> Working codename EsportsTracker (Unofficial); rename freely.
> **This blueprint reflects the product's focus after the pivot away from page-level spoiler protection.**
> Companion document: `EsportsTracker_Full_Blueprint.md` (roadmap + monetisation).

---

## 0. What this product is

A browser extension that helps you **keep up with your favourite esports teams**: it reminds you when
a followed team's match is about to start and when it has finished (so you can watch the VOD), and it
lets you see your teams' schedule and recent results in a popup — **without spoiling the result** unless
you choose to.

**Core value**: timely, spoiler-free awareness of your followed teams' matches.

**The product is a reminder/tracker, not a data portal and not a page-level spoiler blocker.**

### History / why the pivot
An earlier version masked scores on real pages (YouTube, Liquipedia) via content scripts. That was
dropped: spoilers come from too many platforms (X, Facebook, Instagram, thumbnails…) for per-site
masking to be reliable or maintainable. The valuable, low-maintenance part of spoiler protection —
**not spoiling you in our own notifications and list** — is kept, as an optional, default-on setting.
The page-level code remains in git history if a better approach is ever found.

---

## 1. Form factor decision (and its honest trade-off)

- **Browser extension**, because the user is primarily at a desktop and desktop/browser notifications
  are enough.
- **Honest trade-off**: once page-level masking is gone, the extension no longer has a capability a
  desktop or mobile app lacks. It's a "reminder that lives in the browser". This is accepted for the
  MVP (fast to ship, free distribution via the Web Store, zero install friction). If reminders ever
  need to reach the user away from the desktop, a mobile form factor would be reconsidered — a
  roadmap question, not an MVP one.

---

## 2. Constraints

- Free tech stack; only fixed cost is the one-time Chrome Web Store developer registration ($5).
- Solo developer; **no backend** in the MVP — all state local.
- Manifest V3.
- Data from PandaScore's **free plan** (schedules / results / teams search) — sufficient for a tracker.
- **Minimal permissions**: `storage`, `alarms`, `notifications`, and host permission for
  `api.pandascore.co` only. **No content scripts, no broad host permissions** — a clean, low-friction
  install (no scary "read your data on YouTube" prompt).

---

## 3. MVP scope (what's built)

All of the following is implemented and shipping:

1. **Pick games**: track 1–2 games (LoL, CS2).
2. **Follow teams** (search-based): search PandaScore by name for the selected game, follow/unfollow.
   Empty follow list = track all matches of the selected game (additive).
3. **Background fetch + cache**: a ~10-min alarm + startup refresh pulls matches for followed games
   into local cache; failure keeps the previous cache.
4. **Popup match list**: the followed teams' matches, newest first, with local kickoff times and a
   link to the official stream/VOD.
5. **Notifications**: pre-match reminder (~N min before) and a post-match "VOD ready" reminder, with
   **spoiler-safe wording** (no score/winner) — per-match dedup, missed pre-match dropped not fired late.
6. **Spoiler protection (optional, default ON)**: in the popup, finished matches have their score
   masked with a "Show result" button; reveal persists. A settings toggle (`SpoilerPrefs.enabled`,
   default true) turns this off entirely for users who'd rather always see scores. A secondary
   `hideRunning` toggle (default off) also guards in-progress matches.
7. **Settings**: game selection, team search/follow, spoiler toggle(s).

### Out of scope (deliberately, or removed)
- ❌ Page-level spoiler masking on third-party sites (removed — see §0).
- ❌ A team matcher / multi-site adapters (removed).
- A full "follow list → dashboard with grouping" view (backlog).
- A real branded icon (backlog; placeholder in use).

---

## 4. Architecture (MV3, backendless)

```
┌────────────────────────────────────────────────────────────┐
│                    Browser extension (MV3)                   │
│                                                              │
│  ┌────────────┐        ┌───────────────────────────────┐    │
│  │  Popup UI  │        │  Options (settings)            │    │
│  │ team list, │        │  games · team search/follow ·  │    │
│  │ spoiler-   │        │  spoiler toggle(s)             │    │
│  │ guarded    │        └───────────────┬───────────────┘    │
│  │ scores     │                        │ write prefs/follow  │
│  └─────┬──────┘                        ▼                     │
│        │ read              ┌────────────────────────┐        │
│        └──────────────────►│   chrome.storage        │       │
│                            │  sync: prefs, follow,   │        │
│                            │        followedTeams    │        │
│                            │  local: match cache,    │        │
│                            │        reveal set,      │        │
│                            │        notifier sent-set│        │
│                            └───────────▲────────────┘        │
│                                        │ read/write          │
│        ┌───────────────────────────────┴───────────────┐     │
│        │      Service Worker (background)                │    │
│        │  • ~10-min chrome.alarms + startup refresh      │    │
│        │  • PandaScoreSource.fetchMatches → cache         │   │
│        │  • computeNotifications → chrome.notifications   │   │
│        └───────────────────────┬─────────────────────────┘   │
└────────────────────────────────┼─────────────────────────────┘
                                 │ HTTPS (Bearer token from env)
                                 ▼
                      ┌────────────────────┐
                      │  PandaScore API    │
                      │  (free plan)       │
                      └────────────────────┘
```

No content scripts. No backend.

---

## 5. Modules (as built)

- `core/models.ts` — Match, Team, Competition, FollowConfig, NotificationPrefs, SpoilerPrefs, hasResult.
- `core/storage.ts` / `core/storage-area.ts` — typed chrome.storage wrappers (sync prefs/follow,
  local cache/reveal/sent), injectable StorageArea for tests.
- `core/time.ts` — UTC ↔ local formatting.
- `core/datasource/` — IDataSource + PandaScoreSource (`fetchMatches`, `searchTeams`, normalisation,
  shared auth/error mapping).
- `core/spoiler.ts` — `getSpoilerDecision` (pure), reveal-state store, SpoilerPrefs.
- `core/notifier.ts` — `computeNotifications` + `buildMessage` (spoiler-safe), prune.
- `background/` + `entrypoints/background.ts` — refresh + notification wiring, sent-set store.
- `entrypoints/popup/` — App, MatchList, MatchRow, SpoilerGuard.
- `entrypoints/options/` — settings (games, team search/follow, spoiler toggles).

(Removed in the pivot: `core/matcher.ts`, `content/liquipedia.ts`, the Liquipedia content entrypoint,
and their tests/fixtures/specs.)

---

## 6. Spoiler protection in the reminder product (clarified)

Spoiler protection now means two things, both low-maintenance and both optional via one default-on switch:

1. **In the popup list**: finished matches' scores are masked until revealed (`SpoilerGuard` +
   `getSpoilerDecision`). Reveal persists.
2. **In notifications**: the post-match message says "your match has finished — VOD ready", never the
   score, when spoiler-safe wording is on.

The settings toggle `SpoilerPrefs.enabled` (default **true**) governs the masking; off → scores always
shown. This keeps the product's differentiator (it doesn't spoil you) as the default first impression,
while respecting users who prefer to see scores immediately.

---

## 7. Quality bar

- TypeScript strict; British English in all authored code/docs/commits.
- Pure logic unit-tested (Vitest); UI tested with jsdom; ~107 tests at the time of the pivot.
- Minimal permissions; token only in `.env` (gitignored), never committed, never logged.
- "Unofficial" labelling; team/competition names only, no official logos.

---

## 8. Validation plan (ties into monetisation — see Full blueprint)

1. Publish to the Chrome Web Store ($5 one-time); add a privacy policy ("data stored locally, not
   uploaded").
2. Use it personally for a while — the author is the target user — to judge whether the reminder +
   default spoiler-free experience is actually useful day to day.
3. Post to relevant communities (r/<game>, Indie Hackers, Product Hunt).
4. Track **weekly-active / retention + store rating**, not install count, to decide whether to invest
   further (e.g. a dashboard, a real icon, eventually a Pro tier).

---

## Closing

✅ **This blueprint describes the current, focused product**: followed-teams tracking + desktop
reminders + an optional (default-on) spoiler-free popup list — a clean MV3 extension with no content
scripts and a single API host permission.

📋 **Backlog (post-MVP)**:
- Spoiler toggle exposure in settings (the `enabled` switch) if not yet wired.
- A grouped dashboard view (by status/game/tournament) — a richer surface than the popup list.
- A real branded icon (replace the placeholder).
- Localisation (EN/ZH).
- Possible future reconsideration of a mobile form factor for reminders.

⚠️ **Known trade-offs**:
- Without page-level masking, the extension has no capability a desktop/mobile app lacks — accepted.
- A pure reminder/tracker is a thinner differentiator than the original spoiler-blocker; the default-on
  spoiler-free behaviour is what keeps it distinct from a generic results-push tool. Guard that default.
- Page-level spoiler protection is preserved in git history if a better, broader approach emerges.
