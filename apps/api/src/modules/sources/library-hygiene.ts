/**
 * Library hygiene — duplicates and sources without full text (2026-10-04, from the Jenni study:
 * its library has a "Library Issues" view for duplicates and a "Missing PDFs" tab).
 *
 * Pure: no database, no network. The service feeds it rows and acts on what it returns.
 *
 * Two records are offered as **possible** duplicates, never merged on their own:
 *
 *   1. The same DOI, once normalised (case, `https://doi.org/`, `doi:`). A DOI names one work.
 *   2. Without a DOI on at least one side, near-identical titles **and** the same year, **and**
 *      the same first author when both records name one.
 *
 * What is deliberately never a duplicate:
 *
 *   - Two different DOIs, however alike the titles. A preprint and its published version, or two
 *     editions of a book, carry different DOIs and are different things to cite.
 *   - Different years, or a year missing on either side. A follow-up paper often reuses a title.
 *   - Titles whose numbers differ ("Part 1" / "Part 2", "2nd edition" / "3rd edition"), even when
 *     one edit apart.
 */

export type HygieneSource = {
  id: string;
  title: string | null;
  year: number | null;
  doi: string | null;
  authors: unknown;
  status: string;
  groundingLevel: string;
  hasFile: boolean;
  /** Citation nodes that point at it, across the thesis. */
  citeCount: number;
  /** Chapters it is pinned to. */
  pinCount: number;
  createdAt: Date;
};

export type DuplicateReason = 'SAME_DOI' | 'SAME_TITLE';

export type DuplicatePair = {
  /** The record the merge suggests keeping: the better-grounded, more-used, older one. */
  keepId: string;
  /** The record the merge suggests removing; its citations and pins move to `keepId`. */
  dropId: string;
  reason: DuplicateReason;
};

/** Unicode dashes and quotes become plain punctuation, then all punctuation becomes a space. */
export function normaliseTitle(title: string): string {
  return (
    title
      // Compatibility decomposition: ligatures (ﬁ), full-width letters and accented letters
      // split into their base letter plus a combining mark, which is then dropped.
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      // Every dash, quote and other punctuation or symbol, Unicode or not, is a word break.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  );
}

/** A DOI as a key: lower case, without the resolver prefix or a trailing full stop. */
export function normaliseDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const key = doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .replace(/[.\s]+$/, '');
  return key.startsWith('10.') ? key : null;
}

/** The first author's family name, normalised; null when the record does not name one. */
export function firstAuthor(authors: unknown): string | null {
  if (!Array.isArray(authors) || authors.length === 0) return null;
  const first = authors[0] as { family?: unknown; literal?: unknown } | null;
  const name =
    typeof first?.family === 'string'
      ? first.family
      : typeof first?.literal === 'string'
        ? first.literal
        : null;
  if (!name) return null;
  const key = normaliseTitle(name);
  return key || null;
}

/** Levenshtein distance, stopping early once it is past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

const numbersIn = (title: string): string => (title.match(/\p{N}+/gu) ?? []).join(' ');

/**
 * Near-identical: equal once normalised, or — for a title long enough that two typos are noise —
 * at most two edits apart with exactly the same numbers in it.
 */
export function titlesMatch(a: string, b: string): boolean {
  const x = normaliseTitle(a);
  const y = normaliseTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 30) return false;
  if (numbersIn(x) !== numbersIn(y)) return false;
  return editDistance(x, y, 2) <= 2;
}

/** Why two records are the same work, or null when they should not be offered as one. */
export function sameWork(a: HygieneSource, b: HygieneSource): DuplicateReason | null {
  const doiA = normaliseDoi(a.doi);
  const doiB = normaliseDoi(b.doi);
  if (doiA && doiB) return doiA === doiB ? 'SAME_DOI' : null;

  if (!a.title || !b.title) return null;
  if (a.year === null || b.year === null || a.year !== b.year) return null;
  const authorA = firstAuthor(a.authors);
  const authorB = firstAuthor(b.authors);
  if (authorA && authorB && authorA !== authorB) return null;
  return titlesMatch(a.title, b.title) ? 'SAME_TITLE' : null;
}

const GROUNDING_RANK: Record<string, number> = { FULL_TEXT: 2, ABSTRACT: 1, NONE: 0 };

/**
 * Which of two records to keep: the one the AI can quote more of, then the one with a PDF, then a
 * resolved record, then the one the thesis leans on more, then the older one.
 */
