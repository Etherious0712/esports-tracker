// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAliasIndex } from '../../src/core/matcher';
import type { Team } from '../../src/core/models';
import {
  collectMatchRows,
  computeRevealKey,
  extractTeamNames,
  type MaskContext,
  processRoot,
} from '../../src/content/liquipedia';

// Resolved from the project root (Vitest's cwd) — jsdom's import.meta.url is not a file URL.
const FIXTURE_HTML = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/liquipedia/matchlist.html'),
  'utf8',
);

// Followed teams = match 1 (M80 vs Lynn Vision Gaming). Match 2 (SINNERS vs
// FlyQuest) is deliberately NOT followed, to test the untouched path.
const FOLLOWED_TEAMS: Team[] = [
  { id: 'm80', name: 'M80', acronym: 'M80' },
  { id: 'lvg', name: 'Lynn Vision Gaming', acronym: 'LVG' },
];

const PLACEHOLDER = '–';

// Mirrors the adapter's selectors, for assertions.
const OUTER = '.brkts-matchlist-score .brkts-matchlist-cell-content';
const HEADER = '.match-info-header-scoreholder-score';
const MAIN = '.brkts-popup-body-detailed-scores-main-score';
const PERMAP = '.brkts-popup-body-detailed-score';
const ALL_SCORES = [OUTER, HEADER, MAIN, PERMAP].join(',');

function texts(row: Element, selector: string): string[] {
  return Array.from(row.querySelectorAll(selector)).map(n => (n.textContent ?? '').trim());
}

function makeContext(overrides: Partial<MaskContext> = {}): MaskContext {
  return {
    index: buildAliasIndex(FOLLOWED_TEAMS),
    revealed: new Set<string>(),
    onReveal: vi.fn(),
    ...overrides,
  };
}

let rows: HTMLElement[];

