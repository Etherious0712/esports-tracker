import type { Match, MatchStatus } from '../../../core/models';
import type { SpoilerDecision } from '../../../core/spoiler';
import { formatLocalDateTime } from '../../../core/time';
import { SpoilerGuard } from './SpoilerGuard';

const STATUS_LABEL: Record<MatchStatus, string> = {
  notStarted: 'Upcoming',
  running: 'Live',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

interface MatchRowProps {
  match: Match;
  decision: SpoilerDecision;
  onReveal: (matchId: string) => void;
}

export function MatchRow({ match, decision, onReveal }: MatchRowProps) {
  return (
    <li class="match-row">
      <div class="match-row__meta">
        <span class="match-row__competition">{match.competition.name}</span>
        <span class={`badge badge--${match.status}`}>{STATUS_LABEL[match.status]}</span>
      </div>
      <div class="match-row__teams">
        <span class="team">
          {match.teamA.name} <span class="team__acronym">({match.teamA.acronym})</span>
        </span>
        <SpoilerGuard match={match} decision={decision} onReveal={onReveal} />
        <span class="team">
          {match.teamB.name} <span class="team__acronym">({match.teamB.acronym})</span>
        </span>
      </div>
      <time class="match-row__time" dateTime={match.beginAtUtc}>
        {formatLocalDateTime(match.beginAtUtc)}
      </time>
    </li>
  );
}
