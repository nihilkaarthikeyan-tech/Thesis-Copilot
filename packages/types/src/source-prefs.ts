/**
 * ADR-0087 (2026-10-07): what the student chose about sources when starting a thesis — Jenni's
 * "citation preferences" step, with indexing where Jenni has impact factor and cited-by (the
 * owner's call: an Indian student is asked "is it indexed?", not "what is its impact factor?").
 *
 * Stored on `Document.meta.sourcePrefs`. It filters the papers found *for* the student
 * (automatic sources, Discover); papers the student adds themselves are never filtered out.
 */

import { z } from 'zod';

/**
 * The journal lists OpenAlex records on each source (`listed_in`), as offered to the student.
 * Verified 2026-10-07 against `api.openalex.org/sources?group_by=listed_in`. Scopus, Web of
 * Science and UGC-CARE are not in OpenAlex; they need list files the owner must obtain
 * (`docs/PENDING.md`), and are not offered until then.
 */
export const INDEX_LISTS = ['cwts-core', 'medline', 'doaj', 'abdc', 'erih-plus', 'scielo'] as const;
export type IndexList = (typeof INDEX_LISTS)[number];

/** The student-facing name of each list. */
export const INDEX_LIST_LABELS: Record<IndexList, string> = {
  'cwts-core': 'Core international journals',
  medline: 'PubMed (MEDLINE)',
  doaj: 'DOAJ (open access)',
  abdc: 'ABDC (business)',
  'erih-plus': 'ERIH PLUS (humanities and social sciences)',
  scielo: 'SciELO',
};

/** The `listed_in` values OpenAlex uses for each list. ABDC is graded A*, A, B and C. */
export const OPENALEX_LISTED_IN: Record<IndexList, readonly string[]> = {
  'cwts-core': ['cwts-core'],
  medline: ['medline'],
  doaj: ['doaj'],
  abdc: ['abdc-a-star', 'abdc-a', 'abdc-b', 'abdc-c'],
  'erih-plus': ['erih-plus'],
  scielo: ['scielo'],
};

const year = z.number().int().min(1900).max(2100);

export const sourcePrefsSchema = z
  .object({
    /** Find papers for the student in the scholarly indexes (automatic sources). */
    webSearch: z.boolean(),
    /** Suggestions may cite papers the student added themselves. */
    librarySearch: z.boolean(),
    yearFrom: year.nullable(),
    yearTo: year.nullable(),
    /** Empty: any journal. Otherwise a found paper must be in at least one of these lists. */
    indexedIn: z.array(z.enum(INDEX_LISTS)).max(INDEX_LISTS.length),
    preprints: z.boolean(),
  })
  .refine((p) => p.webSearch || p.librarySearch, {
    message: 'Keep at least one of web search and library search on.',
  })
  .refine((p) => p.yearFrom === null || p.yearTo === null || p.yearFrom <= p.yearTo, {
    message: 'The first year must not be after the last.',
  });

export type SourcePrefs = z.infer<typeof sourcePrefsSchema>;

export const DEFAULT_SOURCE_PREFS: SourcePrefs = {
  webSearch: true,
  librarySearch: true,
  yearFrom: null,
  yearTo: null,
  indexedIn: [],
  preprints: true,
};

/** A thesis's preferences, or the defaults when it has none (every thesis made before ADR-0087). */
export function readSourcePrefs(meta: unknown): SourcePrefs {
  const raw = (meta as { sourcePrefs?: unknown } | null)?.sourcePrefs;
  const parsed = sourcePrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SOURCE_PREFS;
}

/** The OpenAlex `listed_in` values the preferences accept; empty means any. */
export function listedInFilter(prefs: SourcePrefs): string[] {
  return prefs.indexedIn.flatMap((list) => [...OPENALEX_LISTED_IN[list]]);
}

/**
 * Whether a found paper meets the preferences. A paper whose index cannot say where it is listed
 * (Semantic Scholar, PubMed's own search, arXiv) fails an indexing filter: "indexed" is a claim
 * that has to be read from a record, never assumed.
 */
export function meetsSourcePrefs(
  work: { year: number | null; isPreprint: boolean; listedIn?: readonly string[] | null },
  prefs: SourcePrefs,
): boolean {
  if (!prefs.preprints && work.isPreprint) return false;
  if (prefs.yearFrom !== null && (work.year === null || work.year < prefs.yearFrom)) return false;
  if (prefs.yearTo !== null && (work.year === null || work.year > prefs.yearTo)) return false;
  const wanted = listedInFilter(prefs);
  if (wanted.length > 0 && !(work.listedIn ?? []).some((l) => wanted.includes(l))) return false;
  return true;
}