beforeEach(() => {
  document.body.innerHTML = FIXTURE_HTML;
  rows = collectMatchRows(document.body);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Liquipedia adapter', () => {
  it('fixture parses into two match rows', () => {
    expect(rows).toHaveLength(2);
    expect(extractTeamNames(rows[0]!)).toEqual(['M80', 'Lynn Vision Gaming']);
    expect(extractTeamNames(rows[1]!)).toEqual(['SINNERS Esports', 'FlyQuest']);
  });

  it('FollowedRow_Masked_AllScoresAndWinnerNeutralised', () => {
    processRoot(document.body, makeContext());
    const row = rows[0]!;

    for (const node of row.querySelectorAll(ALL_SCORES)) {
      expect(node.textContent).toBe(PLACEHOLDER);
    }
    expect(row.querySelectorAll('.brkts-matchlist-slot-winner')).toHaveLength(0);
    expect(row.querySelectorAll('.brkts-matchlist-slot-bold')).toHaveLength(0);
    expect(row.querySelectorAll('.match-info-header-winner')).toHaveLength(0);
    expect(row.querySelectorAll('.match-info-header-loser')).toHaveLength(0);
    expect(row.querySelector('.et-reveal-button')).not.toBeNull();
    expect(row.dataset.etMasked).toBe('1');
  });

  it('NoScoreStringAnywhere_AfterMasking (critical no-leak)', () => {
    const row = rows[0]!;
    // Distinct original score values present in this row's score nodes.
    const originalValues = new Set(texts(row, ALL_SCORES));
    expect(originalValues).toEqual(new Set(['13', '8', '5', '4']));

    processRoot(document.body, makeContext());

    // None of the originals survive as element text anywhere in the row (incl. popup).
    for (const value of originalValues) {
      expect(row.innerHTML.includes(`>${value}<`)).toBe(false);
    }
    // The originals are not stashed in any DOM attribute (WeakMap only).
    expect(row.outerHTML).not.toContain('data-et-orig');
    // Only the inert marker is present (on the row element itself).
    expect(row.dataset.etMasked).toBe('1');
  });

  it('NonFollowedRow_Untouched', () => {
    processRoot(document.body, makeContext());
    const row = rows[1]!;
    expect(texts(row, OUTER)).toEqual(['14', '16']);
    expect(row.querySelector('.et-reveal-button')).toBeNull();
    expect(row.dataset.etMasked).toBeUndefined();
    // Winner highlight on the non-followed row is left intact.
    expect(row.querySelectorAll('.brkts-matchlist-slot-winner').length).toBeGreaterThan(0);
  });

  it('Reveal_RestoresExactly', () => {
    const row = rows[0]!;
    const before = {
      outer: texts(row, OUTER),
      header: texts(row, HEADER),
      main: texts(row, MAIN),
      permap: texts(row, PERMAP),
      slotWinner: row.querySelectorAll('.brkts-matchlist-slot-winner').length,
      slotBold: row.querySelectorAll('.brkts-matchlist-slot-bold').length,
      headerWinner: row.querySelectorAll('.match-info-header-winner').length,
      headerLoser: row.querySelectorAll('.match-info-header-loser').length,
    };
    const onReveal = vi.fn();
    const expectedKey = computeRevealKey(row, 'M80', 'Lynn Vision Gaming');

    processRoot(document.body, makeContext({ onReveal }));
    (row.querySelector('.et-reveal-button') as HTMLButtonElement).click();

    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledWith(expectedKey);
    expect(texts(row, OUTER)).toEqual(before.outer);
    expect(texts(row, HEADER)).toEqual(before.header);
    expect(texts(row, MAIN)).toEqual(before.main);
    expect(texts(row, PERMAP)).toEqual(before.permap);
    expect(row.querySelectorAll('.brkts-matchlist-slot-winner')).toHaveLength(before.slotWinner);
    expect(row.querySelectorAll('.brkts-matchlist-slot-bold')).toHaveLength(before.slotBold);
    expect(row.querySelectorAll('.match-info-header-winner')).toHaveLength(before.headerWinner);
    expect(row.querySelectorAll('.match-info-header-loser')).toHaveLength(before.headerLoser);
    expect(row.querySelector('.et-reveal-button')).toBeNull();
    expect(row.dataset.etMasked).toBeUndefined();
  });

  it('AlreadyRevealed_NotMasked', () => {
    const row = rows[0]!;
    const key = computeRevealKey(row, 'M80', 'Lynn Vision Gaming');
    processRoot(document.body, makeContext({ revealed: new Set([key]) }));
    // Left fully visible because the user already revealed this fixture elsewhere.
    expect(texts(row, OUTER)).toEqual(['13', '8']);
    expect(row.dataset.etMasked).toBeUndefined();
  });

  it('Idempotent_DoubleMaskDoesNotDoubleStash', () => {
    const ctx = makeContext();
    processRoot(document.body, ctx);
    processRoot(document.body, ctx);
    const row = rows[0]!;

    // Exactly one reveal affordance, scores still masked.
    expect(row.querySelectorAll('.et-reveal-button')).toHaveLength(1);
    expect(texts(row, OUTER)).toEqual([PLACEHOLDER, PLACEHOLDER]);

    // Revealing restores the TRUE originals (a double-stash would restore '–').
    (row.querySelector('.et-reveal-button') as HTMLButtonElement).click();
    expect(texts(row, OUTER)).toEqual(['13', '8']);
  });

  it('NewlyInsertedRow_MaskedOnRescan', () => {
    const ctx = makeContext();
    processRoot(document.body, ctx);
    // Simulate a row inserted later (what the MutationObserver would re-scan):
    // a fresh, unmasked clone of the followed row.
    document.body.innerHTML = FIXTURE_HTML; // reset to unmasked
    const fresh = collectMatchRows(document.body)[0]!.cloneNode(true) as HTMLElement;
    document.body.appendChild(fresh);

    processRoot(document.body, ctx);
    expect(fresh.dataset.etMasked).toBe('1');
    expect(texts(fresh, OUTER)).toEqual([PLACEHOLDER, PLACEHOLDER]);
  });

  it('NotFinishedRow_Skipped', () => {
    // Clear the outer score cells → looks like an unplayed match → nothing to mask.
    const row = rows[0]!;
    for (const cell of row.querySelectorAll(OUTER)) cell.textContent = '';

    processRoot(document.body, makeContext());
    expect(row.dataset.etMasked).toBeUndefined();
    expect(row.querySelector('.et-reveal-button')).toBeNull();
  });

  it('StaleSelectors_NoThrowNoMask', () => {
    document.body.innerHTML =
      '<div class="brkts-matchlist-match"></div>' + // a row with none of the expected children
      '<section><p>Unrelated content with a 2-1 score</p></section>';
    expect(() => processRoot(document.body, makeContext())).not.toThrow();
    expect(document.body.querySelector('.et-reveal-button')).toBeNull();
    expect(document.body.innerHTML).not.toContain('data-et-masked');
  });

  it('RevealId_StableAcrossParses', () => {
    const keyFirst = computeRevealKey(rows[0]!, 'M80', 'Lynn Vision Gaming');

    document.body.innerHTML = FIXTURE_HTML;
    const reparsed = collectMatchRows(document.body)[0]!;
    const keySecond = computeRevealKey(reparsed, 'M80', 'Lynn Vision Gaming');

    expect(keyFirst).toBe(keySecond);
    expect(keyFirst.startsWith('lp:')).toBe(true);
  });
});
