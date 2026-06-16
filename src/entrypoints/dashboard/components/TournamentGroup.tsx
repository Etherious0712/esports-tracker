import type { TournamentGroup as TournamentGroupData } from '../../../core/dashboard';
import type { SpoilerPrefs } from '../../../core/spoiler';
import { DashboardMatchRow } from './DashboardMatchRow';

interface TournamentGroupProps {
  group: TournamentGroupData;
  revealed: Set<string>;
  prefs: SpoilerPrefs;
  onReveal: (matchId: string) => void;
}

export function TournamentGroup({ group, revealed, prefs, onReveal }: TournamentGroupProps) {
  return (
    <div class="dash-tournament">
      <h3 class="dash-tournament__name">{group.competition.name}</h3>
      <ul class="dash-tournament__matches">
        {group.matches.map(match => (
          <DashboardMatchRow
            key={match.id}
            match={match}
            revealed={revealed}
            prefs={prefs}
            onReveal={onReveal}
          />
        ))}
      </ul>
    </div>
  );
}
