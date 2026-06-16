import type { DashboardStatus, StatusSection as StatusSectionData } from '../../../core/dashboard';
import type { SpoilerPrefs } from '../../../core/spoiler';
import { GameGroup } from './GameGroup';

const SECTION_LABEL: Record<DashboardStatus, string> = {
  running: 'Live',
  notStarted: 'Upcoming',
  finished: 'Finished',
};

interface StatusSectionProps {
  section: StatusSectionData;
  revealed: Set<string>;
  prefs: SpoilerPrefs;
  onReveal: (matchId: string) => void;
}

export function StatusSection({ section, revealed, prefs, onReveal }: StatusSectionProps) {
  return (
    <section class={`dash-section dash-section--${section.status}`}>
      <h1 class="dash-section__heading">{SECTION_LABEL[section.status]}</h1>
      {section.games.map(game => (
        <GameGroup
          key={game.game}
          group={game}
          revealed={revealed}
          prefs={prefs}
          onReveal={onReveal}
        />
      ))}
    </section>
  );
}
