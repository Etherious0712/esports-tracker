import type { Match } from '../../../core/models';
import type { SpoilerDecision } from '../../../core/spoiler';

interface SpoilerGuardProps {
  match: Match;
  decision: SpoilerDecision;
  /** Called with the match id when the user reveals. The parent owns persistence
   *  (calls the spoiler engine's reveal()) and updates its revealed set. */
  onReveal: (matchId: string) => void;
}

// Neutral placeholder shown while the score is masked. Carries no result.
const MASK_PLACEHOLDER = '— : —';

/** Builds the "a - b" score string. Only called when the score is shown. */
function formatScore(match: Match): string {
  const a = match.results.find(r => r.teamId === match.teamA.id)?.score ?? 0;
  const b = match.results.find(r => r.teamId === match.teamB.id)?.score ?? 0;
  return `${a} - ${b}`;
}

/** notStarted/cancelled have no real result (0:0 is not a score) — show "vs". */
function hasDisplayableScore(match: Match): boolean {
  return match.status === 'finished' || match.status === 'running';
}

/**
 * Renders the score area only. Team names and time live in MatchRow and stay
 * visible regardless of the decision.
 *
 * Critical: when masked, the real score is never placed in the DOM — not as text,
 * title, or aria-label. We render a neutral placeholder and only compute the real
 * score in the shown branch. (A CSS blur over real text would still leak via DOM
 * inspection, so we never do that.)
 */
export function SpoilerGuard({ match, decision, onReveal }: SpoilerGuardProps) {
  if (decision.hideScore) {
    return (
      <span class="score score--masked">
        <span class="score__placeholder" aria-label="Result hidden">
          {MASK_PLACEHOLDER}
        </span>
        <button type="button" class="reveal-button" onClick={() => onReveal(match.id)}>
          👁 Show result
        </button>
      </span>
    );
  }

  if (!hasDisplayableScore(match)) {
    return <span class="score score--vs">vs</span>;
  }

  return <span class="score">{formatScore(match)}</span>;
}
