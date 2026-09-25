/**
 * Every citation style there is — the Citation Style Language repository, searchable.
 *
 * The 20 styles in `styles/*.csl` are the ones this package ships and tests with golden strings.
 * Beyond them, `styles/catalog.json.gz` indexes all 10,863 styles in the CSL repository at one
 * pinned commit (see `scripts/build-style-index.mjs`): 2,862 independent styles, and 8,001
 * "dependent" ones — a journal's name and ISSN pointing at the independent style it uses. A
 * dependent renders exactly as its parent does, which is why `Journal of Cleaner Production` needs
 * no file of its own: it is Elsevier Harvard, under the name a student will search for.
 *
 * Only the index lives here. A style's XML is fetched from the same commit when a student picks
 * it and kept by the API from then on (`style-store.service.ts`), so a render or an export never
 * waits on the network.
 *
 * ## What is left out, and why
 *
 * The 720 **footnote** styles (Chicago notes–bibliography, OSCOLA, most history and law styles).
 * A note style writes its citation for a footnote, and the editor has no footnotes: rendered inline
 * it prints a full reference in the middle of a sentence, which is wrong for the style and would
 * be wrong in the submitted thesis. They are searchable — so a student looking for one is told why
 * it is missing rather than finding nothing — but they cannot be chosen.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { StyleFamily } from './styles.js';

/** One record in the catalogue, in the compact shape the build script writes. */
type Record_ = {
  id: string;
  /** Title. */
  t: string;
  /** Short title, when it differs. */
  s?: string;
  /** CSL `citation-format`; a dependent may leave it to its parent. */
  f?: string;
  /** CSL `field` categories. */
  c?: string[];
  /** Independent parent, for a dependent style. */
  p?: string;
  /** Default locale, when not en-US. */
  l?: string;
};

type Catalog = {
  source: string;
  commit: string;
  licence: string;
  count: number;
  styles: Record_[];
};

export type CatalogStyle = {
  id: string;
  title: string;
  shortTitle?: string;
  family: StyleFamily;
  /** The CSL `citation-format`, as the style declares it. */
  format: string;
  /** The independent style whose XML renders this one — itself, unless it is a dependent. */
  xmlId: string;
  /** Set for a dependent: a journal's name over another style's rules. */
  parent?: string;
  locale?: string;
  /**
   * Every style is selectable since the editor has footnotes (ADR-0029). Kept on the record so the
   * API's shape does not change; a style could still be withheld for another reason one day.
   */
  selectable: boolean;
};

let loaded: {
  catalog: Catalog;
  byId: Map<string, CatalogStyle>;
  all: CatalogStyle[];
} | null = null;

/** CSL's formats onto the three the UI explains. Label and author styles behave as author–date. */
function familyOf(format: string): StyleFamily {
  if (format === 'numeric') return 'numeric';
  if (format === 'note') return 'note';
  return 'author-date';
}

function load(stylesDir: string) {
  if (loaded) return loaded;
  const catalog = JSON.parse(
    gunzipSync(readFileSync(join(stylesDir, 'catalog.json.gz'))).toString('utf8'),
  ) as Catalog;
  const raw = new Map(catalog.styles.map((r) => [r.id, r]));
  const all: CatalogStyle[] = [];
  for (const record of catalog.styles) {
    const format = record.f ?? (record.p ? raw.get(record.p)?.f : undefined) ?? 'author-date';
    all.push({
      id: record.id,
      title: record.t,
      ...(record.s ? { shortTitle: record.s } : {}),
      family: familyOf(format),
      format,
      xmlId: record.p ?? record.id,
      ...(record.p ? { parent: record.p } : {}),
      ...(record.l ? { locale: record.l } : {}),
      selectable: true,
    });
  }
  loaded = { catalog, byId: new Map(all.map((s) => [s.id, s])), all };
  return loaded;
}

/** Where the catalogue came from, for the credit line and for fetching a style's XML. */
export function catalogSource(stylesDir: string): {
  commit: string;
  count: number;
  licence: string;
} {
  const { catalog } = load(stylesDir);
  return { commit: catalog.commit, count: catalog.count, licence: catalog.licence };
}

export function catalogStyle(id: string, stylesDir: string): CatalogStyle | null {
  return load(stylesDir).byId.get(id) ?? null;
}

/** How many styles a student can actually choose — all of them, since ADR-0029. */
export function selectableCount(stylesDir: string): number {
  return load(stylesDir).all.filter((s) => s.selectable).length;
}

const normalise = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Styles matching a query, best first.
 *
 * The order is what makes 10,000 entries usable: an exact title or id beats a title that starts
 * with the query, which beats one that merely contains every word of it. Among equals, an
 * independent style comes before the journals that borrow it, and a shorter title before a
 * longer one — "Nature" before "Nature Reviews Drug Discovery" for "nature".
 */
export function searchCatalog(query: string, stylesDir: string, limit = 30): CatalogStyle[] {
  const q = normalise(query);
  if (!q) return [];
  const words = q.split(' ');
  const scored: Array<{ style: CatalogStyle; score: number }> = [];
  for (const style of load(stylesDir).all) {
    const title = normalise(style.title);
    const short = style.shortTitle ? normalise(style.shortTitle) : '';
    const id = style.id.replace(/-/g, ' ');
    let score: number;
    if (title === q || short === q || id === q) score = 0;
    else if (title.startsWith(q) || short.startsWith(q) || id.startsWith(q)) score = 1;
    else if (words.every((w) => title.includes(w) || short.includes(w) || id.includes(w)))
      score = 2;
    else continue;
    scored.push({ style, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      Number(Boolean(a.style.parent)) - Number(Boolean(b.style.parent)) ||
      a.style.title.length - b.style.title.length ||
      a.style.title.localeCompare(b.style.title, 'en'),
  );
  return scored.slice(0, limit).map((s) => s.style);
}
