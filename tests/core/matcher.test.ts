import { describe, expect, it } from 'vitest';
import type { Team } from '../../src/core/models';
import {
  buildAliasIndex,
  hasResultSignal,
  hasVsStructure,
  matchText,
  normalise,
} from '../../src/core/matcher';

// ── Test fixtures ─────────────────────────────────────────────────────────────

function team(id: string, name: string, acronym: string): Team {
  return { id, name, acronym };
}

// Followed teams used across most tests. GENG's name uses a dot ("Gen.G") to
// exercise punctuation folding; both name and acronym normalise to "geng".
const T1 = team('t1', 'T1', 'T1');
const GENG = team('geng', 'Gen.G', 'GENG');

const INDEX = buildAliasIndex([T1, GENG]);

// ── normalise ─────────────────────────────────────────────────────────────────

describe('normalise', () => {
  it('Normalise_CaseAndWhitespace_Canonical', () => {
    expect(normalise('T1')).toBe('t1');
    expect(normalise('t1')).toBe('t1');
    expect(normalise('  t1  ')).toBe('t1');
  });

  it('Normalise_DottedAcronym_FoldsToPlain', () => {
    expect(normalise('GEN.G')).toBe(normalise('GENG'));
    expect(normalise('GEN.G')).toBe('geng');
  });

  it('Normalise_FullWidth_FoldsToHalfWidth', () => {
    // Full-width "Ｔ１" → "t1".
    expect(normalise('Ｔ１')).toBe('t1');
  });

  it('Normalise_PreservesScoreHyphen', () => {
    expect(normalise('2-1')).toBe('2-1');
    expect(normalise('2 - 1')).toBe('2 - 1');
  });
});

// ── helper signals ────────────────────────────────────────────────────────────

describe('hasVsStructure', () => {
  it('HasVsStructure_VsVariants_True', () => {
    expect(hasVsStructure('T1 vs GENG')).toBe(true);
    expect(hasVsStructure('T1 vs. GENG')).toBe(true);
    expect(hasVsStructure('T1 versus GENG')).toBe(true);
  });

  it('HasVsStructure_NoVs_False', () => {
    expect(hasVsStructure('T1 defeats GENG')).toBe(false);
    expect(hasVsStructure('T1 best plays')).toBe(false);
  });
});

describe('hasResultSignal', () => {
  it('HasResultSignal_Score_True', () => {
    expect(hasResultSignal('T1 vs GENG 2-1')).toBe(true);
    expect(hasResultSignal('final score 2 - 1')).toBe(true);
  });

  it('HasResultSignal_ResultWord_True', () => {
    expect(hasResultSignal('T1 defeats GENG')).toBe(true);
    expect(hasResultSignal('GENG advances')).toBe(true);
  });

  it('HasResultSignal_NoSignal_False', () => {
    expect(hasResultSignal('T1 vs GENG pre-match analysis')).toBe(false);
  });
});

// ── buildAliasIndex ───────────────────────────────────────────────────────────

describe('buildAliasIndex', () => {
  it('BuildAliasIndex_NameAndAcronym_BothRegistered', () => {
    const index = buildAliasIndex([team('c9', 'Cloud9', 'C9')]);
    expect(index.byAlias.get('cloud9')).toBe('c9');
    expect(index.byAlias.get('c9')).toBe('c9');
  });

  it('BuildAliasIndex_EmptyAcronym_Skipped', () => {
    const index = buildAliasIndex([team('c9', 'Cloud9', '')]);
    expect(index.byAlias.get('cloud9')).toBe('c9');
    // The empty string must never become an alias.
    expect(index.byAlias.has('')).toBe(false);
    expect([...index.byAlias.keys()]).toEqual(['cloud9']);
  });

  it('BuildAliasIndex_SharedAcronym_FlaggedAmbiguous', () => {
    const index = buildAliasIndex([
      team('a', 'Alpha', 'G2'),
      team('b', 'Beta', 'G2'),
    ]);
    expect(index.ambiguous.has('g2')).toBe(true);
    // Ambiguous alias is NOT silently resolved to a single team.
    expect(index.byAlias.has('g2')).toBe(false);
    // Unambiguous names still resolve.
    expect(index.byAlias.get('alpha')).toBe('a');
    expect(index.byAlias.get('beta')).toBe('b');
  });

  it('BuildAliasIndex_SingleCharAlias_Skipped', () => {
    const index = buildAliasIndex([team('x', 'X', 'X')]);
    expect(index.byAlias.has('x')).toBe(false);
    expect(index.byAlias.size).toBe(0);
  });
});

// ── matchText: the §5 table ───────────────────────────────────────────────────

