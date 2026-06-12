# EsportsTracker — Full Blueprint (Roadmap & Monetisation)

> The target shape and growth path AFTER the MVP is validated. **Updated to reflect the pivot to a
> reminder/tracker product** (page-level spoiler protection removed).
> Companion document: `EsportsTracker_MVP_Blueprint.md` (build this first).
> Built in threshold-gated phases — "validate free first, invest once the bar is met".

---

## 0. Product north star (post-pivot)

A spoiler-free way to keep up with your favourite esports teams across major games — reminders for
upcoming and finished matches, plus a clean view of your teams' schedule and results. The thing that
makes it different from a generic results feed is that **it doesn't spoil you by default**.

The full version deepens three things the MVP keeps shallow:
1. **Reach & richness of the tracking surface** (a real dashboard, more games).
2. **Reliability at scale** (a caching proxy so growth doesn't hit API limits or expose the key).
3. **Monetisation** (a free tier that earns trust, an optional Pro tier later).

> Explicitly NOT returning to: page-level masking / multi-site content scripts (removed in the pivot).
> If a fundamentally better cross-platform spoiler approach is found, it would be evaluated as new
> scope, not assumed.

---

## 1. Target architecture (with backend, when justified)

```
┌──────────── Browser extension (Chrome / Edge / Firefox) ─────────────┐
│  Popup  │  Dashboard (new surface)  │  Options  │  Service Worker      │
└──────┬───────────────┬───────────────────┬───────────────┬───────────┘
       │ read/write     │                   │ prefs/follow   │ HTTPS (anon token)
       ▼                ▼                   ▼               ▼
  chrome.storage (cache + prefs + followedTeams + reveal + sent)
       │                                            ┌──────────────────────────┐
       │ Pro: cross-device sync ───────────────────►│  Caching proxy            │
       │                                            │  (Cloudflare Worker, free) │
       │                                            │  • single upstream fetch   │
       │                                            │  • normalise + cache (KV)  │
       │                                            │  • hides the API key       │
       │                                            └──────────┬────────────────┘
       │  ┌─────────────────┐                                  │ HTTPS
       │  │  ExtensionPay   │  (free/Pro)                      ▼
       │  └─────────────────┘                       ┌────────────────────┐
       │                                            │  PandaScore (free)  │
       │                                            │  + schedules/results│
       └────────────────────────────────────────── │  + teams search     │
                                                    └────────────────────┘
```

**Architectural shift from MVP**: the MVP calls PandaScore directly from the service worker (API key
in the client, fine at tiny scale). The full version routes through a **caching proxy** — one fetch
serves all users, the key stays server-side, and rate limits are absorbed. A Cloudflare Worker's free
tier typically still covers this at 5k+ users.

---

## 2. Feature modules (full version)

| Module | Full-version capability | Delta vs MVP |
|---|---|---|
| Games | More titles (Dota 2, Valorant, …) as their PandaScore structure is verified | MVP: 1–2 |
| Tracking surface | A **dashboard**: followed teams' matches grouped by status (upcoming/live/finished), then game, then tournament, then time | MVP: single popup list |
| Reminders | Rules: lead-time, quiet hours, per-team/per-competition toggles | MVP: global pre/post |
| Spoiler-free | Keep the default-on popup masking + spoiler-safe notifications; optionally a "catch-up" ordered watch queue | MVP: popup masking + safe wording |
| Reliability | Caching proxy (key hidden, rate limits absorbed, multi-source ready) | MVP: direct client calls |
| Sync | Pro: cross-device sync of follows + reveal state | MVP: chrome.storage.sync for prefs only |
| Platforms | Chrome + Edge + Firefox | MVP: Chrome |
| Localisation | EN / ZH | MVP: EN |
| Branding | Real icon + store assets | MVP: placeholder icon |
| Monetisation | ExtensionPay free/Pro | MVP: none |
| Observability | Privacy-friendly active/retention analytics | MVP: store stats |

> Note: the "dashboard with grouping" is the feature the user sketched during the MVP (a richer view
> than the popup). It lives here, gated behind MVP validation.

---

## 3. Monetisation (validate free first, Pro later)

- **Free tier earns trust and a user base.** The whole MVP stays free; the product proves retention
  before any paid infrastructure.
- **Pro tier (later, only after retention is proven)** via ExtensionPay — candidate Pro features:
  unlimited followed teams, cross-device sync, notification rules (quiet hours / per-team lead times),
  the dashboard, themes. Pricing kept low/one-time given a young, price-sensitive audience.
- **Payments tooling**: ExtensionPay (no backend needed for gating); a merchant-of-record option
  (e.g. Dodo Payments) if cross-border VAT/GST handling is wanted.
- **Cost discipline**: stay inside free tiers (Worker/KV, ExtensionPay, PandaScore free) as long as
  possible; the deep per-game PandaScore data is expensive and a tracker doesn't need it — don't buy it.

---

## 4. Phased roadmap (threshold-gated)

```
Phase 1 — MVP (shipped/validated): followed teams + desktop reminders + default-on popup spoiler
          masking. Gate to next phase: weekly-active / retention / store rating meet a set bar.

Phase 2 — Tracking surface: add the grouped dashboard; add a real icon; privacy-friendly analytics.

Phase 3 — Reliability & reach: caching proxy (hide key, absorb limits); add a 3rd/4th game.

Phase 4 — Monetisation: ExtensionPay free/Pro split; notification rules; cross-device sync (Pro).

Phase 5 — Breadth: Firefox/Edge; EN/ZH localisation; data-driven iteration.
```

Each phase is entered only when the analytics justify the investment — the operational form of
"validate free first".

---

## 5. Reliability & data strategy

- **Caching proxy (Phase 3)**: a Cloudflare Worker fetches from PandaScore on a schedule, normalises,
  caches in KV, and serves all clients. Fixes the MVP's two known limitations at once: the client-side
  API key and per-client rate limits.
- **Data source**: PandaScore free plan (schedules/results/teams search). Avoid the paid per-game deep
  data — expensive and unnecessary for a reminder/tracker.
- **Multi-game**: verify each new game's API structure (status/results/number_of_games shapes) before
  enabling it — the same "verify the external assumption first" discipline that caught the
  `results`-always-present trap.

---

## 6. Cost & "when do you actually pay"

- Phases 1–4 generally stay within free tiers (Worker, KV, GitHub Actions, ExtensionPay, PandaScore free).
- Costs appear only if Worker/KV exceed the free tier at high activity, or if cross-device sync uses a
  paid datastore. The expensive PandaScore deep-data tier is deliberately avoided.
- Principle: let free tiers + caching carry you as late as possible; when you pay, confirm it's driven
  by healthy active users, not inefficient design.

---

## Closing

✅ **This roadmap describes growth for the reminder/tracker product**: a richer dashboard, a caching
proxy for scale, more games and platforms, localisation, and an optional Pro tier — all gated behind
MVP validation, free-first.

📋 **Next steps**:
1. Ship and personally validate the MVP first; let real retention data trigger each phase.
2. The first post-validation build is the grouped dashboard (the user's own sketch) — a richer surface
   than the popup, still free.
3. Stand up the caching proxy before user growth strains the free API limits.

⚠️ **Known trade-offs & notes**:
- The extension's distinctiveness now rests on being **spoiler-free by default**, not on page-level
  masking — protect that default as features are added.
- PandaScore is billed per game; use only the free schedule/result/teams-search data.
- Introducing a backend (proxy/sync) brings a privacy-policy/data-handling responsibility — disclose honestly.
- Page-level spoiler protection is preserved in git history; revisit only if a genuinely better
  cross-platform approach is found, as new scope.
- Phase ordering is a guide; real priorities follow the MVP's retention and feedback data.
