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
import { FALLBACK_LOCALE, isLocaleLoadable } from './locales.js';
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
  /**
   * R40 (ADR-0117): the run of citations this one sits in (`citationNodesIn`'s `run`) —
   * citations side by side in the text with nothing between them. Consecutive citations with the
   * same run are rendered by citeproc as **one** citation: "(Kumar, 2021; Rao, 2020)", "[3], [7]"
   * in IEEE, "(3–5)" in Vancouver, one footnote in a note style. Absent, a citation stands alone.
   */
  run?: string | null;
};

/** R40 (ADR-0117): citations side by side, rendered as one. */
export type CitationCluster = {
  /** The citation nodes' keys, in document order. Always two or more. */
  keys: string[];
  /**
   * citeproc's rendering of them as one citation, in the style's own order, delimiter and
   * collapsing. Printed once, where the first key is; the other keys print nothing. In a note
   * style, the note.
   */
  label: string;
};

export type RenderInput = {
  style?: string | null;
  sources: readonly SourceLike[];
  /** Document order: chapter order, then position within the chapter. */
  citations: readonly CitationRef[];
  /** `text` for the editor and the export; `html` when the caller renders markup. */
  format?: 'text' | 'html';
  /**
   * The CSL locale (ADR-0065): `citationLocaleFor(document.citationLocale, document.language)`.
   * Absent or null renders in the style's own locale, else en-US — the behaviour before the
   * choice existed.
   */
  locale?: string | null;
};

export type BibliographyEntry = { sourceId: string; text: string };

export type RenderResult = {
  style: StyleEntry;
  /**
   * `nodeKey` → the label the NodeView shows, e.g. `(Kumar, 2021)` or `[7]`. For a citation in a
   * cluster, the label it would have standing alone: what the editor shows for the moment between
   * an edit that splits the cluster and the next render (ADR-0117). Print a cluster through
   * `clusters`, never by joining these.
   */
  labels: Record<string, string>;
  /** R40 (ADR-0117): every run of two or more citations, rendered as one citation. */
  clusters: CitationCluster[];
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
  /** The locale citeproc was given: the caller's, else the style's own, else en-US. */
  locale: string;
  /**
   * False for a style with no bibliography by design ("notes without bibliography": the notes
   * give the full reference). `bibliography` is then always empty, however much is cited.
   */
  hasBibliography: boolean;
};

type CiteprocEngine = {
  rebuildProcessorState: (
    clusters: Array<Record<string, unknown>>,
    format: string,
    uncited: string[],
  ) => Array<[string, number, string]>;
  /**
   * `false` when the style has no `<bibliography>` at all — a "notes without bibliography" style
   * such as Chicago 18th `chicago-notes`, whose every note carries the full reference.
   */
  makeBibliography: () => [{ entry_ids: string[][] }, string[]] | false;
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
  const styleId = ensureRegistered(style, stylesDir);
  const noteStyle = isNoteStyle(style, stylesDir);
  const hasBibliography = declaresBibliography(style, stylesDir);

  const missing = new Set<string>();
  const used: CitationRef[] = [];
  const groups = groupCitations(input.citations, known, noteStyle, missing, used);
  // A journal style can declare its own locale (a German journal's "Hrsg."); the caller's wins.
  // One citeproc cannot load (a catalogue journal's pt-BR or de-CH) is not passed on: the plugin
  // drops an unknown id and citeproc then throws reading the missing locale's terms, so those
  // journal styles failed to render at all before ADR-0065. They render with en-US terms instead.
  const requested = input.locale || style.locale || FALLBACK_LOCALE;
  const locale = isLocaleLoadable(requested) ? requested : FALLBACK_LOCALE;

  const empty: RenderResult = {
    style,
    labels: {},
    clusters: [],
    bibliography: [],
    missingSourceIds: [...missing],
    noteStyle,
    locale,
    hasBibliography,
  };
  if (used.length === 0) return empty;

  // Only the cited sources go to the engine: an uncited source must not take a number.
  const citedIds = new Set(used.map((c) => c.sourceId));
  const data = [...citedIds].map((id) => toCslItem(known.get(id) as SourceLike));

  const format = input.format ?? 'text';
  // citation-js keeps one engine per style and locale (`fetchEngine` in plugin-csl's
  // `engines.js`), so the second pass below reuses this object: everything this pass yields —
  // the labels and the bibliography — is read before that pass starts.
  const engine = config().engine(data, styleId, locale, format);

  // One citeproc citation per group: a citation standing alone, or a run of them side by side.
  const rendered = engine.rebuildProcessorState(
    groups.map((group, index) => ({
      citationID: `c${index}`,
      citationItems: itemsOf(group),
      properties: {
        // In-text styles ignore it; a note style needs each citation's own footnote number.
        noteIndex: noteStyle ? (group[0]?.noteIndex ?? index + 1) : 0,
        // A narrative citation in an in-text style: author in the running text, year in
        // brackets. It never shares a group (`groupCitations`). A note style has no in-text form
        // to vary, so the role is left alone there.
        ...(group[0]?.role === 'narrative' && !noteStyle ? { mode: 'composite' } : {}),
      },
    })),
    format,
    [],
  );
  const labels: Record<string, string> = {};
  const clusters: CitationCluster[] = [];
  for (const [citationID, , text] of rendered) {
    const group = groups[Number(citationID.slice(1))];
    if (!group?.[0]) continue;
    if (group.length === 1) labels[group[0].key] = clean(text);
    else clusters.push({ keys: group.map((c) => c.key), label: clean(text) });
  }

  // QA 2026-10-09: citeproc answers `false`, not an empty list, for a style with no
  // <bibliography> element. Destructuring that threw "boolean false is not iterable", so choosing
  // Chicago 18th "notes without bibliography" turned every chapter with a citation into a 500.
  const made = engine.makeBibliography();
  const bibliography: BibliographyEntry[] = made
    ? made[1].map((text, i) => ({
        sourceId: made[0].entry_ids[i]?.[0] ?? '',
        text: clean(text),
      }))
    : [];

  // The second pass, only when there is a cluster: every citation alone, as before ADR-0117, for
  // the label a clustered citation shows if an edit takes its neighbour away before the next
  // render. Never printed: the export prints `clusters`.
  if (clusters.length > 0) {
    const alone = engine.rebuildProcessorState(
      used.map((citation, index) => ({
        citationID: `a${index}`,
        citationItems: itemsOf([citation]),
        properties: {
          noteIndex: noteStyle ? (citation.noteIndex ?? index + 1) : 0,
          ...(citation.role === 'narrative' && !noteStyle ? { mode: 'composite' } : {}),
        },
      })),
      format,
      [],
    );
    for (const [citationID, , text] of alone) {
      const key = used[Number(citationID.slice(1))]?.key;
      if (key && !(key in labels)) labels[key] = clean(text);
    }
  }

  return {
    style,
    labels,
    clusters,
    bibliography,
    missingSourceIds: [...missing],
    noteStyle,
    locale,
    hasBibliography,
  };
}

