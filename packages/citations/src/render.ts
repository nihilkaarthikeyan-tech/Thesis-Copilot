/**
 * citeproc rendering — PRD FR-5.2, FR-5.3, PHASES v2 W10.1.
 *
 *   "Rendered map (key → label) recomputed on save and style change; numeric ordering across
 *    chapters."
 *
 * One engine renders the whole document in one pass: every citation cluster in document order,
 * then the bibliography. That is what makes a numeric style correct — `[7]` is the seventh
 * distinct source *as read*, across chapters, and the bibliography comes back in the same order
 * the numbers were assigned. Rendering citation by citation (the shape citation-js's own
 * formatter offers) gives a bibliography ordered by whatever order the sources were loaded in,
 * which does not match the labels.
 *
 * The renderer is pure: it takes sources and an ordered list of citations, and returns strings.
 * Nothing here reads the database or the document; the caller supplies document order.
 */

import { plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import { type CslItem, type SourceLike, toCslItem } from './csl.js';
import { DEFAULT_STYLE, resolveStyle, type StyleEntry, styleXml } from './styles.js';

/** One citation node, in the order it appears in the document. */
export type CitationRef = {
  /** `Citation.nodeKey` — what the editor's NodeView looks its label up by. */
  key: string;
  sourceId: string;
  /** CSL locator, e.g. a page number (B.5's `locator`). */
  locator?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  /**
   * `narrative` puts the author in the sentence and only the year in brackets — "Kumar (2021)
   * found…" — through citeproc's composite mode; `parenthetical` (the default) is "(Kumar,
   * 2021)". FR-5.6's role rewrite set the attribute for a year while the renderer ignored it, so
   * every narrative citation still read "(Kumar, 2021) found…" (ADR-0045).
   */
  role?: 'parenthetical' | 'narrative' | string | null;
  /**
   * The footnote this citation sits in, counted through the thesis with the student's own notes.
   * Only a note style reads it: it is how citeproc knows to write the short form, or "Ibid.",
   * for a source the previous note already cited. Absent, each citation is its own next note.
   */
  noteIndex?: number;
};

export type RenderInput = {
  style?: string | null;
  sources: readonly SourceLike[];
  /** Document order: chapter order, then position within the chapter. */
  citations: readonly CitationRef[];
  /** `text` for the editor and the export; `html` when the caller renders markup. */
  format?: 'text' | 'html';
  locale?: string;
};

export type BibliographyEntry = { sourceId: string; text: string };

export type RenderResult = {
  style: StyleEntry;
  /** `nodeKey` → the label the NodeView shows, e.g. `(Kumar, 2021)` or `[7]`. */
  labels: Record<string, string>;
  /** In the order the style puts them: citation order for numeric, alphabetical otherwise. */
  bibliography: BibliographyEntry[];
  /** Cited sources that are not in `sources` — an orphaned citation node (B.5). */
  missingSourceIds: string[];
  /**
   * A note style (Chicago notes, OSCOLA…): every citation is a footnote, and `labels` holds the
   * note's text rather than an in-text label. The editor then shows a note number, and every
   * exporter writes the citation as a footnote (ADR-0029).
   */
  noteStyle: boolean;
};

type CiteprocEngine = {
  rebuildProcessorState: (
    clusters: Array<Record<string, unknown>>,
    format: string,
    uncited: string[],
  ) => Array<[string, number, string]>;
  makeBibliography: () => [{ entry_ids: string[][] }, string[]];
};

type CslConfig = {
  engine: (data: CslItem[], style: string, locale: string, format: string) => CiteprocEngine;
  styles: { has: (id: string) => boolean; add: (id: string, xml: string) => void };
};

function config(): CslConfig {
  return plugins.config.get('@csl') as unknown as CslConfig;
}

/** Registers a style's XML with citation-js the first time it is used. */
function ensureRegistered(entry: StyleEntry, stylesDir?: string): string {
  const csl = config();
  if (!csl.styles.has(entry.id)) csl.styles.add(entry.id, styleXml(entry, stylesDir));
  return entry.id;
}

/** Strips the wrapper citeproc puts around each bibliography entry in text output. */
const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Renders every citation and the bibliography in one pass.
 *
 * A citation whose source is not in `sources` is left out of the engine entirely — citeproc
 * throws on an unknown id — and reported in `missingSourceIds` so the caller can show it as the
 * orphan it is rather than a broken render.
 */
export function renderCitations(input: RenderInput, stylesDir?: string): RenderResult {
  const style = resolveStyle(input.style ?? DEFAULT_STYLE);
  const known = new Map(input.sources.map((s) => [s.id, s]));
  const missing = new Set<string>();
  const used: CitationRef[] = [];
  for (const citation of input.citations) {
    if (known.has(citation.sourceId)) used.push(citation);
    else missing.add(citation.sourceId);
  }

  const styleId = ensureRegistered(style, stylesDir);
  const noteStyle = isNoteStyle(style, stylesDir);

  const empty: RenderResult = {
    style,
    labels: {},
    bibliography: [],
    missingSourceIds: [...missing],
    noteStyle,
  };
  if (used.length === 0) return empty;

  // Only the cited sources go to the engine: an uncited source must not take a number.
  const citedIds = new Set(used.map((c) => c.sourceId));
  const data = [...citedIds].map((id) => toCslItem(known.get(id) as SourceLike));

  const format = input.format ?? 'text';
  // A journal style can declare its own locale (a German journal's "Hrsg."); the caller's wins.
  const engine = config().engine(data, styleId, input.locale ?? style.locale ?? 'en-US', format);

  const clusters = used.map((citation, index) => ({
    citationID: `c${index}`,
    citationItems: [
      {
        id: citation.sourceId,
        ...(citation.locator ? { locator: citation.locator } : {}),
        ...(citation.prefix ? { prefix: citation.prefix } : {}),
        ...(citation.suffix ? { suffix: citation.suffix } : {}),
      },
    ],
    properties: {
      // In-text styles ignore it; a note style needs each citation's own footnote number.
      noteIndex: noteStyle ? (citation.noteIndex ?? index + 1) : 0,
      // A narrative citation in an in-text style: author in the running text, year in brackets.
      // A note style has no in-text form to vary, so the role is left alone there.
      ...(citation.role === 'narrative' && !noteStyle ? { mode: 'composite' } : {}),
    },
  }));

  const rendered = engine.rebuildProcessorState(clusters, format, []);
  const labels: Record<string, string> = {};
  for (const [citationID, , text] of rendered) {
    const index = Number(citationID.slice(1));
    const key = used[index]?.key;
    if (key) labels[key] = clean(text);
  }

  const [meta, entries] = engine.makeBibliography();
  const bibliography: BibliographyEntry[] = entries.map((text, i) => ({
    sourceId: meta.entry_ids[i]?.[0] ?? '',
    text: clean(text),
  }));

  return { style, labels, bibliography, missingSourceIds: [...missing], noteStyle };
}

const noteStyles = new Map<string, boolean>();

/** Whether a style writes its citations as footnotes: CSL says so in `class="note"`. */
export function isNoteStyle(style: StyleEntry, stylesDir?: string): boolean {
  const known = noteStyles.get(style.id);
  if (known !== undefined) return known;
  const xml = styleXml(style, stylesDir);
  const head = /<style\b[^>]*>/.exec(xml)?.[0] ?? '';
  const note = /\bclass\s*=\s*["']note["']/.test(head);
  noteStyles.set(style.id, note);
  return note;
}
