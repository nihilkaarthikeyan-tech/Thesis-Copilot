/**
 * Journal matching — ADR-0040. A deterministic, explainable scorer that ranks journals by how
 * well they fit a thesis, grounded only on data OpenAlex reports. No LLM, no fabricated metrics.
 *
 * Ported from PublishMate's `journal_matching_engine.py` design (weighted signals + hard
 * eligibility gates), under our rules: every number shown is one OpenAlex gave, or it is marked
 * unknown and scores zero.
 */

/** One candidate journal, as OpenAlex's `/sources` describes it. All metrics may be null. */
export type JournalCandidate = {
  /** OpenAlex source id, `S...`. */
  id: string;
  name: string;
  issn: readonly string[];
  publisher: string | null;
  /** The journal's subject fingerprint: OpenAlex concepts with a level (0 broad → 3 narrow). */
  concepts: ReadonlyArray<{ name: string; level: number; score: number }>;
  worksCount: number | null;
  /**
   * OpenAlex 2-year mean citedness (ADR-0022). An impact proxy, NOT a Journal Impact Factor.
   * Null when OpenAlex has no figure; never guessed.
   */
  meanCitedness: number | null;
  isOpenAccess: boolean;
  /** Article-processing charge in USD, when OpenAlex reports one; null otherwise. */
  apcUsd: number | null;
  /** OpenAlex source type, lowercased: `journal`, `conference`, `repository`, `ebook platform`… */
  type: string | null;
};

/** What the thesis is about, and which journals already carry work it cites. */
export type JournalMatchProfile = {
  /** Thesis key terms + field, as lowercased phrases, for scope matching. */
  keywords: readonly string[];
  field: string | null;
  /** OpenAlex source id → how many of the thesis's cited sources that journal published. */
  citedVenues: Readonly<Record<string, number>>;
  /** Ranking nudge only, never a gate. */
  preferOpenAccess?: boolean;
  /** A filter: a journal dearer than this is still scored but marked over-budget. */
  maxApcUsd?: number | null;
};

export type AlignmentLevel = 'subfield' | 'field' | 'domain' | 'none';
export type ImpactTier = 'high' | 'medium' | 'emerging' | 'unknown';

export type JournalScore = {
  journalId: string;
  name: string;
  publisher: string | null;
  issn: readonly string[];
  eligible: boolean;
  /** Why it is eligible, or why not — shown to the student verbatim. */
  reason: string;
  /** 0–100, the sum of the breakdown. */
  total: number;
  breakdown: { scope: number; citedHere: number; impact: number; access: number };
  alignmentLevel: AlignmentLevel;
  impactTier: ImpactTier;
  /** Mean citedness as OpenAlex reports it, for display; null when unknown. */
  meanCitedness: number | null;
  /** How many of the thesis's cited sources this journal published. */
  citedHereCount: number;
  openAccess: boolean;
  apcUsd: number | null;
  /** True when `maxApcUsd` is set and this journal's APC exceeds it. */
  overBudget: boolean;
};

export const JOURNAL_MATCH = {
  /** Point ceilings per signal; they sum to 100. */
  scopeMax: 55,
  citedHereMax: 25,
  impactMax: 15,
  accessMax: 5,
  /** citedHere points per cited source this journal published. */
  pointsPerCitedSource: 8,
  /** Mean-citedness thresholds for the impact tiers. */
  impactHigh: 5,
  impactMedium: 2,
  /** Minimum scope points to count as any real alignment; below this is `none`. */
  scopeFloor: 12,
} as const;

const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'in',
  'on',
  'for',
  'to',
  'and',
  'or',
  'with',
  'by',
  'as',
  'at',
  'from',
  'using',
  'based',
  'study',
  'analysis',
  'approach',
  'method',
  'methods',
  'research',
  'thesis',
  'novel',
  'new',
  'via',
  'towards',
  'toward',
  'an',
  'into',
]);

/** Content tokens of a phrase: lowercased words of 3+ letters that are not stop words. */
export function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Scope alignment: how much the journal's concepts overlap the thesis's key terms. A hit on a
 * deeper OpenAlex concept (a subfield) counts for more than a hit on a broad domain concept, and
 * each hit is weighted by OpenAlex's own confidence that the journal is about that concept.
 */
