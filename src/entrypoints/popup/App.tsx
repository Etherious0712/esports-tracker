import { useEffect, useState } from 'preact/hooks';
import type { Match } from '../../core/models';
import type { SpoilerPrefs } from '../../core/spoiler';
import { DEFAULT_SPOILER_PREFS, getRevealedSet, reveal } from '../../core/spoiler';
import {
  getCachedMatches,
  getCacheTimestamp,
  getFollowConfig,
  getSpoilerPrefs,
} from '../../core/storage';
import { formatLocalDateTime } from '../../core/time';
import { MatchList } from './components/MatchList';

const MESSAGE_REFRESH = 'refresh';
const OPTIONS_PAGE = '/options.html';
const DASHBOARD_PAGE = '/dashboard.html';

type LoadState = 'loading' | 'ready';

export function App() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [matches, setMatches] = useState<Match[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [prefs, setPrefs] = useState<SpoilerPrefs>(DEFAULT_SPOILER_PREFS);
  const [hasGames, setHasGames] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    void loadFromCache();
    // Ask the service worker to freshen the cache while the popup is open.
    chrome.runtime.sendMessage({ type: MESSAGE_REFRESH }).catch(() => undefined);
  }, []);

  async function loadFromCache(): Promise<void> {
    const [cached, spoilerPrefs, revealedSet, timestamp, follow] = await Promise.all([
      getCachedMatches(),
      getSpoilerPrefs(),
      getRevealedSet(),
      getCacheTimestamp(),
      getFollowConfig(),
    ]);
    // Reverse-chronological: newest kickoff first.
    setMatches([...cached].sort((a, b) => b.beginAtUtc.localeCompare(a.beginAtUtc)));
    setPrefs(spoilerPrefs);
    setRevealed(revealedSet);
    setLastUpdated(timestamp);
    setHasGames(follow.games.length > 0);
    setLoadState('ready');
  }

  async function handleReveal(matchId: string): Promise<void> {
    await reveal(matchId);
    setRevealed(previous => new Set(previous).add(matchId));
  }

  const settingsUrl = chrome.runtime.getURL(OPTIONS_PAGE);
  const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PAGE);

  return (
    <main class="popup">
      <header class="popup__header">
        <h1 class="popup__title">
          EsportsTracker <span class="popup__unofficial">(Unofficial)</span>
        </h1>
        {lastUpdated !== null && (
          <p class="popup__updated">Last updated {formatLocalDateTime(lastUpdated)}</p>
        )}
        <a class="popup__dashboard" href={dashboardUrl} target="_blank" rel="noreferrer">
          ⤢ Expand full view
        </a>
        <a class="popup__settings" href={settingsUrl} target="_blank" rel="noreferrer">
          ⚙ Settings
        </a>
      </header>
      <Body
        hasGames={hasGames}
        loadState={loadState}
        matches={matches}
        revealed={revealed}
        prefs={prefs}
        onReveal={handleReveal}
        settingsUrl={settingsUrl}
      />
    </main>
  );
}

interface BodyProps {
  hasGames: boolean;
  loadState: LoadState;
  matches: Match[];
  revealed: Set<string>;
  prefs: SpoilerPrefs;
  onReveal: (matchId: string) => void;
  settingsUrl: string;
}

function Body({ hasGames, loadState, matches, revealed, prefs, onReveal, settingsUrl }: BodyProps) {
  if (!hasGames) {
    return (
      <div class="popup__empty">
        <p>Pick games in settings to start tracking.</p>
        <a href={settingsUrl} target="_blank" rel="noreferrer">
          Open settings
        </a>
      </div>
    );
  }
  if (loadState === 'loading') {
    return <p class="popup__loading">Loading matches…</p>;
  }
  if (matches.length === 0) {
    return <p class="popup__loading">No matches cached yet — fetching…</p>;
  }
  return <MatchList matches={matches} revealed={revealed} prefs={prefs} onReveal={onReveal} />;
}
