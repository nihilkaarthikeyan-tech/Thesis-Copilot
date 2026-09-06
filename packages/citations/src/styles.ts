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

export type StyleFamily = 'numeric' | 'author-date' | 'note';

export type StyleEntry = {
  /** Stored on the document; never changes once a document uses it. */
  readonly id: string;
  /** What the student picks from a list. */
  readonly label: string;
  readonly family: StyleFamily;
  /** File in `packages/citations/styles/`. */
  readonly file: string;
  /** Shown under the label when the style needs a word of explanation. */
  readonly note?: string;
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

export function findStyle(id: string): StyleEntry | null {
  return byId.get(id) ?? null;
}

export function isKnownStyle(id: string): boolean {
  return byId.has(id);
}

/** The style to render with: the requested one, or the default when it is unknown. */
export function resolveStyle(id: string | null | undefined): StyleEntry {
  return (id && byId.get(id)) || (byId.get(DEFAULT_STYLE) as StyleEntry);
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

const xmlCache = new Map<string, string>();

/** The CSL XML for a style, read once per process. */
export function styleXml(entry: StyleEntry, dir: string = STYLES_DIR): string {
  const cached = xmlCache.get(entry.id);
  if (cached) return cached;
  const xml = readFileSync(join(dir, entry.file), 'utf8');
  xmlCache.set(entry.id, xml);
  return xml;
}
