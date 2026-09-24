/**
 * The style registry — PRD FR-5.2, PHASES v2 W10.1.
 *
 * Twenty styles, each an independent CSL 1.0.2 file in `packages/citations/styles/` (see the
 * README there for provenance and licence). A style is identified by its short id everywhere:
 * `Document.citationStyle` stores it, the editor's NodeView renders by it, and the export uses
 * the same one, so a switch cannot make the body and the bibliography disagree.
 *
 * `family` is what the UI needs to explain the switch: a numeric style renumbers the whole
 * document, an author-date style does not.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CatalogStyle, catalogStyle } from './catalog.js';

export type StyleFamily = 'numeric' | 'author-date' | 'note';

export type StyleEntry = {
  /** Stored on the document; never changes once a document uses it. */
  readonly id: string;
  /** What the student picks from a list. */
  readonly label: string;
  readonly family: StyleFamily;
  /** File in `packages/citations/styles/`, for the styles this package ships. */
  readonly file?: string;
  /** Shown under the label when the style needs a word of explanation. */
  readonly note?: string;
  /**
   * For a style from the catalogue: the independent CSL style whose XML renders it — itself, or,
   * for a journal's dependent style, the parent it borrows. Its XML is fetched and registered by
   * the API before anything renders with it (`registerStyleXml`).
   */
  readonly xmlId?: string;
  /** The style's own default locale, when it declares one other than en-US. */
  readonly locale?: string;
};

/**
 * PHASES v2 W10.1 names ten; the other ten are the common ones in Indian engineering, medical and
 * social-science departments. The human replaces or reorders them once the pilot universities are
 * named (`docs/PENDING.md`); the two `in-university-*` entries are deliberate placeholders.
 */
export const STYLES: readonly StyleEntry[] = [
  { id: 'apa', label: 'APA 7th', family: 'author-date', file: 'apa.csl' },
  { id: 'ieee', label: 'IEEE', family: 'numeric', file: 'ieee.csl' },
  {
    id: 'harvard',
    label: 'Harvard (Cite Them Right)',
    family: 'author-date',
    file: 'harvard-cite-them-right.csl',
  },
  {
    id: 'chicago-author-date',
    label: 'Chicago (author–date)',
    family: 'author-date',
    file: 'chicago-author-date.csl',
  },
  { id: 'vancouver', label: 'Vancouver', family: 'numeric', file: 'vancouver.csl' },
  {
    id: 'mla',
    label: 'MLA 9th',
    family: 'author-date',
    file: 'modern-language-association.csl',
  },
  {
    id: 'acm',
    label: 'ACM',
    family: 'numeric',
    file: 'association-for-computing-machinery.csl',
  },
  {
    id: 'springer',
    label: 'Springer (author–date)',
    family: 'author-date',
    file: 'springer-basic-author-date.csl',
  },
  {
    id: 'elsevier-harvard',
    label: 'Elsevier (Harvard)',
    family: 'author-date',
    file: 'elsevier-harvard.csl',
  },
  { id: 'nature', label: 'Nature', family: 'numeric', file: 'nature.csl' },
  {
    id: 'ama',
    label: 'AMA (American Medical Association)',
    family: 'numeric',
    file: 'american-medical-association.csl',
  },
  {
    id: 'acs',
    label: 'ACS (American Chemical Society)',
    family: 'numeric',
    file: 'american-chemical-society.csl',
  },
  {
    id: 'aip',
    label: 'AIP (American Institute of Physics)',
    family: 'numeric',
    file: 'american-institute-of-physics.csl',
  },
  {
    id: 'asa',
    label: 'ASA (American Sociological Association)',
    family: 'author-date',
    file: 'american-sociological-association.csl',
  },
  { id: 'bmj', label: 'BMJ', family: 'numeric', file: 'bmj.csl' },
  { id: 'cell', label: 'Cell', family: 'author-date', file: 'cell.csl' },
  { id: 'science', label: 'Science', family: 'numeric', file: 'science.csl' },
  {
    id: 'rsc',
    label: 'RSC (Royal Society of Chemistry)',
    family: 'numeric',
    file: 'royal-society-of-chemistry.csl',
  },
  { id: 'sage-harvard', label: 'SAGE Harvard', family: 'author-date', file: 'sage-harvard.csl' },
  {
    id: 'elsevier-vancouver',
    label: 'Elsevier (Vancouver)',
    family: 'numeric',
    file: 'elsevier-vancouver.csl',
  },
  {
    id: 'IN_UNIVERSITY_NUMERIC',
    label: 'My university (numeric)',
    family: 'numeric',
    file: 'in-university-numeric.csl',
    note: 'Placeholder: IEEE until your university names its own rules.',
  },
  {
    id: 'IN_UNIVERSITY_AUTHOR_DATE',
    label: 'My university (author–date)',
    family: 'author-date',
    file: 'in-university-author-date.csl',
    note: 'Placeholder: APA 7th until your university names its own rules.',
  },
];

