import type { Team } from './models';

// The "brain" of page-level spoiler protection. Pure logic — no DOM, no chrome.
// Conservative by design: prefer missing a spoiler over masking wanted content.

export interface MatchHint {
  /** Whether this text should be masked (passed BOTH gates and the threshold). */
  shouldMask: boolean;
  /** Followed teams recognised unambiguously, by id. Usually one or two. */
  matchedTeamIds: string[];
  /** 0..1 confidence that the text refers to a real, followed fixture. */
  confidence: number;
  /** Human-readable reason for debugging/telemetry (never shown to users). */
  reason: string;
}

/** A flattened, normalised lookup built once from the follow list. */
export interface AliasIndex {
  /** Unambiguous normalised alias → teamId. */
  byAlias: Map<string, string>;
  /**
   * Aliases shared by more than one team (e.g. a clashing acronym). Kept separate
   * and never resolved to a single team — their presence lowers confidence rather
   * than silently picking a side.
   */
  ambiguous: Set<string>;
}

// ── Tuning constants (documented, conservative) ───────────────────────────────

const MIN_ALIAS_LENGTH = 2;

const CONFIDENCE_TWO_TEAMS = 0.9;
const CONFIDENCE_ONE_TEAM = 0.7;
const CONFIDENCE_AMBIGUOUS_ONLY = 0.3;
const RESULT_CORROBORATION = 0.1;
const MASK_THRESHOLD = 0.6;

// For the no-"vs" gate-1 branch only: two followed teams plus the result signal
// must all sit within this many characters of one another, so "T1 defeats GENG"
// (≈15 chars) is treated as a fixture but a listing page that merely names two
// followed teams far apart with a stray result word is not. ~30 chars ≈ a short
// headline fragment / a handful of words; large enough for "TeamA defeats TeamB
// 2-1", small enough to exclude widely-separated mentions. The "vs" path is
// unaffected — an explicit "vs" is already a strong fixture signal on its own.
const ADJACENCY_WINDOW = 30;

// Small, deliberately conservative result-word set. A bloated list causes false
// masks. "def" covers the abbreviation "def." (the dot is removed by normalise).
const RESULT_WORDS = [
  'wins',
  'beats',
  'defeats',
  'def',
  'eliminates',
  'advances',
  'advance',
  'champions',
  'champion',
];

const SCORE_PATTERN = /\b\d+\s*-\s*\d+\b/;
const RESULT_WORD_PATTERN = new RegExp(`\\b(?:${RESULT_WORDS.join('|')})\\b`);
const VS_PATTERN = /\b(?:vs|versus)\b/;

// ── normalise ─────────────────────────────────────────────────────────────────

/**
 * Canonicalises text so case/spacing/width/punctuation differences don't cause
 * misses. Deterministic and locale-independent.
 *
 * - NFKC folds full-width forms to half-width (e.g. "Ｔ１" → "T1").
 * - Apostrophes and full stops are deleted so "GEN.G" → "geng" and "def." → "def".
 * - Other punctuation becomes a space (so "A | B" splits into words).
 * - Hyphens and digits are preserved so score patterns like "2-1" survive.
 */
export function normalise(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Signal helpers ────────────────────────────────────────────────────────────

/** True if the text contains a "vs"/"versus" structure (word-boundaried, normalised). */
export function hasVsStructure(text: string): boolean {
  return VS_PATTERN.test(normalise(text));
}

/** True if the text looks like it carries a result: a score pattern OR a result word. */
export function hasResultSignal(text: string): boolean {
  const normalised = normalise(text);
  return SCORE_PATTERN.test(normalised) || RESULT_WORD_PATTERN.test(normalised);
}

// ── buildAliasIndex ───────────────────────────────────────────────────────────

/**
 * Builds a normalised alias → teamId lookup from a list of teams.
 * Registers each team's name and (non-empty) acronym. Aliases shorter than two
 * characters are skipped (too noisy). An alias shared by more than one team is
 * recorded as ambiguous, never resolved to a single team.
 */
export function buildAliasIndex(teams: Team[]): AliasIndex {
  const aliasToTeams = new Map<string, Set<string>>();

  const register = (rawAlias: string, teamId: string): void => {
    const alias = normalise(rawAlias);
    if (alias.length < MIN_ALIAS_LENGTH) return;
    const ids = aliasToTeams.get(alias) ?? new Set<string>();
    ids.add(teamId);
    aliasToTeams.set(alias, ids);
  };

  for (const team of teams) {
    register(team.name, team.id);
    if (team.acronym.trim().length > 0) register(team.acronym, team.id);
  }

  const byAlias = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [alias, ids] of aliasToTeams) {
    if (ids.size === 1) {
      byAlias.set(alias, [...ids][0]!);
    } else {
      ambiguous.add(alias);
    }
  }

  return { byAlias, ambiguous };
}

