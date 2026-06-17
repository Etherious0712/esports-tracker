import { useEffect, useState } from 'preact/hooks';
import { PandaScoreSource } from '../../core/datasource/PandaScoreSource';
import type { FollowConfig, GameId, Team } from '../../core/models';
import { DEFAULT_FOLLOW_CONFIG } from '../../core/models';
import { DEFAULT_SPOILER_PREFS } from '../../core/spoiler';
import {
  followTeam,
  getFollowConfig,
  getFollowedTeams,
  getSpoilerPrefs,
  setFollowConfig,
  setSpoilerPrefs,
  unfollowTeam,
} from '../../core/storage';

const MESSAGE_REFRESH = 'refresh';
const SEARCH_DEBOUNCE_MS = 300;

// Only games whose PandaScore structure has been verified (MVP scope).
const GAMES: ReadonlyArray<{ id: GameId; label: string }> = [
  { id: 'lol', label: 'League of Legends' },
  { id: 'csgo', label: 'Counter-Strike 2' },
  { id: 'dota2', label: 'Dota 2' },
];

type SearchState = 'idle' | 'loading' | 'done' | 'error';

/** Fire-and-forget refresh request; no-op if the service worker is unreachable. */
function requestRefresh(): void {
  chrome.runtime.sendMessage({ type: MESSAGE_REFRESH }).catch(() => undefined);
}

/** Default search: the options page is privileged, so it can call PandaScore directly. */
function defaultSearchTeams(game: GameId, query: string): Promise<Team[]> {
  return new PandaScoreSource(import.meta.env.WXT_PANDASCORE_TOKEN ?? '').searchTeams(game, query);
}

function dedupeById(teams: Team[]): Team[] {
  const byId = new Map<string, Team>();
  for (const team of teams) if (!byId.has(team.id)) byId.set(team.id, team);
  return [...byId.values()];
}

interface AppProps {
  /** Injectable for tests; defaults to a direct PandaScore search. */
  searchTeams?: (game: GameId, query: string) => Promise<Team[]>;
}

