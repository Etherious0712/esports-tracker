import { matchText, normalise, type AliasIndex } from '../core/matcher';

// Page-level spoiler masking for Liquipedia matchlists. Pure DOM logic — no chrome
// APIs here so it is unit-testable in jsdom; the entrypoint wires storage/reveal.
//
// No-leak discipline (see spec §7): the real score/winner must never remain in the
// DOM while masked. Originals live in JS-side WeakMaps (never a data-* attribute),
// the placeholder is inert, and winner classes are stripped (recorded for restore).

const PLACEHOLDER = '–';
const MASKED_SCORE_CLASS = 'et-score-masked';
const REVEAL_BUTTON_CLASS = 'et-reveal-button';
const STYLE_ELEMENT_ID = 'et-liquipedia-style';

// Every result-bearing node within a row: outer cells, popup header scores, and
// the popup's detailed per-map scores (all present in the DOM before hover).
const SCORE_SELECTOR = [
  '.brkts-matchlist-score .brkts-matchlist-cell-content',
  '.match-info-header-scoreholder-score',
  '.brkts-popup-body-detailed-scores-main-score',
  '.brkts-popup-body-detailed-score',
].join(',');

// Winner/loser highlight classes — neutralised so styling can't reveal the winner.
// brkts-matchlist-slot-bold bolds the winning side's outer score cell, so it is a
// winner tell in its own right and is stripped (and restored) like the others.
const WINNER_CLASSES = [
  'brkts-matchlist-slot-winner',
  'brkts-matchlist-slot-bold',
  'match-info-header-winner',
  'match-info-header-loser',
];

interface RowMaskState {
  /** Score nodes that were masked, in stash order, for exact restore. */
  scoreNodes: Element[];
  /** Elements whose winner/loser classes were stripped, and which classes. */
  winners: Array<{ element: Element; classes: string[] }>;
}

// Original score text, keyed by the score element (JS-side, never in the DOM).
const originalScoreText = new WeakMap<Element, string>();
// Per-row restore metadata, so unmask can enumerate without re-querying by a
// class we have just removed.
const rowMaskState = new WeakMap<HTMLElement, RowMaskState>();

export interface MaskContext {
  index: AliasIndex;
  /** Reveal keys already revealed — such rows are left unmasked. */
  revealed: Set<string>;
  /** Persists a reveal (e.g. via the spoiler engine). Called after restoring a row. */
  onReveal: (key: string) => void;
}

/** All matchlist match rows under a root. */
export function collectMatchRows(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('div.brkts-matchlist-match'));
}

/** The two opponents' full names from their cells' aria-labels, or null if absent. */
export function extractTeamNames(row: HTMLElement): [string, string] | null {
  const opponents = row.querySelectorAll<HTMLElement>('.brkts-matchlist-opponent[aria-label]');
  if (opponents.length < 2) return null;
  const a = opponents[0]!.getAttribute('aria-label')?.trim() ?? '';
  const b = opponents[1]!.getAttribute('aria-label')?.trim() ?? '';
  if (a === '' || b === '') return null;
  return [a, b];
}

/** Deterministic, page-stable reveal key (spec §6). Falls back to names only if no date. */
export function computeRevealKey(row: HTMLElement, nameA: string, nameB: string): string {
  const dateNode = row.querySelector('.timer-object-date');
  const dateText = (dateNode?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const base = `lp:${normalise(nameA)}|${normalise(nameB)}`;
  return dateText === '' ? base : `${base}|${dateText}`;
}

function collectScoreNodes(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>(SCORE_SELECTOR));
}

/** True when the outer score cells carry a result (i.e. the match has finished). */
function rowHasResult(row: HTMLElement): boolean {
  const outer = row.querySelectorAll<HTMLElement>(
    '.brkts-matchlist-score .brkts-matchlist-cell-content',
  );
  return Array.from(outer).some(node => (node.textContent ?? '').trim() !== '');
}

function addRevealButton(row: HTMLElement, onClick: () => void): void {
  if (row.querySelector(`.${REVEAL_BUTTON_CLASS}`) !== null) return;
  const button = row.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = REVEAL_BUTTON_CLASS;
  button.textContent = '👁 Show result';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  row.appendChild(button);
}