export function preferKeep(a: HygieneSource, b: HygieneSource): HygieneSource {
  const score = (s: HygieneSource): number[] => [
    GROUNDING_RANK[s.groundingLevel] ?? 0,
    s.hasFile ? 1 : 0,
    s.status === 'RESOLVED' ? 1 : 0,
    s.citeCount + s.pinCount,
    -s.createdAt.getTime(),
  ];
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) {
    if ((sa[i] as number) !== (sb[i] as number))
      return (sa[i] as number) > (sb[i] as number) ? a : b;
  }
  return a.id < b.id ? a : b;
}

/**
 * Every possible duplicate in one library, as pairs. Three copies of one paper come back as two
 * pairs against the same kept record, so merging them one at a time ends with one record.
 *
 * A record joins a group only when it is the same work as **every** member, so a chain (A matches
 * B on title, B matches C on title, A and C carry different DOIs) never pairs A with C.
 */
export function findDuplicates(sources: readonly HygieneSource[]): DuplicatePair[] {
  const groups: HygieneSource[][] = [];
  for (const source of sources) {
    const group = groups.find((g) => g.every((member) => sameWork(member, source) !== null));
    if (group) group.push(source);
    else groups.push([source]);
  }

  const pairs: DuplicatePair[] = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const keep = group.reduce((best, s) => preferKeep(best, s));
    for (const other of group) {
      if (other.id === keep.id) continue;
      const reason = sameWork(keep, other);
      if (reason) pairs.push({ keepId: keep.id, dropId: other.id, reason });
    }
  }
  return pairs;
}

/**
 * Why a source has no full text, from what the library records — said only as far as the record
 * shows it. `index-source` knows the exact failure but does not store it, so this does not claim
 * one ("behind a paywall") that was never observed.
 */
export function whyNoFullText(source: {
  status: string;
  groundingLevel: string;
  doi: string | null;
  hasFile: boolean;
}): string | null {
  if (source.groundingLevel === 'FULL_TEXT') return null;
  if (source.status === 'PENDING') return 'Still being looked up.';
  if (source.status === 'UNRESOLVED' || source.status === 'FAILED') {
    return 'We could not identify this reference, so there was nothing to fetch. Add the PDF, or fix the reference first.';
  }
  if (source.hasFile) {
    return 'A PDF is attached but no text has been read from it yet. If this stays, the PDF is probably a scan with no text layer — a PDF with selectable text will work.';
  }
  if (!normaliseDoi(source.doi)) {
    return 'No DOI, so there was no way to look for an open-access copy.';
  }
  return source.groundingLevel === 'ABSTRACT'
    ? 'No open-access copy could be fetched, so only the abstract was read.'
    : 'No open-access copy could be fetched, and there was no abstract to read.';
}

type PmNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  [key: string]: unknown;
};

/**
 * A chapter's ProseMirror JSON with every citation of `fromId` pointed at `toId` instead.
 *
 * The citation's passage (`chunkId`) belongs to the removed source, so it moves to the kept
 * source's chunk with the same text when there is one (`chunkMap`), and is cleared otherwise: the
 * citation still cites the right work, it just no longer opens at a passage.
 *
 * Returns a copy; the input is not changed. `changed` counts the citation nodes rewritten.
 */
export function repointCitations(
  doc: unknown,
  fromId: string,
  toId: string,
  chunkMap: ReadonlyMap<string, string>,
): { doc: unknown; changed: number; passagesCleared: number } {
  let changed = 0;
  let passagesCleared = 0;

  const visit = (node: PmNode): PmNode => {
    if (node.type === 'citation' && node.attrs?.sourceId === fromId) {
      changed++;
      const chunkId = typeof node.attrs.chunkId === 'string' ? node.attrs.chunkId : null;
      const mapped = chunkId ? (chunkMap.get(chunkId) ?? null) : null;
      if (chunkId && !mapped) passagesCleared++;
      return { ...node, attrs: { ...node.attrs, sourceId: toId, chunkId: mapped } };
    }
    if (!Array.isArray(node.content)) return node;
    return { ...node, content: node.content.map(visit) };
  };

  if (!doc || typeof doc !== 'object') return { doc, changed: 0, passagesCleared: 0 };
  const out = visit(doc as PmNode);
  return { doc: changed > 0 ? out : doc, changed, passagesCleared };
}