/**
 * Document order → the citations citeproc renders, each a list of one or more.
 *
 * Consecutive citations with the same `run` share a group, except that a group never takes:
 *  - a citation whose source is not in the library. It is left out of the engine (citeproc throws
 *    on an unknown id) and the editor draws it red on its own, so it ends the group before it;
 *  - in an in-text style, a narrative citation. "Kumar (2021)" is part of the sentence, not a
 *    bracket that another citation could join.
 *
 * Fills `missing` and `used` (every renderable citation, in order) on the way.
 */
function groupCitations(
  citations: readonly CitationRef[],
  known: ReadonlyMap<string, SourceLike>,
  noteStyle: boolean,
  missing: Set<string>,
  used: CitationRef[],
): CitationRef[][] {
  const groups: CitationRef[][] = [];
  // The citation before, when another may join its group.
  let open: CitationRef | null = null;
  for (const citation of citations) {
    if (!known.has(citation.sourceId)) {
      missing.add(citation.sourceId);
      open = null;
      continue;
    }
    used.push(citation);
    const alone = !noteStyle && citation.role === 'narrative';
    const group = groups[groups.length - 1];
    if (open && group && !alone && citation.run && citation.run === open.run) group.push(citation);
    else groups.push([citation]);
    open = alone ? null : citation;
  }
  return groups;
}

type CiteItem = { id: string; locator?: string; prefix?: string; suffix?: string };

/**
 * One citeproc item per source in a group. The same paper twice in one bracket — "Cite here"
 * pressed twice, or two passages of one paper — is one item, with both pages: citeproc would
 * otherwise print "(Kumar, 2021, 2021)" or "(2,2)". An affix the student typed on either keeps
 * them apart, since it says something about each.
 */
function itemsOf(group: readonly CitationRef[]): CiteItem[] {
  const items: CiteItem[] = [];
  const pages = new Map<CiteItem, string[]>();
  for (const citation of group) {
    const plain = !citation.prefix && !citation.suffix;
    const same = plain
      ? items.find((item) => item.id === citation.sourceId && !item.prefix && !item.suffix)
      : undefined;
    if (same) {
      const list = pages.get(same) ?? [];
      if (citation.locator && !list.includes(citation.locator)) list.push(citation.locator);
      pages.set(same, list);
      continue;
    }
    const item: CiteItem = {
      id: citation.sourceId,
      ...(citation.prefix ? { prefix: citation.prefix } : {}),
      ...(citation.suffix ? { suffix: citation.suffix } : {}),
    };
    pages.set(item, citation.locator ? [citation.locator] : []);
    items.push(item);
  }
  return items.map((item) => {
    const locator = (pages.get(item) ?? []).join(', ');
    return locator ? { ...item, locator } : item;
  });
}

/** Where a clustered citation stands in its cluster (ADR-0117). */
export type ClusterPlace = {
  cluster: CitationCluster;
  /** The first key prints the cluster's label; every other key prints nothing. */
  first: boolean;
};

/** Every clustered key → its cluster, for a walker that meets the keys one node at a time. */
export function clusterPlaces(
  clusters: readonly CitationCluster[] | undefined,
): ReadonlyMap<string, ClusterPlace> {
  const places = new Map<string, ClusterPlace>();
  for (const cluster of clusters ?? []) {
    cluster.keys.forEach((key, index) => {
      places.set(key, { cluster, first: index === 0 });
    });
  }
  return places;
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

const withBibliography = new Map<string, boolean>();

/** Whether a style has a `<bibliography>` at all; "notes without bibliography" styles do not. */
export function declaresBibliography(style: StyleEntry, stylesDir?: string): boolean {
  const known = withBibliography.get(style.id);
  if (known !== undefined) return known;
  const has = /<bibliography[\s>]/.test(styleXml(style, stylesDir));
  withBibliography.set(style.id, has);
  return has;
}
