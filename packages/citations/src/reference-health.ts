/**
 * Reference health — the things that make a bibliography embarrassing (2026-09-21).
 *
 * `runCitationChecks` already answers the *mechanical* questions: does every citation have a
 * source, is every source cited, is anything that looks like a citation sitting untagged in the
 * prose. Those are about the link between the text and the library.
 *
 * This asks a different question about the same library: **are these references any good?** A
 * bibliography can be perfectly well-formed and still contain a retracted paper, the preprint
 * version of something that was published three years ago, and the same work listed twice under
 * two slightly different titles. Every one of those is a thing an examiner notices and a student
 * never does, because they added the reference eighteen months earlier and never looked again.
 *
 * Pure, and over data the indexer already wrote. No model, no network, nothing to meter — the
 * sweep is free and can run whenever the screen is opened.
 *
 * It only ever *reports*. Nothing here edits a reference or removes one: a duplicate that looks
 * obvious to a string comparison can be two genuinely different papers by the same group in the
 * same year, and the student is the one who knows.
 */

export type ReferenceHealthKind =
  | 'RETRACTED'
  | 'STALE_PREPRINT'
  | 'DUPLICATE'
  | 'UNRESOLVED'
  | 'NO_IDENTIFIER';

export type ReferenceHealthFinding = {
  kind: ReferenceHealthKind;
  sourceId: string;
  /** The other source, for a duplicate. */
  otherSourceId?: string;
  shortRef: string;
  title: string | null;
  message: string;
  /** `high` is "fix this before anybody reads it"; `low` is housekeeping. */
  severity: 'high' | 'medium' | 'low';
};

export type SourceForHealth = {
  id: string;
  title: string | null;
  doi: string | null;
  year: number | null;
  status: 'PENDING' | 'RESOLVED' | 'UNRESOLVED' | 'FAILED';
  isPreprint: boolean;
  isRetracted: boolean;
  shortRef: string;
  /** How many citation nodes point at it. An uncited problem is a smaller problem. */
  citeCount: number;
};

/**
 * How old a preprint has to be before it is worth checking for a published version.
 *
 * Two years. Median time from preprint to journal publication is under a year in most fields, so
 * by two a preprint that was going to be published almost certainly has been — and citing the
 * preprint of a published paper is the specific thing a supervisor circles.
 */
export const STALE_PREPRINT_YEARS = 2;

/** Titles equal once case, punctuation and spacing stop counting. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function runReferenceHealth(
  sources: readonly SourceForHealth[],
  now = new Date(),
): ReferenceHealthFinding[] {
  const findings: ReferenceHealthFinding[] = [];
  const year = now.getUTCFullYear();

  for (const source of sources) {
    const base = { sourceId: source.id, shortRef: source.shortRef, title: source.title };

    // The only finding that is serious whether or not the source is cited: a retracted paper in
    // a library is a retracted paper a student may yet cite.
    if (source.isRetracted) {
      findings.push({
        ...base,
        kind: 'RETRACTED',
        severity: 'high',
        message: source.citeCount
          ? `This paper has been retracted and you cite it ${source.citeCount} ${source.citeCount === 1 ? 'time' : 'times'}. Remove it, or say explicitly that it was retracted and why you are discussing it.`
          : 'This paper has been retracted. Remove it from your library before you cite it by accident.',
      });
    }

    if (source.status === 'UNRESOLVED' || source.status === 'FAILED') {
      findings.push({
        ...base,
        kind: 'UNRESOLVED',
        severity: source.citeCount > 0 ? 'high' : 'low',
        message:
          'We could not find this reference in Crossref or OpenAlex, so its details are whatever was typed. Check the author, year and title by hand — a reference an examiner cannot find is one they will ask about.',
      });
      // No point complaining that an unresolved record has no DOI; that is the same problem.
      continue;
    }

    if (source.isPreprint && source.year && year - source.year >= STALE_PREPRINT_YEARS) {
      findings.push({
        ...base,
        kind: 'STALE_PREPRINT',
        severity: source.citeCount > 0 ? 'medium' : 'low',
        message: `This is a preprint from ${source.year}. It has probably been published by now — check, and cite the published version if there is one.`,
      });
    }

    // Only worth saying about something actually cited: an uncited source with no DOI is not in
    // the bibliography, so nobody is going to fail to find it.
    if (!source.doi && source.citeCount > 0) {
      findings.push({
        ...base,
        kind: 'NO_IDENTIFIER',
        severity: 'low',
        message:
          'No DOI. Most styles want one where it exists, and without it a reader has to search for the paper by hand.',
      });
    }
  }

  findings.push(...duplicatesIn(sources));

  // High first, then by how much the thesis leans on the source: the ordering a student would
  // triage in.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const citeCount = new Map(sources.map((s) => [s.id, s.citeCount]));
  return findings.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (citeCount.get(b.sourceId) ?? 0) - (citeCount.get(a.sourceId) ?? 0),
  );
}

/**
 * The same work listed twice.
 *
 * Matched on DOI first, which is definitive, then on a normalised title — two records with the
 * same title and the same year are the same paper often enough to be worth asking about, and the
 * finding says "check" rather than "remove" because occasionally they are not.
 */
function duplicatesIn(sources: readonly SourceForHealth[]): ReferenceHealthFinding[] {
  const findings: ReferenceHealthFinding[] = [];
  const seenDoi = new Map<string, SourceForHealth>();
  const seenTitle = new Map<string, SourceForHealth>();

  for (const source of sources) {
    const doi = source.doi?.trim().toLowerCase();
    if (doi) {
      const first = seenDoi.get(doi);
      if (first) {
        findings.push({
          kind: 'DUPLICATE',
          sourceId: source.id,
          otherSourceId: first.id,
          shortRef: source.shortRef,
          title: source.title,
          severity: 'medium',
          message: `The same DOI as “${first.title ?? first.shortRef}”. One of these is a duplicate; delete it, or your bibliography lists the paper twice.`,
        });
        continue;
      }
      seenDoi.set(doi, source);
    }

    if (!source.title) continue;
    // Year is part of the key: a follow-up paper often reuses a title almost exactly, and two
    // records a year apart are much more likely to be two papers than one entered twice.
    const key = `${normaliseTitle(source.title)}::${source.year ?? ''}`;
    const first = seenTitle.get(key);
    if (first && first.id !== source.id) {
      findings.push({
        kind: 'DUPLICATE',
        sourceId: source.id,
        otherSourceId: first.id,
        shortRef: source.shortRef,
        title: source.title,
        severity: 'medium',
        message:
          'The same title and year as another source in your library. Check whether these are two records of one paper.',
      });
      continue;
    }
    seenTitle.set(key, source);
  }

  return findings;
}

/** One sentence for the panel, or null when the library is healthy. */
export function referenceHealthHeadline(
  findings: readonly ReferenceHealthFinding[],
): string | null {
  if (findings.length === 0) return null;
  const high = findings.filter((f) => f.severity === 'high').length;
  if (high > 0) {
    return `${high} ${high === 1 ? 'reference needs' : 'references need'} attention before anyone reads this — a retracted or unverifiable source is the first thing an examiner notices.`;
  }
  return `${findings.length} ${findings.length === 1 ? 'thing' : 'things'} worth tidying in your bibliography.`;
}
