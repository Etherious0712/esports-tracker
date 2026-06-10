import type { Match } from '../../../core/models';
import type { SpoilerPrefs } from '../../../core/spoiler';
import { getSpoilerDecision } from '../../../core/spoiler';
import { MatchRow } from './MatchRow';

interface MatchListProps {
  matches: Match[];
  /** Read once by the parent (per the spoiler spec) and passed down. */
  revealed: Set<string>;
  prefs: SpoilerPrefs;
  onReveal: (matchId: string) => void;
}

export function MatchList({ matches, revealed, prefs, onReveal }: MatchListProps) {
  return (
    <ul class="match-list">
      {matches.map(match => (
        <MatchRow
          key={match.id}
          match={match}
          decision={getSpoilerDecision(match, revealed.has(match.id), prefs)}
          onReveal={onReveal}
        />
      ))}
    </ul>
  );
}
