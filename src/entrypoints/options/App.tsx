import { useEffect, useState } from 'preact/hooks';
import type { FollowConfig, GameId } from '../../core/models';
import { DEFAULT_FOLLOW_CONFIG } from '../../core/models';
import { DEFAULT_SPOILER_PREFS } from '../../core/spoiler';
import {
  getFollowConfig,
  getSpoilerPrefs,
  setFollowConfig,
  setSpoilerPrefs,
} from '../../core/storage';

const MESSAGE_REFRESH = 'refresh';

// Only games whose PandaScore structure has been verified (MVP scope).
const GAMES: ReadonlyArray<{ id: GameId; label: string }> = [
  { id: 'lol', label: 'League of Legends' },
  { id: 'csgo', label: 'Counter-Strike 2' },
];

/** Fire-and-forget refresh request; no-op if the service worker is unreachable. */
function requestRefresh(): void {
  chrome.runtime.sendMessage({ type: MESSAGE_REFRESH }).catch(() => undefined);
}

export function App() {
  const [follow, setFollow] = useState<FollowConfig>(DEFAULT_FOLLOW_CONFIG);
  const [hideRunning, setHideRunning] = useState(DEFAULT_SPOILER_PREFS.hideRunning);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const [loadedFollow, prefs] = await Promise.all([getFollowConfig(), getSpoilerPrefs()]);
      setFollow(loadedFollow);
      setHideRunning(prefs.hideRunning);
      setLoaded(true);
    })();
  }, []);

  // Preserve teamIds/competitionIds (not editable in this slice) when changing games.
  async function handleGameToggle(game: GameId, checked: boolean): Promise<void> {
    const games = checked
      ? [...new Set([...follow.games, game])]
      : follow.games.filter(g => g !== game);
    const next: FollowConfig = { ...follow, games };
    setFollow(next);
    await setFollowConfig(next);
    // Refresh so the cache matches the new selection.
    requestRefresh();
  }

  async function handleHideRunningToggle(checked: boolean): Promise<void> {
    setHideRunning(checked);
    await setSpoilerPrefs({ hideRunning: checked });
  }

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
        <h2>Spoiler protection</h2>
        <label class="options__row">
          <input
            type="checkbox"
            checked={hideRunning}
            onChange={event =>
              void handleHideRunningToggle((event.currentTarget as HTMLInputElement).checked)
            }
          />
          Guard in-progress matches too
        </label>
        <p class="options__hint">Finished matches are always guarded by default.</p>
      </section>
    </main>
  );
}
