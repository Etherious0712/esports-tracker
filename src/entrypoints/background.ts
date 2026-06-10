import { defineBackground } from 'wxt/utils/define-background';
import { PandaScoreSource } from '../core/datasource/PandaScoreSource';
import { getFollowConfig, setCachedMatches } from '../core/storage';
import { refreshMatches, type RefreshDeps } from '../background';

const REFRESH_ALARM_NAME = 'refreshMatches';
const REFRESH_PERIOD_MINUTES = 10;
// Popup asks the service worker to freshen data when it opens.
const MESSAGE_REFRESH = 'refresh';

/**
 * Reads the PandaScore token from the build-time env. WXT (via Vite) only exposes
 * variables prefixed with WXT_. Never logged — only passed to the data source.
 */
function readToken(): string {
  return import.meta.env.WXT_PANDASCORE_TOKEN ?? '';
}

function buildRefreshDeps(): RefreshDeps {
  const source = new PandaScoreSource(readToken());
  return {
    loadFollowConfig: getFollowConfig,
    fetchMatches: follow => source.fetchMatches(follow),
    saveCachedMatches: setCachedMatches,
  };
}

async function runRefresh(): Promise<void> {
  if (readToken().length === 0) {
    console.error('[background] WXT_PANDASCORE_TOKEN is not set; skipping refresh');
    return;
  }
  await refreshMatches(buildRefreshDeps());
}

export default defineBackground(() => {
  // Periodic refresh. MV3 service workers sleep, so we drive polling via an alarm
  // and reason in time windows rather than assuming the worker stays alive.
  chrome.alarms.create(REFRESH_ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === REFRESH_ALARM_NAME) {
      void runRefresh();
    }
  });

  // Refresh once when the extension is installed/updated and when the browser starts.
  chrome.runtime.onInstalled.addListener(() => void runRefresh());
  chrome.runtime.onStartup.addListener(() => void runRefresh());

  // Refresh when the popup opens so data freshens while the user is viewing it.
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === MESSAGE_REFRESH) {
      void runRefresh();
    }
  });
});