// ── matchText (the gates) ─────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type Range = { start: number; end: number };
type TeamMention = Range & { teamId: string };

/** Alias regex with alphanumeric boundaries (lookarounds keep match.index exact). */
function aliasRegex(alias: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(alias)}(?![a-z0-9])`, 'g');
}

/** Word-boundaried presence test against already-normalised text. */
function aliasPresent(normalisedText: string, alias: string): boolean {
  return aliasRegex(alias).test(normalisedText);
}

/** Every position at which any unambiguous followed-team alias appears. */
function collectTeamMentions(normalisedText: string, byAlias: Map<string, string>): TeamMention[] {
  const mentions: TeamMention[] = [];
  for (const [alias, teamId] of byAlias) {
    const regex = aliasRegex(alias);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalisedText)) !== null) {
      mentions.push({ teamId, start: match.index, end: match.index + match[0].length });
    }
  }
  return mentions;
}

/** Every position at which a result signal (score pattern or result word) appears. */
function collectResultRanges(normalisedText: string): Range[] {
  const ranges: Range[] = [];
  const patterns = [
    new RegExp(SCORE_PATTERN.source, 'g'),
    new RegExp(`\\b(?:${RESULT_WORDS.join('|')})\\b`, 'g'),
  ];
  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalisedText)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

/**
 * True when a result signal and two DISTINCT followed-team mentions all fall
 * within ADJACENCY_WINDOW characters of one another — i.e. a compact "A <result> B"
 * structure rather than two teams scattered across a listing page.
 */
function hasAdjacentFixture(mentions: TeamMention[], results: Range[]): boolean {
  for (const result of results) {
    for (let i = 0; i < mentions.length; i++) {
      for (let j = i + 1; j < mentions.length; j++) {
        const a = mentions[i]!;
        const b = mentions[j]!;
        if (a.teamId === b.teamId) continue;
        const lo = Math.min(a.start, b.start, result.start);
        const hi = Math.max(a.end, b.end, result.end);
        if (hi - lo <= ADJACENCY_WINDOW) return true;
      }
    }
  }
  return false;
}

/**
 * Decides whether a piece of page text refers to a followed fixture, and whether
 * it should be masked. Returns null when no followed team is recognised, or when
 * the text is not a fixture (gate 1 fails) — keeping the content script simple.
 *
 * Gate 1 (is-a-fixture): a "vs" structure with a recognised team, OR two distinct
 *   followed teams together with a result signal (covers "A defeats B", which has
 *   no "vs"). Two teams merely co-listed with no result is NOT a fixture.
 * Gate 2 (should-mask): a result signal on top of gate 1.
 * Masking additionally requires confidence >= threshold (ambiguous aliases pull it
 * down), so a low-confidence match is recognised but never masked.
 */
export function matchText(text: string, index: AliasIndex): MatchHint | null {
  const normalised = normalise(text);

  const mentions = collectTeamMentions(normalised, index.byAlias);
  const matchedTeamIds = new Set(mentions.map(m => m.teamId));
  let ambiguousPresent = false;
  for (const alias of index.ambiguous) {
    if (aliasPresent(normalised, alias)) {
      ambiguousPresent = true;
      break;
    }
  }

  const recognised = matchedTeamIds.size > 0 || ambiguousPresent;
  if (!recognised) return null;

  const vs = hasVsStructure(normalised);
  const resultRanges = collectResultRanges(normalised);
  const result = resultRanges.length > 0;
  const teamCount = matchedTeamIds.size;

  // Gate 1, no-"vs" branch: two followed teams AND a result signal, but only when
  // they sit close together (see ADJACENCY_WINDOW) — otherwise a listing page that
  // names two followed teams far apart with a stray result word would over-mask.
  const gate1 =
    (vs && recognised) || (teamCount >= 2 && result && hasAdjacentFixture(mentions, resultRanges));
  if (!gate1) return null;

  const gate2 = result;

  const base =
    teamCount >= 2
      ? CONFIDENCE_TWO_TEAMS
      : teamCount === 1
        ? CONFIDENCE_ONE_TEAM
        : CONFIDENCE_AMBIGUOUS_ONLY;
  const confidence = Math.min(1, base + (result ? RESULT_CORROBORATION : 0));

  const shouldMask = gate1 && gate2 && confidence >= MASK_THRESHOLD;

  const reason =
    `vs=${vs} result=${result} teams=${teamCount}` +
    `${ambiguousPresent ? ' ambiguous' : ''} confidence=${confidence.toFixed(2)} ` +
    `mask=${shouldMask}`;

  return {
    shouldMask,
    matchedTeamIds: [...matchedTeamIds],
    confidence,
    reason,
  };
}
