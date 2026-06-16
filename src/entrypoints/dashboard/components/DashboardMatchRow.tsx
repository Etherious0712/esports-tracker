import type { Match } from '../../../core/models';
import type { SpoilerPrefs } from '../../../core/spoiler';
import { getSpoilerDecision } from '../../../core/spoiler';
import { formatLocalDateTime } from '../../../core/time';
import { SpoilerGuard } from '../../popup/components/SpoilerGuard';

interface DashboardMatchRowProps {
  match: Match;
  revealed: Set<string>;
  prefs: SpoilerPrefs;
  onReveal: (matchId: string) => void;
}

export function DashboardMatchRow({ match, revealed, prefs, onReveal }: DashboardMatchRowProps) {
  // Reuse the popup's spoiler decision + SpoilerGuard — masking and the `enabled`
  // master switch come from here, not from any dashboard-specific logic.
  const decision = getSpoilerDecision(match, revealed.has(match.id), prefs);

  return (
    <li class="dash-row">
      <div class="dash-row__teams">
        <span class="team">
          {match.teamA.name} <span class="team__acronym">({match.teamA.acronym})</span>
        </span>
        <SpoilerGuard match={match} decision={decision} onReveal={onReveal} />
        <span class="team">
          {match.teamB.name} <span class="team__acronym">({match.teamB.acronym})</span>
        </span>
      </div>
      <div class="dash-row__meta">
        <time class="dash-row__time" dateTime={match.beginAtUtc}>
          {formatLocalDateTime(match.beginAtUtc)}
        </time>
        {match.officialStreamUrl !== null && (
          <a
            class="dash-row__stream"
            href={match.officialStreamUrl}
            target="_blank"
            rel="noreferrer"
          >
            Watch
          </a>
        )}
      </div>
    </li>
  );
}
