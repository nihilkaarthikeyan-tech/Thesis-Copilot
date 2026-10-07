/**
 * `Source` → CSL-JSON — PRD §8 (`Source.cslJson`), FR-5.2.
 *
 * Resolution stores the publisher's own CSL-JSON on the source when Crossref or OpenAlex gave
 * one. This fills the gaps: an unresolved source, or one whose CSL-JSON is missing the fields a
 * style needs, still has a title, authors and a year on the row. Nothing is invented — a field
 * absent from both the CSL-JSON and the row is absent from the output, and citeproc renders what
 * that style does for a missing field.
 */

export type CslName = { family?: string; given?: string; suffix?: string; literal?: string };

export type CslItem = {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  issued?: { 'date-parts': number[][] };
  'container-title'?: string;
  DOI?: string;
  URL?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  abstract?: string;
  [key: string]: unknown;
};

/** The subset of a `Source` row this needs; anything else is ignored. */
export type SourceLike = {
  id: string;
  title?: string | null;
  authors?: unknown;
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  cslJson?: unknown;
  isPreprint?: boolean | null;
  rawReference?: string | null;
};

/**
 * Crossref's type vocabulary → CSL's.
 *
 * `Source.cslJson` holds what the resolver received, and for a Crossref match that is Crossref's
 * own `works` record, not CSL-JSON. The two agree on most fields and disagree on the ones that
 * decide how a reference is printed: Crossref says `journal-article` where CSL says
 * `article-journal`, and citeproc treats a type it does not know as nothing in particular — which
 * printed every journal article in a thesis bibliography without its journal.
 */
const CROSSREF_TO_CSL: Record<string, string> = {
  'journal-article': 'article-journal',
  'proceedings-article': 'paper-conference',
  'book-chapter': 'chapter',
  'book-section': 'chapter',
  'book-part': 'chapter',
  'book-track': 'chapter',
  'edited-book': 'book',
  monograph: 'book',
  'reference-book': 'book',
  'book-set': 'book',
  'book-series': 'book',
  proceedings: 'book',
  'posted-content': 'article',
  dissertation: 'thesis',
  'report-series': 'report',
  'report-component': 'report',
  'reference-entry': 'entry-encyclopedia',
  'peer-review': 'review',
  'journal-issue': 'article-journal',
  journal: 'periodical',
  component: 'article',
  other: 'article',
};

/** CSL 1.0.2's types. A stored type already in this set is kept as it is. */
const CSL_TYPES = new Set([
  'article',
  'article-journal',
  'article-magazine',
  'article-newspaper',
  'bill',
  'book',
  'broadcast',
  'chapter',
  'classic',
  'collection',
  'dataset',
  'document',
  'entry',
  'entry-dictionary',
  'entry-encyclopedia',
  'event',
  'figure',
  'graphic',
  'hearing',
  'interview',
  'legal_case',
  'legislation',
  'manuscript',
  'map',
  'motion_picture',
  'musical_score',
  'pamphlet',
  'paper-conference',
  'patent',
  'performance',
  'periodical',
  'personal_communication',
  'post',
  'post-weblog',
  'regulation',
  'report',
  'review',
  'review-book',
  'software',
  'song',
  'speech',
  'standard',
  'thesis',
  'treaty',
  'webpage',
]);

/** CSL type from what is known. Everything scholarly here is an article unless it says otherwise. */
function typeOf(source: SourceLike, stored: Record<string, unknown> | null): string {
  const type = stored?.type;
  if (typeof type === 'string' && type.length > 0) {
    if (CSL_TYPES.has(type)) return type;
    const mapped = CROSSREF_TO_CSL[type];
    if (mapped) return mapped;
  }
  if (source.isPreprint) return 'article';
  return source.venue ? 'article-journal' : 'document';
}

/**
 * The text of a field that CSL wants as a string and Crossref sends as a list.
 *
 * Crossref's `title` is `["Deep learning"]` and its `container-title` is `["Nature"]`. Read as a
 * string, those are neither, and `toCslItem` used to fall straight past them — and past the row's
 * own correct `title` column — to the raw reference line, which then printed as the title of every
 * resolved source in the bibliography.
 */
function firstText(value: unknown): string | undefined {
  if (typeof value === 'string') return decodeEntities(value.trim()) || undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) return decodeEntities(entry.trim());
    }
  }
  return undefined;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Crossref sends titles and journal names HTML-escaped — "Green Energy &amp; Environment" — and
 * citeproc prints an entity as the text it is, so every reference list carried "&amp;" until
 * 2026-09-24. Decoded here, at the one door every text field comes through, so the records
 * already stored render correctly too. Inline markup (`<i>`, `<sub>`) is left for citeproc, which
 * formats it.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1] === 'x' || code[1] === 'X';
      const n = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * ADR-0078: the names a citation should print. Indexes list a paper's college as an author around
 * the people ("Sri Kaliswari College et al., 2025"), give "-" or an initial as a family name, or
 * the whole name as the family. Repaired, never invented: a word moves between fields or an
 * institution is dropped when people are listed. `cleanAuthors` in @tc/retrieval does the same
 * on the way in; this covers records stored before it, and keeps this package free of that one.
 */
