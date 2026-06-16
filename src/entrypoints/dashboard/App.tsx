import { useEffect, useState } from 'preact/hooks';
import { groupMatchesForDashboard, type DashboardView } from '../../core/dashboard';
import type { SpoilerPrefs } from '../../core/spoiler';
import { DEFAULT_SPOILER_PREFS, getRevealedSet, reveal } from '../../core/spoiler';
import { getCachedMatches, getCacheTimestamp, getSpoilerPrefs } from '../../core/storage';
import { formatLocalDateTime } from '../../core/time';
import { DashboardNav } from './components/DashboardNav';
import { StatusSection } from './components/StatusSection';

const MESSAGE_REFRESH = 'refresh';
const OPTIONS_PAGE = '/options.html';

type LoadState = 'loading' | 'ready';

/** 'main' = Live & Results (Live + Finished); 'upcoming' = the Upcoming list. */
export type DashboardTab = 'main' | 'upcoming';

export function App() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [view, setView] = useState<DashboardView>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [prefs, setPrefs] = useState<SpoilerPrefs>(DEFAULT_SPOILER_PREFS);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [tab, setTab] = useState<DashboardTab>('main');

  useEffect(() => {
    void loadFromCache();
    // Freshen the cache in the background, like the popup does. The dashboard
    // itself only ever reads from cache.
    chrome.runtime.sendMessage({ type: MESSAGE_REFRESH }).catch(() => undefined);
  }, []);

  async function loadFromCache(): Promise<void> {
    const [cached, spoilerPrefs, revealedSet, timestamp] = await Promise.all([
      getCachedMatches(),
      getSpoilerPrefs(),
      getRevealedSet(),
      getCacheTimestamp(),
    ]);
    setView(groupMatchesForDashboard(cached));
    setPrefs(spoilerPrefs);
    setRevealed(revealedSet);
    setLastUpdated(timestamp);
    setLoadState('ready');
  }

  async function handleReveal(matchId: string): Promise<void> {
    await reveal(matchId);
    setRevealed(previous => new Set(previous).add(matchId));
  }

  const settingsUrl = chrome.runtime.getURL(OPTIONS_PAGE);

  // Which existing sections appear in which view — derived only, no grouping change.
  const liveSection = view.find(section => section.status === 'running');
  const finishedSection = view.find(section => section.status === 'finished');
  const upcomingSection = view.find(section => section.status === 'notStarted');

  const renderSection = (section: DashboardView[number]) => (
    <StatusSection
      key={section.status}
      section={section}
      revealed={revealed}
      prefs={prefs}
      onReveal={handleReveal}
    />
  );

  let content;
  if (tab === 'main') {
    content =
      liveSection === undefined && finishedSection === undefined ? (
        <p class="dash__empty-line">No live or finished matches right now.</p>
      ) : (
        <>
          {liveSection !== undefined && renderSection(liveSection)}
          {finishedSection !== undefined && renderSection(finishedSection)}
        </>
      );
  } else {
    content =
      upcomingSection !== undefined ? (
        renderSection(upcomingSection)
      ) : (
        <p class="dash__empty-line">No upcoming matches.</p>
      );
  }

  return (
    <main class="dash">
      <header class="dash__header">
        <h1 class="dash__title">
          EsportsTracker <span class="dash__unofficial">(Unofficial)</span>
        </h1>
        {lastUpdated !== null && (
          <p class="dash__updated">Last updated {formatLocalDateTime(lastUpdated)}</p>
        )}
        <a class="dash__settings" href={settingsUrl} target="_blank" rel="noreferrer">
          ⚙ Settings
        </a>
      </header>

      {loadState === 'loading' ? (
        <p class="dash__loading">Loading matches…</p>
      ) : view.length === 0 ? (
        <div class="dash__empty">
          <p>Pick games in settings to start tracking.</p>
          <a href={settingsUrl} target="_blank" rel="noreferrer">
            Open settings
          </a>
        </div>
      ) : (
        <div class="dash__body">
          <DashboardNav tab={tab} onSelect={setTab} />
          <div class="dash__content">{content}</div>
        </div>
      )}
    </main>
  );
}
