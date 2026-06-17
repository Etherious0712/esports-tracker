import { defineBackground } from 'wxt/utils/define-background';
import { PandaScoreSource } from '../core/datasource/PandaScoreSource';
import { computeNotifications, gateNotificationPrefs, pruneSentKeys } from '../core/notifier';
import {
  getCachedMatches,
  getFollowConfig,
  getNotificationPrefs,
  getSpoilerPrefs,
  setCachedMatches,
} from '../core/storage';
import { nowUtcIso } from '../core/time';
import { refreshMatches, type RefreshDeps } from '../background';
import { getSentSet, saveSentSet } from '../background/sentStore';

const REFRESH_ALARM_NAME = 'refreshMatches';
const REFRESH_PERIOD_MINUTES = 10;
// Popup/options ask the service worker to freshen data when they open/change.
const MESSAGE_REFRESH = 'refresh';
const NOTIFICATION_ICON = 'notification-icon.png';

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

/**
 * Computes and fires due notifications, then persists the updated, pruned sent-set.
 * Runs on the cached matches, so it works even when a refresh was skipped (e.g. no
 * token) as long as there is cached data.
 */
async function runNotifications(): Promise<void> {
  const [matches, notif, spoiler] = await Promise.all([
    getCachedMatches(),
    getNotificationPrefs(),
    getSpoilerPrefs(),
  ]);
  const sent = await getSentSet();

  // Fire-time read of the spoiler master switch so a mid-session toggle takes
  // effect immediately: off → END notifications show the score.
  const effective = gateNotificationPrefs(notif, spoiler.enabled);
  const plan = computeNotifications(matches, effective, nowUtcIso(), sent);

  for (const pending of plan.toFire) {
    chrome.notifications.create(pending.key, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL(`/${NOTIFICATION_ICON}`),
      title: pending.title,
      message: pending.message,
    });
    sent.add(pending.key);
  }
  for (const key of plan.toMarkSent) {
    sent.add(key);
  }

  // Prune against the current cache so the sent-set cannot grow without bound.
  await saveSentSet(pruneSentKeys(sent, matches));
}

async function tick(): Promise<void> {
  await runRefresh();
  await runNotifications();
}

export default defineBackground(() => {
  // Periodic work. MV3 service workers sleep, so we drive polling via an alarm and
  // reason in time windows rather than assuming the worker stays alive.
  chrome.alarms.create(REFRESH_ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === REFRESH_ALARM_NAME) {
      void tick();
    }
  });

  // Run once when installed/updated and when the browser starts.
  chrome.runtime.onInstalled.addListener(() => void tick());
  chrome.runtime.onStartup.addListener(() => void tick());

  // Run when the popup/options request a refresh.
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === MESSAGE_REFRESH) {
      void tick();
    }
  });

  // Optional, simple: clicking a notification opens the match's official stream.
  chrome.notifications.onClicked.addListener(notificationId => {
    void openStreamForNotification(notificationId);
  });
});

async function openStreamForNotification(notificationId: string): Promise<void> {
  const matchId = notificationId.slice(0, notificationId.lastIndexOf(':'));
  const matches = await getCachedMatches();
  const match = matches.find(m => m.id === matchId);
  if (match?.officialStreamUrl) {
    await chrome.tabs.create({ url: match.officialStreamUrl });
  }
  chrome.notifications.clear(notificationId);
}
