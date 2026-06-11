import { defineContentScript } from 'wxt/utils/define-content-script';
import { buildAliasIndex } from '../core/matcher';
import type { Match, Team } from '../core/models';
import { getRevealedSet, reveal } from '../core/spoiler';
import { getCachedMatches } from '../core/storage';
import { injectStyles, processRoot, type MaskContext } from '../content/liquipedia';

const OBSERVER_DEBOUNCE_MS = 200;

/** Unique teams across the cached matches — the interim followed-team source (spec §5). */
function collectTeams(matches: Match[]): Team[] {
  const byId = new Map<string, Team>();
  for (const match of matches) {
    byId.set(match.teamA.id, match.teamA);
    byId.set(match.teamB.id, match.teamB);
  }
  return [...byId.values()];
}

function debounce(fn: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(fn, delayMs);
  };
}

export default defineContentScript({
  matches: ['*://liquipedia.net/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const teams = collectTeams(await getCachedMatches());
    // No tracked teams yet → nothing is "followed" → do nothing (conservative).
    if (teams.length === 0) return;

    const maskCtx: MaskContext = {
      index: buildAliasIndex(teams),
      revealed: await getRevealedSet(),
      onReveal: (key: string) => {
        // Keep the local set in step so a later rescan doesn't re-mask the row.
        maskCtx.revealed.add(key);
        void reveal(key);
      },
    };

    injectStyles(document);
    processRoot(document, maskCtx);

    // Liquipedia can insert rows after load (collapsibles, navigation). Re-scan on
    // mutations; debounced to avoid thrashing, idempotent via the data-et-masked marker.
    const rescan = debounce(() => processRoot(document, maskCtx), OBSERVER_DEBOUNCE_MS);
    const observer = new MutationObserver(rescan);
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect());
  },
});