/**
 * Masks every result-bearing node in a row and neutralises winner highlighting,
 * stashing originals JS-side. Idempotent via the data-et-masked marker.
 */
export function maskRow(row: HTMLElement, key: string, onReveal: (key: string) => void): void {
  if (row.dataset.etMasked === '1') return;

  const scoreNodes: Element[] = [];
  for (const node of collectScoreNodes(row)) {
    const text = node.textContent ?? '';
    if (text.trim() === '') continue;
    originalScoreText.set(node, text);
    node.textContent = PLACEHOLDER;
    node.classList.add(MASKED_SCORE_CLASS);
    scoreNodes.push(node);
  }

  const winners: RowMaskState['winners'] = [];
  for (const cls of WINNER_CLASSES) {
    for (const element of Array.from(row.querySelectorAll(`.${cls}`))) {
      element.classList.remove(cls);
      const existing = winners.find(w => w.element === element);
      if (existing) existing.classes.push(cls);
      else winners.push({ element, classes: [cls] });
    }
  }

  rowMaskState.set(row, { scoreNodes, winners });
  addRevealButton(row, () => {
    unmaskRow(row);
    onReveal(key);
  });
  row.dataset.etMasked = '1';
}

/** Restores a row exactly: score text, winner classes, removes the button/marker. */
export function unmaskRow(row: HTMLElement): void {
  const state = rowMaskState.get(row);
  if (state === undefined) return;

  for (const node of state.scoreNodes) {
    const original = originalScoreText.get(node);
    if (original !== undefined) {
      node.textContent = original;
      originalScoreText.delete(node);
    }
    node.classList.remove(MASKED_SCORE_CLASS);
  }
  for (const { element, classes } of state.winners) {
    for (const cls of classes) element.classList.add(cls);
  }

  row.querySelector(`.${REVEAL_BUTTON_CLASS}`)?.remove();
  rowMaskState.delete(row);
  delete row.dataset.etMasked;
}

/**
 * Processes a single row: skip if already masked, not a fixture, or not finished;
 * mask only when at least one opponent is a followed team and it is not yet revealed.
 * The matcher provides the followed-team filter (and ambiguity handling) — the row
 * itself supplies the fixture structure, so we feed an explicit "vs".
 */
function processRow(row: HTMLElement, ctx: MaskContext): void {
  if (row.dataset.etMasked === '1') return;
  const names = extractTeamNames(row);
  if (names === null) return;
  if (!rowHasResult(row)) return;

  const hint = matchText(`${names[0]} vs ${names[1]}`, ctx.index);
  if (hint === null || hint.matchedTeamIds.length === 0) return;

  const key = computeRevealKey(row, names[0], names[1]);
  if (ctx.revealed.has(key)) return;

  maskRow(row, key, ctx.onReveal);
}

/**
 * Scans a root and masks every eligible row. Fail-safe: a row that throws (e.g.
 * stale selectors after a site redesign) is skipped without affecting other rows
 * and never causes a false mask.
 */
export function processRoot(root: ParentNode, ctx: MaskContext): void {
  for (const row of collectMatchRows(root)) {
    try {
      processRow(row, ctx);
    } catch {
      // Never throw out of masking; never leave a row half-masked silently breaks others.
    }
  }
}

/** The grey-block stylesheet. Note: no blur of real text — the value is gone, not hidden. */
export const LIQUIPEDIA_STYLE = `
.${MASKED_SCORE_CLASS} {
  background: #3a3f4b;
  color: #3a3f4b;
  border-radius: 3px;
  padding: 0 0.35em;
  user-select: none;
}
.${REVEAL_BUTTON_CLASS} {
  margin-left: 0.4em;
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
  border: 1px solid #6c8cff;
  background: transparent;
  color: #6c8cff;
  border-radius: 4px;
  padding: 0 0.4em;
}
.${REVEAL_BUTTON_CLASS}:hover { background: #6c8cff; color: #0b0d13; }
`;

/** Injects the stylesheet once into a document head. */
export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = LIQUIPEDIA_STYLE;
  (doc.head ?? doc.documentElement).appendChild(style);
}
