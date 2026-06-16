import type { DashboardTab } from '../App';

const NAV_ITEMS: ReadonlyArray<{ tab: DashboardTab; label: string }> = [
  { tab: 'main', label: 'Live & Results' },
  { tab: 'upcoming', label: 'Upcoming' },
];

interface DashboardNavProps {
  tab: DashboardTab;
  onSelect: (tab: DashboardTab) => void;
}

export function DashboardNav({ tab, onSelect }: DashboardNavProps) {
  return (
    <nav class="dash__nav" aria-label="Dashboard views">
      {NAV_ITEMS.map(item => {
        const active = item.tab === tab;
        return (
          <button
            key={item.tab}
            type="button"
            class={`dash__nav-item${active ? ' dash__nav-item--active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(item.tab)}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
