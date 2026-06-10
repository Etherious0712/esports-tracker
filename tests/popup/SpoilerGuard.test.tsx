// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Match } from '../../src/core/models';
import type { SpoilerDecision } from '../../src/core/spoiler';
import { SpoilerGuard } from '../../src/entrypoints/popup/components/SpoilerGuard';

afterEach(() => cleanup());

const HIDDEN: SpoilerDecision = { hideScore: true, hideWinner: true };
const SHOWN: SpoilerDecision = { hideScore: false, hideWinner: false };

/** Finished match, A beat B 2-1. Team names/acronyms deliberately contain no
 *  digits, so any digit in the masked DOM would mean the score leaked. */
function finishedMatch(): Match {
  return {
    id: 'match-99',
    game: 'lol',
    competition: { id: 'c1', name: 'LCK' },
    name: 'A vs B',
    teamA: { id: 'a', name: 'Team Alpha', acronym: 'ALP' },
    teamB: { id: 'b', name: 'Team Beta', acronym: 'BET' },
    beginAtUtc: '2026-06-09T10:00:00Z',
    endAtUtc: '2026-06-09T11:00:00Z',
    status: 'finished',
    bestOf: 3,
    results: [
      { teamId: 'a', score: 2 },
      { teamId: 'b', score: 1 },
    ],
    winnerId: 'a',
    officialStreamUrl: null,
  };
}

function notStartedMatch(): Match {
  return { ...finishedMatch(), status: 'notStarted', endAtUtc: null, winnerId: null };
}

describe('SpoilerGuard', () => {
  it('SpoilerGuard_HiddenDecision_RendersButtonAndNoScoreInDom', () => {
    const { container, getByRole } = render(
      <SpoilerGuard match={finishedMatch()} decision={HIDDEN} onReveal={() => undefined} />,
    );

    // The reveal button is present...
    expect(getByRole('button', { name: /show result/i })).toBeTruthy();
    // ...and crucially, the real score is nowhere in the DOM. No digit may appear
    // anywhere — not in text, title, or aria-label.
    expect(container.textContent ?? '').not.toContain('2 - 1');
    expect(/\d/.test(container.innerHTML)).toBe(false);
  });

  it('SpoilerGuard_RevealClick_CallsOnRevealWithMatchId', () => {
    const onReveal = vi.fn();
    const { getByRole } = render(
      <SpoilerGuard match={finishedMatch()} decision={HIDDEN} onReveal={onReveal} />,
    );

    fireEvent.click(getByRole('button', { name: /show result/i }));

    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledWith('match-99');
  });

  it('SpoilerGuard_ShownDecision_ShowsScoreNoButton', () => {
    const { container, queryByRole } = render(
      <SpoilerGuard match={finishedMatch()} decision={SHOWN} onReveal={() => undefined} />,
    );

    expect(container.textContent).toContain('2 - 1');
    expect(queryByRole('button')).toBeNull();
  });

  it('SpoilerGuard_NotStartedShown_ShowsVsNotZeroScore', () => {
    const { container, queryByRole } = render(
      <SpoilerGuard match={notStartedMatch()} decision={SHOWN} onReveal={() => undefined} />,
    );

    // notStarted is "shown" by the engine, but 0:0 is not a result — show "vs".
    expect(container.textContent).toContain('vs');
    expect(container.textContent).not.toContain('0 - 0');
    expect(queryByRole('button')).toBeNull();
  });
});
