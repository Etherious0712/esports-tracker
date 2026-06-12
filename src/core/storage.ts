import type { FollowConfig, Match, NotificationPrefs, Team } from './models';
import { DEFAULT_FOLLOW_CONFIG, DEFAULT_NOTIFICATION_PREFS } from './models';
import type { SpoilerPrefs } from './spoiler';
import { DEFAULT_SPOILER_PREFS } from './spoiler';

// Re-exported so existing importers of these from './storage' keep working.
export { localArea, syncArea, type StorageArea } from './storage-area';

// Storage keys — kept as constants so key names are never duplicated.
const KEY_FOLLOW_CONFIG = 'followConfig';
const KEY_NOTIFICATION_PREFS = 'notificationPrefs';
const KEY_SPOILER_PREFS = 'spoilerPrefs';
const KEY_FOLLOWED_TEAMS = 'followedTeams';
const KEY_CACHED_MATCHES = 'cachedMatches';
const KEY_CACHE_TIMESTAMP = 'cacheTimestamp';

// ── chrome.storage.sync (preferences — synced across devices in a future version) ──

export async function getFollowConfig(): Promise<FollowConfig> {
  const result = await chrome.storage.sync.get(KEY_FOLLOW_CONFIG);
  return (result[KEY_FOLLOW_CONFIG] as FollowConfig | undefined) ?? DEFAULT_FOLLOW_CONFIG;
}

export async function setFollowConfig(config: FollowConfig): Promise<void> {
  await chrome.storage.sync.set({ [KEY_FOLLOW_CONFIG]: config });
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const result = await chrome.storage.sync.get(KEY_NOTIFICATION_PREFS);
  return (
    (result[KEY_NOTIFICATION_PREFS] as NotificationPrefs | undefined) ??
    DEFAULT_NOTIFICATION_PREFS
  );
}

export async function setNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  await chrome.storage.sync.set({ [KEY_NOTIFICATION_PREFS]: prefs });
}

export async function getSpoilerPrefs(): Promise<SpoilerPrefs> {
  const result = await chrome.storage.sync.get(KEY_SPOILER_PREFS);
  return (result[KEY_SPOILER_PREFS] as SpoilerPrefs | undefined) ?? DEFAULT_SPOILER_PREFS;
}

export async function setSpoilerPrefs(prefs: SpoilerPrefs): Promise<void> {
  await chrome.storage.sync.set({ [KEY_SPOILER_PREFS]: prefs });
}

// ── Followed teams ──
// Stored as small {id,name,acronym} objects so the settings page can render names
// without a lookup. FollowConfig.teamIds stays the source of truth the data layer
// reads — followTeam/unfollowTeam keep the two in sync.

export async function getFollowedTeams(): Promise<Team[]> {
  const result = await chrome.storage.sync.get(KEY_FOLLOWED_TEAMS);
  return (result[KEY_FOLLOWED_TEAMS] as Team[] | undefined) ?? [];
}

export async function setFollowedTeams(teams: Team[]): Promise<void> {
  await chrome.storage.sync.set({ [KEY_FOLLOWED_TEAMS]: teams });
}

/** Rebuilds FollowConfig.teamIds from the followed-teams list (deduped by id). */
async function syncTeamIds(teams: Team[]): Promise<void> {
  const follow = await getFollowConfig();
  await setFollowConfig({ ...follow, teamIds: [...new Set(teams.map(team => team.id))] });
}

/** Follows a team — updates followedTeams and FollowConfig.teamIds. No-op if already followed. */
export async function followTeam(team: Team): Promise<void> {
  const current = await getFollowedTeams();
  if (current.some(t => t.id === team.id)) return;
  const next = [...current, { id: team.id, name: team.name, acronym: team.acronym }];
  await setFollowedTeams(next);
  await syncTeamIds(next);
}

/** Unfollows a team — removes it from followedTeams and FollowConfig.teamIds. */
export async function unfollowTeam(teamId: string): Promise<void> {
  const next = (await getFollowedTeams()).filter(t => t.id !== teamId);
  await setFollowedTeams(next);
  await syncTeamIds(next);
}

// ── chrome.storage.local (cache — not synced; can be large) ──

export async function getCachedMatches(): Promise<Match[]> {
  const result = await chrome.storage.local.get(KEY_CACHED_MATCHES);
  return (result[KEY_CACHED_MATCHES] as Match[] | undefined) ?? [];
}

export async function setCachedMatches(matches: Match[]): Promise<void> {
  await chrome.storage.local.set({
    [KEY_CACHED_MATCHES]: matches,
    [KEY_CACHE_TIMESTAMP]: new Date().toISOString(),
  });
}

/** Returns the UTC ISO 8601 timestamp of the last successful cache write, or null. */
export async function getCacheTimestamp(): Promise<string | null> {
  const result = await chrome.storage.local.get(KEY_CACHE_TIMESTAMP);
  return (result[KEY_CACHE_TIMESTAMP] as string | undefined) ?? null;
}