/** PRD §8: `Document.citationStyle` defaults to `apa`. */
export const DEFAULT_STYLE = 'apa';

const byId = new Map(STYLES.map((s) => [s.id, s]));

function fromCatalog(style: CatalogStyle): StyleEntry {
  return {
    id: style.id,
    label: style.title,
    family: style.family,
    xmlId: style.xmlId,
    ...(style.locale ? { locale: style.locale } : {}),
    ...(style.parent ? { note: `Uses the rules of ${style.parent}.` } : {}),
  };
}

/**
 * A style by id: one of the twenty this package ships, or any selectable style in the catalogue.
 * Null for an unknown id — and for a footnote style, which cannot be rendered correctly yet.
 */
export function findStyle(id: string): StyleEntry | null {
  const bundled = byId.get(id);
  if (bundled) return bundled;
  const catalogued = catalogStyle(id, STYLES_DIR);
  return catalogued?.selectable ? fromCatalog(catalogued) : null;
}

export function isKnownStyle(id: string): boolean {
  return findStyle(id) !== null;
}

/** The style to render with: the requested one, or the default when it is unknown. */
export function resolveStyle(id: string | null | undefined): StyleEntry {
  return (id && findStyle(id)) || (byId.get(DEFAULT_STYLE) as StyleEntry);
}

const here = fileURLToPath(new URL('.', import.meta.url));

/** `styles/` sits beside `src/` in the source tree and beside `dist/` in a build. */
function findStylesDir(from: string): string {
  let dir = from;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'styles');
    if (existsSync(candidate)) return candidate;
    dir = join(dir, '..');
  }
  throw new Error(`Could not locate packages/citations/styles starting from ${from}`);
}

export const STYLES_DIR = findStylesDir(here);

/** CSL XML by independent style id — the shipped files once read, and fetched ones registered. */
const xmlCache = new Map<string, string>();

/** The independent CSL id whose XML renders an entry. */
function xmlIdOf(entry: StyleEntry): string {
  return entry.xmlId ?? entry.file?.replace(/\.csl$/, '') ?? entry.id;
}

/** Thrown when a catalogue style is rendered before the API has fetched and registered its XML. */
export class StyleNotLoadedError extends Error {
  constructor(readonly styleId: string) {
    super(`The XML for citation style "${styleId}" has not been loaded.`);
    this.name = 'StyleNotLoadedError';
  }
}

/** Makes a fetched style renderable in this process. The caller has already checked the XML. */
export function registerStyleXml(xmlId: string, xml: string): void {
  xmlCache.set(xmlId, xml);
}

/**
 * Whether rendering with this entry needs its XML fetched first: false for a shipped style, for a
 * journal whose parent is one of them, and for anything already registered.
 */
export function needsStyleXml(entry: StyleEntry, dir: string = STYLES_DIR): boolean {
  const xmlId = xmlIdOf(entry);
  if (xmlCache.has(xmlId)) return false;
  if (entry.file) return false;
  return !existsSync(join(dir, `${xmlId}.csl`));
}

/** The CSL XML for a style, read once per process. */
export function styleXml(entry: StyleEntry, dir: string = STYLES_DIR): string {
  const xmlId = xmlIdOf(entry);
  const cached = xmlCache.get(xmlId);
  if (cached) return cached;
  // A shipped file — the style's own, or the parent a catalogued journal borrows. Hundreds of
  // journals use one of the twenty (Elsevier Harvard, APA, Vancouver…) and need nothing fetched.
  const file = entry.file ?? `${xmlId}.csl`;
  const path = join(dir, file);
  if (!existsSync(path)) throw new StyleNotLoadedError(entry.id);
  const xml = readFileSync(path, 'utf8');
  xmlCache.set(xmlId, xml);
  return xml;
}
