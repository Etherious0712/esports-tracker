# EsportsTracker — Dashboard Two-View Update Spec

> A UI refactor of the existing dashboard: split the single stacked page into two in-page views with a
> left navigation sidebar. **Pure layout/navigation change** — the grouping logic (`core/dashboard.ts`),
> SpoilerGuard reuse, reveal store, and data loading are NOT changed. British English throughout.

---

## 1. Decisions (locked)

- **Two views, switched in-page** (NOT new tabs) via a **left navigation sidebar**:
  - **"Live & Results"** (the default/home view): the **Live** section on top, the **Finished**
    section below it.
  - **"Upcoming"**: the **Upcoming** section only.
- **Default view on open**: "Live & Results" (the home view).
- Clicking a sidebar item swaps the rendered content within the same page (Preact state), no navigation.
- Everything else stays: same grouping tree, same per-section game→tournament→time structure, same
  SpoilerGuard/reveal/spoiler-prefs reuse, same data loading from cache + background refresh ping.

> Rationale (from real use): Live + Finished are "what's happening / just happened" — the thing you
> open to see. Upcoming is a long planning list, better on its own page.

---

## 2. What changes (only `entrypoints/dashboard/App.tsx` + a small sidebar component + CSS)

The grouping already returns sections keyed by status (`'running'` = Live, `'notStarted'` = Upcoming,
`'finished'` = Finished). The change is purely **which sections render in which view**.

### 2.1 View state
- Add `type DashboardTab = 'main' | 'upcoming'` and `const [tab, setTab] = useState<DashboardTab>('main')`.
- Derive sections from the existing `view: DashboardView` by status (no change to grouping):
  - `liveSection`    = view.find(s => s.status === 'running')
  - `finishedSection`= view.find(s => s.status === 'finished')
  - `upcomingSection`= view.find(s => s.status === 'notStarted')
- **main tab** renders `liveSection` then `finishedSection` (each only if present).
- **upcoming tab** renders `upcomingSection` (if present).

### 2.2 Layout
- Introduce a two-column layout: a **left sidebar** + a **content area** (e.g. `dash__body` flex row;
  `dash__nav` fixed-ish width column; `dash__content` flex-1). Keep the existing header on top.
- **Sidebar** (`DashboardNav` component): two items — "Live & Results" and "Upcoming" — each a button
  that calls `setTab`. Mark the active one (e.g. `aria-current` + an `--active` class). Keep it simple;
  no icons required (can add a count later — out of scope here).

### 2.3 Empty states (per view)
- If `loadState === 'loading'` → existing loading text.
- If the whole `view` is empty (no games/matches at all) → existing empty state with the Settings link
  (unchanged).
- If the *current tab* has no section (e.g. main view but nothing live or finished; or upcoming view
  with nothing upcoming) → show a small per-view empty line, e.g. "No live or finished matches right
  now." / "No upcoming matches." (The page-level empty state still covers the "no data at all" case.)

### 2.4 Reuse / do not change
- `StatusSection` component, its children, and `core/dashboard.ts` are unchanged — `main` simply renders
  two existing `StatusSection`s, `upcoming` renders one.
- `getSpoilerDecision` / `SpoilerGuard` / `reveal` / prefs loading — unchanged.
- The "Expand full view" popup button and the dashboard entrypoint wiring — unchanged.

---

## 3. Tests

Adjust the existing dashboard render tests and add a few:
| Scenario | Expectation |
|---|---|
| default tab is main | on load, Live and/or Finished render; Upcoming section NOT in the DOM |
| switch to upcoming | clicking the "Upcoming" nav renders the upcoming section; Live/Finished gone |
| main with only finished | renders Finished, no Live; Upcoming still absent |
| upcoming empty | upcoming tab with no upcoming matches shows the per-view empty line |
| whole view empty | page-level empty state with Settings link (unchanged) |
| spoiler still reused | a finished match in the main view shows the SpoilerGuard placeholder; reveal works |

Keep the pure `core/dashboard.ts` tests as-is (logic unchanged).

---

## 4. Manual verification

1. Build, load, open the dashboard from the popup.
2. It opens on **Live & Results**: Live on top, Finished below (only the non-empty ones).
3. The left sidebar shows "Live & Results" (active) and "Upcoming".
4. Click **Upcoming** → content swaps in-place to the upcoming list; no new tab; sidebar highlight moves.
5. Click back → returns to Live & Results.
6. Spoiler masking still works in both views (finished masked unless revealed / unless spoiler-free off).
7. Resize / narrow window → sidebar + content still usable (basic responsiveness; polish later if needed).

---

## Closing

✅ **This update delivers**: a two-view dashboard (Live & Results | Upcoming) with a left sidebar that
switches content in-page, defaulting to Live & Results — built entirely by re-arranging which existing
`StatusSection`s render, with no change to grouping, spoiler logic, or data flow.

📋 **Next steps**:
1. Put this spec in `docs/`.
2. Claude Code: add the tab state + `DashboardNav` sidebar + two-column layout in `App.tsx`, per-view
   empty lines, and CSS; update the render tests. No commit.
3. You verify §4 in the browser.

⚠️ **Watch**:
- Do NOT change `core/dashboard.ts` or `StatusSection` — only choose which sections render per tab.
- Default tab is 'main' (Live & Results).
- Keep the page-level "no data at all" empty state; add per-view empty lines separately.
- Spoiler reuse must remain intact (don't refactor SpoilerGuard out while moving things).