export function App({ searchTeams = defaultSearchTeams }: AppProps = {}) {
  const [follow, setFollow] = useState<FollowConfig>(DEFAULT_FOLLOW_CONFIG);
  const [spoilerEnabled, setSpoilerEnabled] = useState(DEFAULT_SPOILER_PREFS.enabled);
  const [hideRunning, setHideRunning] = useState(DEFAULT_SPOILER_PREFS.hideRunning);
  const [loaded, setLoaded] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Team[]>([]);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [followed, setFollowed] = useState<Team[]>([]);

  useEffect(() => {
    void (async () => {
      const [loadedFollow, prefs, teams] = await Promise.all([
        getFollowConfig(),
        getSpoilerPrefs(),
        getFollowedTeams(),
      ]);
      setFollow(loadedFollow);
      setSpoilerEnabled(prefs.enabled);
      setHideRunning(prefs.hideRunning);
      setFollowed(teams);
      setLoaded(true);
    })();
  }, []);

  // Debounced team search across the selected games.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '' || follow.games.length === 0) {
      setResults([]);
      setSearchState('idle');
      return;
    }
    let cancelled = false;
    setSearchState('loading');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const lists = await Promise.all(follow.games.map(game => searchTeams(game, trimmed)));
          if (cancelled) return;
          setResults(dedupeById(lists.flat()));
          setSearchState('done');
        } catch {
          if (cancelled) return;
          setResults([]);
          setSearchState('error');
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, follow.games, searchTeams]);

  async function handleGameToggle(game: GameId, checked: boolean): Promise<void> {
    const games = checked
      ? [...new Set([...follow.games, game])]
      : follow.games.filter(g => g !== game);
    const next: FollowConfig = { ...follow, games };
    setFollow(next);
    await setFollowConfig(next);
    requestRefresh();
  }

  // Persist the full SpoilerPrefs on every change so toggling one field never drops the other.
  async function handleSpoilerEnabledToggle(checked: boolean): Promise<void> {
    setSpoilerEnabled(checked);
    await setSpoilerPrefs({ enabled: checked, hideRunning });
  }

  async function handleHideRunningToggle(checked: boolean): Promise<void> {
    setHideRunning(checked);
    await setSpoilerPrefs({ enabled: spoilerEnabled, hideRunning: checked });
  }

  async function handleFollow(team: Team): Promise<void> {
    if (followed.some(t => t.id === team.id)) return;
    setFollowed([...followed, team]);
    await followTeam(team);
    requestRefresh();
  }

  async function handleRemove(teamId: string): Promise<void> {
    setFollowed(followed.filter(t => t.id !== teamId));
    await unfollowTeam(teamId);
    requestRefresh();
  }

  const isFollowed = (teamId: string): boolean => followed.some(t => t.id === teamId);

  return (
    <main class="options">
      <h1>
        EsportsTracker settings <span class="options__unofficial">(Unofficial)</span>
      </h1>

      <section class="options__section">
        <h2>Games to track</h2>
        {GAMES.map(({ id, label }) => (
          <label class="options__row" key={id}>
            <input
              type="checkbox"
              checked={follow.games.includes(id)}
              onChange={event =>
                void handleGameToggle(id, (event.currentTarget as HTMLInputElement).checked)
              }
            />
            {label}
          </label>
        ))}
        {loaded && follow.games.length === 0 && (
          <p class="options__hint">No games selected — the popup will be empty.</p>
        )}
      </section>

      <section class="options__section">
        <h2>Followed teams</h2>
        <p class="options__hint">
          Leave empty to track all matches of your games; add teams to narrow tracking and masking.
        </p>

        {follow.games.length === 0 ? (
          <p class="options__hint">Select a game first.</p>
        ) : (
          <>
            <input
              type="search"
              class="options__search"
              placeholder="Search teams…"
              value={query}
              onInput={event => setQuery((event.currentTarget as HTMLInputElement).value)}
            />
            {searchState === 'loading' && <p class="options__hint">Searching…</p>}
            {searchState === 'error' && (
              <p class="options__hint">Search failed — please try again.</p>
            )}
            {searchState === 'done' && results.length === 0 && (
              <p class="options__hint">No teams found.</p>
            )}
            <ul class="options__results">
              {results.map(team => (
                <li class="options__row" key={team.id}>
                  <span>
                    {team.name} ({team.acronym})
                  </span>
                  {isFollowed(team.id) ? (
                    <span class="options__hint">Followed</span>
                  ) : (
                    <button type="button" onClick={() => void handleFollow(team)}>
                      + Follow
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3>Followed</h3>
        {followed.length === 0 ? (
          <p class="options__hint">No teams followed — all matches of your games are tracked.</p>
        ) : (
          <ul class="options__followed">
            {followed.map(team => (
              <li class="options__row" key={team.id}>
                <span>
                  {team.name} ({team.acronym})
                </span>
                <button type="button" onClick={() => void handleRemove(team.id)}>
                  × Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="options__section">
        <h2>Spoiler protection</h2>
        <label class="options__row">
          <input
            type="checkbox"
            checked={spoilerEnabled}
            onChange={event =>
              void handleSpoilerEnabledToggle((event.currentTarget as HTMLInputElement).checked)
            }
          />
          Spoiler-free mode
        </label>
        <label class="options__row">
          <input
            type="checkbox"
            checked={hideRunning}
            disabled={!spoilerEnabled}
            onChange={event =>
              void handleHideRunningToggle((event.currentTarget as HTMLInputElement).checked)
            }
          />
          Guard in-progress matches too
        </label>
        <p class="options__hint">
          With spoiler-free mode on, finished matches are masked until you reveal them. Turn it off
          to always show scores in the popup and notifications.
        </p>
      </section>
    </main>
  );
}