export function scopeAlignment(
  candidate: JournalCandidate,
  profile: JournalMatchProfile,
): { points: number; level: AlignmentLevel } {
  const terms = new Set<string>();
  for (const kw of profile.keywords) for (const t of tokensOf(kw)) terms.add(t);
  if (profile.field) for (const t of tokensOf(profile.field)) terms.add(t);
  if (terms.size === 0 || candidate.concepts.length === 0) return { points: 0, level: 'none' };

  let raw = 0;
  let deepestHit = -1;
  for (const concept of candidate.concepts) {
    const conceptTokens = tokensOf(concept.name);
    const hit = conceptTokens.some((t) => terms.has(t));
    if (!hit) continue;
    // level 0 (domain) weakest, 3 (narrow subfield) strongest; OpenAlex concept.score in [0,1].
    const levelWeight = 1 + concept.level; // 1..4
    raw += levelWeight * Math.max(0.1, Math.min(1, concept.score));
    if (concept.level > deepestHit) deepestHit = concept.level;
  }
  // Normalise: a couple of strong subfield hits should reach most of the ceiling.
  const points = Math.round(Math.min(JOURNAL_MATCH.scopeMax, raw * 9));
  let level: AlignmentLevel = 'none';
  if (points >= JOURNAL_MATCH.scopeFloor) {
    level = deepestHit >= 3 ? 'subfield' : deepestHit >= 2 ? 'field' : 'domain';
  }
  return { points, level };
}

function impactOf(meanCitedness: number | null): { points: number; tier: ImpactTier } {
  if (meanCitedness === null || !Number.isFinite(meanCitedness) || meanCitedness <= 0) {
    return { points: 0, tier: 'unknown' };
  }
  if (meanCitedness >= JOURNAL_MATCH.impactHigh)
    return { points: JOURNAL_MATCH.impactMax, tier: 'high' };
  if (meanCitedness >= JOURNAL_MATCH.impactMedium) return { points: 10, tier: 'medium' };
  return { points: 5, tier: 'emerging' };
}

const JOURNAL_TYPES = new Set(['journal', 'ebook platform', 'book series']);

/** Scores one journal for one thesis. Pure; no I/O. */
export function scoreJournal(
  candidate: JournalCandidate,
  profile: JournalMatchProfile,
): JournalScore {
  const scope = scopeAlignment(candidate, profile);
  const citedHereCount = profile.citedVenues[candidate.id] ?? 0;
  const citedHere = Math.min(
    JOURNAL_MATCH.citedHereMax,
    citedHereCount * JOURNAL_MATCH.pointsPerCitedSource,
  );
  const impact = impactOf(candidate.meanCitedness);
  const prefersOa = profile.preferOpenAccess === true;
  const access = candidate.isOpenAccess ? (prefersOa ? JOURNAL_MATCH.accessMax : 2) : 0;
  const overBudget =
    profile.maxApcUsd != null && candidate.apcUsd != null && candidate.apcUsd > profile.maxApcUsd;

  // Eligibility gate (PublishMate's "orthogonal"): off-topic with no evidence, or not a journal.
  const notAJournal = candidate.type != null && !JOURNAL_TYPES.has(candidate.type.toLowerCase());
  let eligible = true;
  let reason = '';
  if (notAJournal) {
    eligible = false;
    reason = `Not a journal (OpenAlex type: ${candidate.type}).`;
  } else if (scope.level === 'none' && citedHereCount === 0) {
    eligible = false;
    reason =
      'Off-topic: its subject does not overlap the thesis and it has published none of your cited sources.';
  } else {
    const bits: string[] = [];
    if (citedHereCount > 0) bits.push(`publishes ${citedHereCount} of your cited source(s)`);
    if (scope.level !== 'none') bits.push(`${scope.level}-level subject match`);
    if (impact.tier !== 'unknown') bits.push(`${impact.tier} citedness`);
    reason = `Fits: ${bits.join(', ')}.`;
  }

  const total = eligible ? scope.points + citedHere + impact.points + access : 0;
  return {
    journalId: candidate.id,
    name: candidate.name,
    publisher: candidate.publisher,
    issn: candidate.issn,
    eligible,
    reason,
    total,
    breakdown: { scope: scope.points, citedHere, impact: impact.points, access },
    alignmentLevel: scope.level,
    impactTier: impact.tier,
    meanCitedness: candidate.meanCitedness,
    citedHereCount,
    openAccess: candidate.isOpenAccess,
    apcUsd: candidate.apcUsd,
    overBudget,
  };
}

/**
 * Ranks candidate journals for a thesis: eligible ones first by descending score, then ineligible
 * ones (shown separately with their reason). De-duplicates by journal id. Over-budget journals stay
 * in the ranking but carry the flag, so the student can see a strong match they may not afford.
 */
export function rankJournals(
  candidates: readonly JournalCandidate[],
  profile: JournalMatchProfile,
): JournalScore[] {
  const seen = new Set<string>();
  const scored: JournalScore[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    scored.push(scoreJournal(candidate, profile));
  }
  return scored.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.overBudget !== b.overBudget) return a.overBudget ? 1 : -1;
    return b.total - a.total;
  });
}
