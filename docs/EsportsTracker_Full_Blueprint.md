# EsportsTracker — Full Version Blueprint (Roadmap)

> This is the target shape and evolution path after the MVP is validated. It is **not meant to be built all at once** — following the "validate free first, invest once the bar is met" philosophy, features are sliced into threshold-gated phases.
> Companion document: `EsportsTracker_MVP_Blueprint.md` (build this first).

---

## 0. Extra problems the full version solves

After the MVP validates "people want an in-browser spoiler-free tracker", the full version addresses three things the MVP deliberately avoided:

1. **Scale**: once users grow, direct client→API calls hit rate limits and expose the API key → need a **caching proxy**.
2. **Monetisation**: as a second income stream → need a **free/Pro split + payments**.
3. **Stickiness & coverage**: multi-game, multi-browser, cross-device sync, stronger spoiler protection → turn it from "usable" into "indispensable".

---

## 1. Target architecture overview (with backend)

```
┌──────────── Browser extension (Chrome / Edge / Firefox) ─────────────┐
│  Popup  │  New Tab board  │  Options  │  Service Worker (sched/notify)  │
└──────┬───────────┬────────────┬──────────────┬──────────────────────┘
       │ read/write │            │ prefs         │ HTTPS (with anon token)
       ▼            ▼            ▼              ▼
  chrome.storage.local/sync                ┌──────────────────────────┐
       │ (local cache + prefs)              │   Caching proxy           │
       │                                    │   (Cloudflare Worker,     │
       │ Pro cross-device sync ────────────►│    free tier)             │
       │                                    │  • single upstream fetch  │
       │                                    │  • normalise + cache (KV) │
       │                                    │  • hides all API keys     │
       │                                    │  • stale-while-revalidate │
       │                                    └──────────┬───────────────┘
       │                                               │ HTTPS
       ▼                                               ▼
  ┌─────────────────┐         ┌───────────────────────────────────────┐
  │  ExtensionPay   │         │  Upstream sources (multi-source, fail- │
  │ (free/Pro auth) │         │  over): PandaScore free · Liquipedia   │
  └─────────────────┘         │  API · (optional) Riot official data   │
                              └───────────────────────────────────────┘
```

**Key architectural shift**: the MVP is "direct client calls"; the full version routes all data through a **caching proxy** — it fetches from upstream every few minutes, normalises, and caches, and all users read from it. This one layer solves rate limits, API-key exposure, and multi-source aggregation at once, and a Cloudflare Worker's free tier is usually still free at 5k+ users.

---

## 2. Feature modules (full version)

| Module | Full-version capability | Delta vs MVP |
|---|---|---|
| Game coverage | LoL / CS2 / Dota2 / Valorant etc., several mainstream titles | MVP: 1–2 only |
| Data sources | multi-source + failover (one down → use another) | MVP: single direct source |
| Spoiler protection | score + bracket progression + bestOf + VOD-duration hints; per-competition settings; "catch-up mode" | MVP: score mask only |
| Notifications | rules engine: per-team/per-competition, lead time, quiet hours, spoiler-safe wording | MVP: global pre/post only |
| Views | full new-tab board + standings/brackets + calendar export (.ics) | MVP: popup list only |
| Sync | Pro: cross-device sync of prefs and "watched" state | MVP: chrome.storage.sync only |
| Platforms | Chrome + Edge + Firefox | MVP: Chrome only |
| Localisation | EN / ZH to start (you are bilingual) | MVP: single language |
| Monetisation | ExtensionPay free/Pro split | MVP: none |
| Observability | privacy-friendly active/retention analytics | MVP: store stats only |

---

## 3. Core component blueprints (new/upgraded in the full version)

### Blueprint: caching proxy (Cloudflare Worker)
```
Purpose:    Fetch from multiple upstreams, normalise, cache, and serve all clients; hide API keys; absorb rate limits.
Inputs:     GET /matches?games=lol,csgo&since=... (client sends an anon/Pro token)
Outputs:    normalised Match[] JSON; with Cache-Control / ETag
Components: routing; upstream adapters (PandaScore/Liquipedia/...); normalisation; KV cache read/write; auth middleware
Data flow:  client → Worker (KV hit?) → hit returns; miss/expired → fetch upstream → normalise → write KV → return
Edge cases: upstream rate-limit/outage → return stale cache + mark stale; multi-game → concurrent fetch + merge;
            KV write race → last-write-wins acceptable; abusive traffic → rate limit + token check
Test plan:  cache hit/miss paths; returns stale on upstream failure; multi-source merge correct; auth rejects token-less requests
```
> Why not in the MVP: the MVP's purpose is to validate demand, fastest with zero infra. But **this is the full version's foundation**, and the proper fix for getting the API key out of the client.