export function peopleFirst(names: readonly CslName[]): CslName[] {
  const letters = (s: string) => /\p{L}/u.test(s);
  const repaired = names.map((n): CslName => {
    if (n.literal !== undefined || n.family === undefined) return n;
    const family = n.family.trim();
    const given = (n.given ?? '').trim();
    if (letters(family) && family.replace(/\./g, '').length > 1) return n;
    const words = given
      .split(/\s+/)
      .filter((w) => w && !/^(ms|mrs|mr|miss|dr|prof|shri|smt|sri|kum)\.?$/i.test(w));
    const at = words.findLastIndex((w) => /^\p{L}[\p{L}'’-]+$/u.test(w));
    if (at < 0) return n;
    const rest = words.filter((_, i) => i !== at);
    return {
      ...n,
      family: words[at] as string,
      given: [...rest, ...(letters(family) ? [family] : [])].join(' '),
    };
  });
  const person = (n: CslName) => n.literal === undefined && letters(n.family ?? '');
  const people = repaired.some(person) ? repaired.filter(person) : repaired;
  const seen = new Set<string>();
  return people.filter((n) => {
    const key = `${n.family ?? ''}|${n.given ?? ''}|${n.literal ?? ''}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `Source.authors` is `[{ family, given }]` or a list of strings, depending on where it came from. */
export function namesFrom(authors: unknown): CslName[] {
  if (!Array.isArray(authors)) return [];
  return authors
    .map((entry): CslName | null => {
      if (typeof entry === 'string') {
        const name = entry.trim();
        if (!name) return null;
        // "Kumar, A." keeps its comma order; "A. Kumar" does not get re-split, because guessing
        // which half is the family name is how citations end up wrong.
        const [family, given] = name.split(',').map((p) => p.trim());
        return given ? { family, given } : { literal: name };
      }
      if (entry && typeof entry === 'object') {
        const { family, given, suffix, literal, name } = entry as Record<string, unknown>;
        if (typeof family === 'string' || typeof given === 'string') {
          return {
            ...(typeof family === 'string' ? { family: decodeEntities(family) } : {}),
            ...(typeof given === 'string' ? { given: decodeEntities(given) } : {}),
            // "Jr." from the name splitter (`personName`); dropping it printed the wrong person.
            ...(typeof suffix === 'string' && suffix ? { suffix } : {}),
          };
        }
        const flat = literal ?? name;
        if (typeof flat === 'string' && flat.trim()) {
          return { literal: decodeEntities(flat.trim()) };
        }
      }
      return null;
    })
    .filter((n): n is CslName => n !== null);
}

/** On a stored CSL record the student has edited (R15); never sent to citeproc. */
export const EDITED_KEY = 'tc-edited';

/**
 * One CSL-JSON item for citeproc. The stored CSL-JSON wins field by field; the row fills what it
 * does not have. The id is the source id, so a rendered label can always be traced back to a row.
 */
export function toCslItem(source: SourceLike): CslItem {
  const stored =
    source.cslJson && typeof source.cslJson === 'object' && !Array.isArray(source.cslJson)
      ? ({ ...(source.cslJson as Record<string, unknown>) } as Record<string, unknown>)
      : null;

  const item: CslItem = {
    ...(stored ?? {}),
    id: source.id,
    type: typeOf(source, stored),
  };

  // The stored title, then the row's own title column, and only then the raw reference line. The
  // row column comes before the raw line because it is what resolution wrote *after* matching;
  // the raw line is what the student's paper happened to say.
  const baseTitle = firstText(stored?.title) ?? firstText(source.title);
  // Crossref keeps a subtitle apart ("Deep learning" / "a review"). CSL has no field for it, and a
  // title printed without it is a different title; joined the way every style guide shows one.
  const subtitle = firstText(stored?.subtitle);
  if (baseTitle) {
    item.title =
      subtitle && !baseTitle.toLowerCase().includes(subtitle.toLowerCase())
        ? `${baseTitle}: ${subtitle}`
        : baseTitle;
  } else if (source.rawReference) {
    item.title = source.rawReference.slice(0, 300);
  } else {
    delete item.title;
  }
  delete item.subtitle;

  const storedAuthors = namesFrom(stored?.author);
  const listed = storedAuthors.length > 0 ? storedAuthors : namesFrom(source.authors);
  // R15 (ADR-0102): names the student typed are printed as typed — an organisation listed beside
  // people is theirs to list; `peopleFirst` repairs what indexes send, not what a person wrote.
  const authors = stored?.[EDITED_KEY] === true ? listed : peopleFirst(listed);
  delete item[EDITED_KEY];
  if (authors.length > 0) item.author = authors;
  else delete item.author;

  const storedYear = (stored?.issued as { 'date-parts'?: number[][] } | undefined)?.[
    'date-parts'
  ]?.[0]?.[0];
  const year = typeof storedYear === 'number' ? storedYear : source.year;
  if (typeof year === 'number' && Number.isFinite(year)) item.issued = { 'date-parts': [[year]] };
  else delete item.issued;

  const venue = firstText(stored?.['container-title']) ?? firstText(source.venue);
  if (venue) item['container-title'] = venue;
  // Otherwise the spread above may have left Crossref's list here, which is not CSL.
  else delete item['container-title'];

  const shortVenue = firstText(stored?.['short-container-title']);
  if (shortVenue) item['container-title-short'] = shortVenue;
  delete item['short-container-title'];

  const doi = stored?.DOI ?? source.doi;
  if (typeof doi === 'string' && doi.trim()) item.DOI = doi.trim();

  // The abstract is stored for retrieval, not for a bibliography; APA would print it.
  delete item.abstract;
  return item;
}