describe('matchText (§5 table)', () => {
  it('MatchText_FixturePlusScore_Masks', () => {
    const hint = matchText('LCK | T1 vs GENG 2-1 | Highlights', INDEX);
    expect(hint).not.toBeNull();
    expect(hint!.shouldMask).toBe(true);
    expect(new Set(hint!.matchedTeamIds)).toStrictEqual(new Set(['t1', 'geng']));
    expect(hint!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('MatchText_FixtureNoResult_RecognisedNotMasked', () => {
    const hint = matchText('T1 vs GENG — Pre-match analysis', INDEX);
    expect(hint).not.toBeNull();
    expect(hint!.shouldMask).toBe(false);
  });

  it('MatchText_BareTeamNoVs_Null', () => {
    expect(matchText('T1 best plays of 2026', INDEX)).toBeNull();
  });

  it('MatchText_ResultWordsNotFollowed_Null', () => {
    expect(matchText('FNC beats MAD 2-0', INDEX)).toBeNull();
  });

  it('MatchText_ResultWordPhrasing_Masks', () => {
    const hint = matchText('T1 defeats GENG in the final', INDEX);
    expect(hint).not.toBeNull();
    expect(hint!.shouldMask).toBe(true);
  });

  it('MatchText_AmbiguousAcronym_BelowThresholdNoMask', () => {
    const ambiguousIndex = buildAliasIndex([
      team('a', 'Alpha', 'G2'),
      team('b', 'Beta', 'G2'),
    ]);
    const hint = matchText('G2 vs XYZ 2-0', ambiguousIndex);
    expect(hint).not.toBeNull();
    expect(hint!.shouldMask).toBe(false);
    expect(hint!.confidence).toBeLessThan(0.6);
    // Ambiguous alias is not resolved to a specific team.
    expect(hint!.matchedTeamIds).toEqual([]);
  });

  it('MatchText_CaseAndSpaceVariants_Masks', () => {
    const hint = matchText('t1   VS   geng  2 - 1', INDEX);
    expect(hint).not.toBeNull();
    expect(hint!.shouldMask).toBe(true);
  });

  it('MatchText_EmptyAcronymTeam_NameStillMatches', () => {
    const index = buildAliasIndex([team('c9', 'Cloud9', ''), T1]);
    const hint = matchText('Cloud9 vs T1 2-0', index);
    expect(hint).not.toBeNull();
    expect(hint!.shouldMask).toBe(true);
    expect(new Set(hint!.matchedTeamIds)).toStrictEqual(new Set(['c9', 't1']));
  });

  it('MatchText_OneFollowedTeamPlusVsPlusScore_Masks', () => {
    const hint = matchText('T1 vs SomeUnknown 2-1', INDEX);
    expect(hint).not.toBeNull();
    expect(hint!.shouldMask).toBe(true);
    expect(hint!.matchedTeamIds).toEqual(['t1']);
  });

  it('MatchText_ResultSignalNoVs_Null', () => {
    // "T1 wins MSI" — one team, a result word, but no vs and no second team.
    // Conservative, documented gap: not treated as a fixture.
    expect(matchText('T1 wins MSI', INDEX)).toBeNull();
  });
});

// ── matchText: extra guards ───────────────────────────────────────────────────

describe('matchText (extra guards)', () => {
  it('MatchText_NoFollowedTeam_Null', () => {
    expect(matchText('Some random video title 5-0', INDEX)).toBeNull();
  });

  it('MatchText_TwoTeamsCoListedNoResult_Null', () => {
    // A listing page with both teams but no vs and no result must NOT be a fixture.
    expect(matchText('Power rankings: T1 and GENG among the top teams', INDEX)).toBeNull();
  });

  it('MatchText_AliasNotSubstringMatched', () => {
    // "t1" must not match inside "t10" / "art1st".
    expect(matchText('art1st vs t10 2-1', INDEX)).toBeNull();
  });
});

// ── matchText: no-"vs" adjacency (anti over-masking on listings) ───────────────

describe('matchText (no-vs adjacency)', () => {
  it('MatchText_NoVsAdjacentResult_Masks', () => {
    // Result word sits between the two teams → a compact fixture → mask.
    const hint = matchText('GENG defeats T1 2-0', INDEX);
    expect(hint).not.toBeNull();
    expect(hint!.shouldMask).toBe(true);
  });

  it('MatchText_NoVsFarApartListing_NoMask', () => {
    // Two followed teams + a result word, but scattered across a listing: the
    // result is adjacent only to GENG, and T1 is far away → not a fixture → null.
    const listing =
      'GENG advances to the grand final after a dominant series, and T1 are still alive in the lower bracket';
    expect(matchText(listing, INDEX)).toBeNull();
  });

  it('MatchText_NoVsWindowBoundary_MasksAtEdgeNotBeyond', () => {
    // Normalised length equals the bounding window (T1 at index 0, score at the
    // end), so this sits exactly on the ADJACENCY_WINDOW (30) edge → masks.
    const atEdge = `T1 ${'x'.repeat(18)} GENG 2-1`;
    const edgeHint = matchText(atEdge, INDEX);
    expect(edgeHint).not.toBeNull();
    expect(edgeHint!.shouldMask).toBe(true);

    // One character wider than the window → no longer a compact fixture → null.
    const beyondEdge = `T1 ${'x'.repeat(19)} GENG 2-1`;
    expect(matchText(beyondEdge, INDEX)).toBeNull();
  });
});