### Blueprint: Pro auth & monetisation (ExtensionPay)
```
Purpose:    Distinguish free/Pro, unlock advanced features; serve as a second income stream.
Inputs:     the user's ExtensionPay login state
Outputs:    isPro: boolean → gates features and proxy-side quota
Components: extpay client wrapper; featureGate(feature, isPro); proxy-side validation
Data flow:  extension start → extpay.getUser() → cache isPro → UI & proxy open/limit accordingly
Edge cases: offline → use last cached Pro state (grace period); refund/expiry → degrade gracefully to free;
            free-tier boundary (e.g. follow cap) → clear prompt, not silent failure
Test plan:  free user correctly limited; Pro unlocks; offline grace; expiry degrades without losing user data
```
**Tiering suggestion** (price per earlier research; esports audience skews young and price-sensitive, so favour low price or one-time):
- Free: follow cap (e.g. 3 teams), basic pre/post reminders, single device.
- Pro: unlimited follows, cross-device sync, notification rules engine, calendar export, themes, bracket spoiler protection.

### Blueprint: notification rules engine
```
Purpose:    Let users finely control when, why, and what kind of notification they get.
Inputs:     rule set (per-team/competition, lead time, quiet hours, spoiler-safe wording), Match[]
Outputs:    notifications to fire (filtered by rules, deduped, spoiler-safe)
Components: RuleSet model; evaluate(rules, matches, now, sent); buildMessage()
Data flow:  SW alarm → fetch cache → evaluate(rules) → filter sent → fire → record
Edge cases: pre-match alert during quiet hours → defer or suppress (per rule); rule conflicts → clear precedence;
            MV3 SW sleep → still judge by time window
Test plan:  each rule alone/combined; quiet-hours suppression correct; spoiler-safe wording; idempotent dedup
```

### Blueprint: cross-device sync (Pro)
```
Purpose:    Keep a Pro user's follow list and "watched" state consistent across devices/browsers.
Inputs:     user id (from ExtensionPay), local prefs and watched state
Outputs:    merged prefs/state (cloud authoritative + most recent local change)
Components: sync endpoint (Worker + KV/D1); conflict-merge strategy; local change queue
Data flow:  local change → enqueue → push when online → pull remote → merge → write back local
Edge cases: offline edits → queue; conflict → later timestamp wins ("watched" takes the union, safer);
            free users → not enabled, chrome.storage.sync only
Test plan:  two-device merge; sync after reconnect; "watched" union doesn't regress; free users don't trigger it
```

---

## 4. Full-version spoiler protection (upgrade focus)

