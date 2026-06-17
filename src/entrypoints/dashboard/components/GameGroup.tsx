import type { GameGroup as GameGroupData } from '../../../core/dashboard';
import type { GameId } from '../../../core/models';
import type { SpoilerPrefs } from '../../../core/spoiler';
import { TournamentGroup } from './TournamentGroup';

const GAME_LABEL: Record<GameId, string> = {
  lol: 'League of Legends',
  csgo: 'Counter-Strike 2',
  dota2: 'Dota 2',
};

interface GameGroupProps {
  group: GameGroupData;
  revealed: Set<string>;
  prefs: SpoilerPrefs;
  onReveal: (matchId: string) => void;
}

export function GameGroup({ group, revealed, prefs, onReveal }: GameGroupProps) {
  return (
    <div class="dash-game">
      <h2 class="dash-game__name">{GAME_LABEL[group.game] ?? group.game}</h2>
      {group.tournaments.map(tournament => (
        <TournamentGroup
          key={tournament.competition.id}
          group={tournament}
          revealed={revealed}
          prefs={prefs}
          onReveal={onReveal}
        />
      ))}
    </div>
  );
}