This is the product moat; the full version makes it airtight:
- **Score masking** (already in MVP).
- **Bracket / progression**: unwatched rounds don't reveal who advanced.
- **Weak signals**: when guarding, hide/de-emphasise `bestOf`, match duration, "deciding game" hints.
- **Granular settings**: turn off spoiler protection for a specific competition (one you don't mind being spoiled).
- **Catch-up mode**: one click into a "chronological, fully guarded" watch queue; reveal one as you watch one.
- **Page-level spoiler protection** started in the MVP (a few sites + text matching); the full version expands site coverage, improves match accuracy, and ensures the mask doesn't conflict or lag the page. Permissions remain a **per-site whitelist; never `<all_urls>`**.

---

## 5. Multi-source data strategy

| Source | Role | Note |
|---|---|---|
| PandaScore free plan | Primary: schedules/results | Note it is **billed per game**; deep data/odds are expensive — use only the free schedule/result part |
| Liquipedia API | Supplementary: events/teams/brackets | **Must respect attribution and rate limits**; community data, use politely |
| Riot official esports data (optional) | LoL-specific enhancement | Only if there's a genuinely available official route |

The proxy normalises multiple sources into the same `Match` model and does **failover**: when the primary fails, switch to a supplementary source — slightly stale data beats a blank screen.

---

## 6. Cross-browser

- WXT produces Chrome / Edge / Firefox builds from one codebase.
- **Firefox is worth doing**: it's growing fast and retains more permissive extension capabilities; as a second landing spot it reduces single-platform (Google) policy risk.
- Note each store's review and privacy-disclosure requirements differ slightly.

---

## 7. Observability (the basis for investment decisions)

Use a **privacy-friendly** approach (e.g. self-hosted Plausible, or minimal anonymous events) to collect only what's needed to decide:
- install → finished-onboarding conversion (the onboarding funnel).
- **WAU / DAU, retention curve** (the real signal for whether to keep investing, not install count).
- spoiler feature usage rate, Pro conversion rate.
- store rating trend (directly affects search ranking).

Disclose analytics honestly in the privacy policy, and give users an opt-out where possible.

---

## 8. Testing & CI (full version)

- **Unit/integration**: Vitest, covering proxy normalisation, rules engine, sync merge, spoiler state machine.
- **E2E**: Playwright (you already have the playwright skill) for popup/options key flows and pre-submission regression.
- **CI/CD**: GitHub Actions → lint + test + build → produce three-store packages → semi-automated submission.
- **Contract testing**: contract-test upstream APIs with recorded samples so upstream field changes are caught early.

---

## 9. Phased roadmap (threshold-gated, echoing the "invest only at 5k" philosophy)

```
Phase 1 — MVP (see MVP blueprint)         Gate to next phase: weekly-active/retention/rating meet the bar
   single game · direct client calls · score spoiler mask · local storage

Phase 2 — Foundation hardening (once users grow)
   introduce the caching proxy (fix key exposure + rate limits) · add 2nd–3rd game · privacy-friendly analytics

Phase 3 — Monetisation (after retention is proven)
   ExtensionPay free/Pro split · notification rules engine · new-tab board

Phase 4 — Stickiness & coverage
   cross-device sync (Pro) · full spoiler protection (brackets/catch-up) · Firefox/Edge · EN/ZH localisation

Phase 5 — Optimisation & scale
   multi-source failover · performance/cost tuning · data-driven feature iteration
```

Before crossing each phase, revisit the analytics to confirm it's worth investing — this is how the "meet the bar before upgrading tools/investing" strategy is operationalised.

---

## 10. Cost & "when do you actually pay"

- Phases 1–3 generally stay within free tiers (Worker, KV, GitHub Actions, ExtensionPay, PandaScore free plan).
- **Where cost can actually appear**: Worker/KV exceeding the free tier (at high activity); enabling cloud sync on a paid D1/external-DB tier; ever wanting PandaScore's deep data (**billed per game, expensive**, and a tracker usually doesn't need it — don't reach for it lightly).
- Principle: **let free tiers + caching design carry you as late as possible**; when you do pay, first confirm it's driven by healthy active users, not by an inefficient design.

---

## Closing

✅ **This blueprint delivers**: the full version's target architecture (with caching proxy), feature module list, blueprints for 4 new/upgraded components (proxy / monetisation / rules engine / sync), multi-source strategy, cross-browser, observability, testing & CI, and a **threshold-gated phased roadmap**.

📋 **Suggested next steps**:
1. Build and ship the MVP first — every full-version step should be triggered by real data from the MVP; don't lay foundations early.
2. Once the bar is met, the first thing is to stand up the caching proxy (fixing key exposure and rate limits together).
3. When needed, I can drill into any single module: e.g. a Worker code skeleton for the proxy, ExtensionPay integration, or the state design for bracket spoiler protection.

⚠️ **Known limitations & assumptions**:
- Once the full version introduces a backend (proxy/sync), you take on a **privacy policy and data-handling responsibility** (even with minimal data); disclose honestly.
- PandaScore is billed per game — for multiple games use only its **free schedule/result** part; don't reach for the paid deep-data tier lightly.
- Community sources like Liquipedia **must respect attribution and rate limits**; use politely or risk being blocked.
- Throughout, hold to **minimal permissions (per-site whitelist, never `<all_urls>`) + content scripts only read the DOM to mask + "Unofficial" labelling + no official logos** — the baseline for trust and compliance.
- The phase ordering is a suggestion; real priorities should be set by the MVP's retention and feedback data.
