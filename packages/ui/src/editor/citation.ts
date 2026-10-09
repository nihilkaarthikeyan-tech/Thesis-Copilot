/**
 * Citation node — PRD Appendix B.5, FR-5.x.
 *
 * An inline atom whose attrs are the ONLY citation state in the document (B.2 rule). The label is
 * NOT stored: a NodeView reads `editor.storage.citations` (style + renderedMap) and re-renders when
 * a transaction carries `citationsRerender` meta, so switching APA → IEEE never touches the doc.
 *
 * Week 1 ships a placeholder renderer; `packages/citations` (citeproc) replaces it in Phase 2.
 */

import { mergeAttributes, Node } from '@tiptap/core';
import { DOMSerializer, Fragment, type Node as PmNode, Slice } from '@tiptap/pm/model';
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { nanoid } from 'nanoid';
import { sourceMetricBadges } from './source-metrics.js';

export type CitationAttrs = {
  key: string;
  sourceId: string | null;
  chunkId: string | null;
  role: 'parenthetical' | 'narrative';
  locator: string | null;
  prefix: string | null;
  suffix: string | null;
};

/** What the hover popover shows: the passage a citation stands on (PHASES 3.5). */
export type CitationPassage = {
  text: string;
  page: number | null;
  section: string | null;
  shortRef: string;
  /** Signed PDF link, when the source has a file. The popover appends `#page=N`. */
  pdfUrl: string | null;
  /**
   * The paper itself (2026-09-30): what a reader needs to check that the citation is real —
   * title, authors, year, journal, a DOI link — and whether we read the whole paper or only its
   * abstract. A reviewer found Jenni citing papers that could not be confirmed; every citation
   * here names a record anyone can open.
   */
  record?: {
    title: string | null;
    authors: string | null;
    year: number | null;
    venue: string | null;
    doi: string | null;
    /** `FULL_TEXT` or `ABSTRACT`: what the citation could have been drawn from. */
    grounding: string | null;
    /**
     * Coverage map rows 21, 32, 46: what was fetched about the paper when it was looked up.
     * Optional and null alike mean "not known", and show no badge — never a 0. Render them with
     * `sourceMetricBadges(record)`, which gives the wording and the tooltips.
     */
    /** Times cited (OpenAlex `cited_by_count`, or Crossref's count when OpenAlex lacked it). */
    citedByCount?: number | null;
    /** Free to read (true), closed (false), not known (null). */
    openAccess?: boolean | null;
    /** The open-access route as OpenAlex / Unpaywall name it: `gold`, `green`, `closed` … */
    oaStatus?: string | null;
    /** The journal's 2-year mean citedness, from OpenAlex (ADR-0022). Not an impact factor. */
    journalCitedness?: number | null;
  };
};

export type CitationOptions = {
  /**
   * Fetches the passage behind a citation. Wired by the app to `GET /sources/:id/chunks/:chunkId`.
   * Absent (tests, the bare extension) means no popover, only the title tooltip.
   */
  resolvePassage?: (sourceId: string, chunkId: string | null) => Promise<CitationPassage | null>;
  /** Hover delay before the popover is fetched and shown. */
  hoverDelayMs?: number;
  /**
   * "Read beside" (2026-10-04): opens the source's PDF in a pane next to the chapter. The popover
   * offers it beside "Open PDF" when this is set and `canReadBeside` (if given) says the screen
   * is wide enough; otherwise only the new-tab link shows, as before.
   */
  readBeside?: (target: {
    sourceId: string;
    page: number | null;
    label: string;
    /** R21 (ADR-0108): the cited passage, so the pane opens on it, marked. */
    quote?: string | null;
  }) => void;
  canReadBeside?: () => boolean;
  /**
   * ADR-0068: the address of the app's paper reader for a source, opened at the cited page. When
   * set, the popover offers "Open in reader" for every citation — with or without a PDF, since
   * the reader shows the text we hold either way — at the cited page, with the passage marked.
   */
  readerHref?: (sourceId: string, page: number | null, chunkId: string | null) => string;
};

export type CitationStorage = {
  style: string;
  /** key → rendered label, e.g. "(Kumar et al., 2021)" or "[12]". */
  renderedMap: Record<string, string>;
  /** Sources no longer in the library: rendered red-dashed, never auto-deleted (B.5). */
  removedSourceIds: Set<string>;
  /** Placeholder metadata for the hover popover shell (title/year) until Phase 2. */
  meta: Record<string, { title?: string; year?: number }>;
  /**
   * ADR-0029: a note style. A citation then shows as a footnote number — counted with the
   * student's own footnotes — and `renderedMap` holds the note's text, shown on hover.
   */
  noteStyle: boolean;
  /**
   * The style's labels are numbers (`[7]`): the placeholder a brand-new node shows for the frame
   * before its real label arrives is shaped to match. Set from the server's `styleFamily`, so a
   * catalogue style the bundled list does not know is placed right too.
   */
  numeric: boolean;
  /**
   * R40 (ADR-0117): citations side by side that the server rendered as one — "(Kumar, 2021; Rao,
   * 2020)" — by their node keys joined with a space, each with that one label. While the nodes
   * are still side by side in that order, the first shows the label and the others nothing;
   * once an edit parts them, each shows its own label until the next render.
   */
  clusters: Map<string, string>;
};

/** One cluster as the server sends it (`clusters` of `GET /documents/:id/citations`). */
export type CitationClusterLabel = { keys: readonly string[]; label: string };

export const CITATIONS_RERENDER = 'citationsRerender';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: Partial<CitationAttrs> & { sourceId: string | null }) => ReturnType;
      /**
       * Swap style / labels and re-render every citation without touching the document.
       * `clusters` (ADR-0117) are the runs of citations side by side rendered as one; omitted,
       * there are none.
       */
      setCitationStyle: (
        style: string,
        renderedMap: Record<string, string>,
        noteStyle?: boolean,
        numeric?: boolean,
        clusters?: readonly CitationClusterLabel[],
      ) => ReturnType;
      markSourceRemoved: (sourceId: string) => ReturnType;
      /** Gives every citation after the first with the same key a fresh key (ADR-0045). */
      dedupeCitationKeys: () => ReturnType;
    };
  }
}

export function newCitationKey(): string {
  return `c_${nanoid(10)}`;
}

/**
 * Bundled styles whose labels are numbers — the fallback until the server has said which family
 * the current style is in (`storage.numeric`); the registry in `@tc/citations` is the full list.
 */
const NUMERIC_PLACEHOLDER = new Set([
  'ieee',
  'vancouver',
  'nature',
  'acm',
  'ama',
  'acs',
  'aip',
  'bmj',
  'science',
  'rsc',
  'elsevier-vancouver',
  'IN_UNIVERSITY_NUMERIC',
]);

function labelFor(node: PmNode, storage: CitationStorage): string {
  const key = String(node.attrs.key);
  const rendered = storage.renderedMap[key];
  if (rendered) return rendered;
  // No label yet: the render is a round trip (GET /documents/:id/citations), so a citation
  // inserted this second shows a placeholder for one frame. Shaped like the style so the line
  // does not reflow when the real label arrives.
  return storage.numeric || NUMERIC_PLACEHOLDER.has(storage.style) ? '[·]' : '(Source, n.d.)';
}

/** The data attributes a citation carries in HTML, so a paste inside the app restores it. */
function citationDomAttrs(a: CitationAttrs): Record<string, string | null> {
  return {
    'data-citation': '',
    'data-key': a.key,
    'data-source-id': a.sourceId,
    'data-chunk-id': a.chunkId,
    'data-role': a.role,
    'data-locator': a.locator,
    'data-prefix': a.prefix,
    'data-suffix': a.suffix,
  };
}

/**
 * The label a citation reads as outside the app. A note style's citation shows nothing in the
 * line, so a copy carries its note text in brackets rather than vanishing.
 */
function copiedLabel(node: PmNode, storage: CitationStorage): string {
  if (storage.noteStyle) {
    const note = storage.renderedMap[String(node.attrs.key)];
    return note ? ` [${note}]` : '';
  }
  return labelFor(node, storage);
}

// ---------------------------------------------------------------------------------------------
// R40 (ADR-0117): citations side by side
// ---------------------------------------------------------------------------------------------

/** A cluster from the server whose nodes are still side by side, in order, in this document. */
export type LiveCitationCluster = {
  /** The node keys, joined with a space: the key of `CitationStorage.clusters`. */
  id: string;
  keys: string[];
  /** Each node's position, in document order. */
  positions: number[];
};

/**
 * The server's clusters that still hold in `doc`: every key present, side by side in one
 * paragraph in the server's order, with nothing between, and no source removed from the library
 * (a removed one is drawn red on its own, B.5). Anything else — a citation typed between, one
 * deleted, one added at the end — and the nodes show their own labels until the next render.
 */
export function liveCitationClusters(
  doc: PmNode,
  storage: Pick<CitationStorage, 'clusters' | 'removedSourceIds'>,
): LiveCitationCluster[] {
  if (storage.clusters.size === 0) return [];
  const where = new Map<string, { parent: number; index: number; pos: number; ok: boolean }>();
  let parent = 0;
  doc.descendants((node, pos) => {
    if (!node.inlineContent) return true;
    parent++;
    node.forEach((child, offset, index) => {
      if (child.type.name !== 'citation') return;
      const sourceId = child.attrs.sourceId as string | null;
      where.set(String(child.attrs.key), {
        parent,
        index,
        pos: pos + 1 + offset,
        ok: sourceId !== null && !storage.removedSourceIds.has(sourceId),
      });
    });
    return false;
  });
  const live: LiveCitationCluster[] = [];
  for (const id of storage.clusters.keys()) {
    const keys = id.split(' ');
    const first = where.get(keys[0] ?? '');
    if (!first || keys.length < 2) continue;
    const found = keys.map((key) => where.get(key));
    const holds = found.every(
      (at, j) => at?.ok && at.parent === first.parent && at.index === first.index + j,
    );
    if (holds) live.push({ id, keys, positions: found.map((at) => at?.pos ?? 0) });
  }
  return live;
}

type ClusterState = { live: LiveCitationCluster[]; decorations: DecorationSet };

export const citationClustersKey = new PluginKey<ClusterState>('citationClusters');

/** What a citation's node decoration says about its place in a cluster. */
type ClusterSpec = { citationCluster: string; clusterIndex: number };

/**
 * One node decoration per clustered citation: the NodeView reads its place from the spec (a
 * string and a number, so an unchanged cluster compares equal and redraws nothing). The first
 * node of a cluster takes the selected look while any of its nodes is selected, since only the
 * first one shows anything.
 */
function clusterDecorations(state: EditorState, live: LiveCitationCluster[]): DecorationSet {
  if (live.length === 0) return DecorationSet.empty;
  const selection = state.selection;
  const selected =
    selection instanceof NodeSelection && selection.node.type.name === 'citation'
      ? selection.from
      : null;
  const decorations: Decoration[] = [];
  for (const cluster of live) {
    const chosen = selected !== null && cluster.positions.includes(selected);
    cluster.positions.forEach((pos, index) => {
      const spec: ClusterSpec = { citationCluster: cluster.id, clusterIndex: index };
      decorations.push(
        Decoration.node(
          pos,
          pos + 1,
          index === 0 && chosen ? { class: 'citation--cluster-selected' } : {},
          spec,
        ),
      );
    });
  }
  return DecorationSet.create(state.doc, decorations);
}

/** The whole bracket a node selection on one of a live cluster's nodes stands for. */
function clusterRangeAt(
  state: EditorState,
  selection: EditorState['selection'],
): { from: number; to: number } | null {
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'citation') {
    return null;
  }
  const cluster = citationClustersKey
    .getState(state)
    ?.live.find((c) => c.positions.includes(selection.from));
  const from = cluster?.positions[0];
  const last = cluster?.positions[cluster.positions.length - 1];
  return from === undefined || last === undefined ? null : { from, to: last + 1 };
}

/** A node view's place in a cluster, from the decorations ProseMirror hands it. */
function clusterSpecOf(decorations: readonly Decoration[]): ClusterSpec | null {
  for (const decoration of decorations) {
    const spec = decoration.spec as Partial<ClusterSpec> | undefined;
    if (typeof spec?.citationCluster === 'string' && typeof spec.clusterIndex === 'number') {
      return { citationCluster: spec.citationCluster, clusterIndex: spec.clusterIndex };
    }
  }
  return null;
}

/**
 * What each citation in a copied fragment reads as outside the app: a cluster that is whole in
 * the fragment reads as its one label ("(Kumar, 2021; Rao, 2020)"), at its first node, and its
 * other nodes as nothing. Keys not in the map read as their own label.
 */
function clusterCopyLabels(fragment: Fragment, storage: CitationStorage): Map<string, string> {
  const out = new Map<string, string>();
  if (storage.clusters.size === 0) return out;
  const match = (run: PmNode[]) => {
    const keys = run.map((node) => String(node.attrs.key));
    for (const [id, label] of storage.clusters) {
      const cluster = id.split(' ');
      const start = keys.indexOf(cluster[0] ?? '');
      if (start === -1 || !cluster.every((key, j) => keys[start + j] === key)) continue;
      cluster.forEach((key, j) => {
        out.set(key, j > 0 ? '' : storage.noteStyle ? ` [${label}]` : label);
      });
    }
  };
  const visit = (content: Fragment) => {
    let run: PmNode[] = [];
    const flush = () => {
      if (run.length > 1) match(run);
      run = [];
    };
    content.forEach((child) => {
      if (child.type.name === 'citation') {
        run.push(child);
        return;
      }
      flush();
      if (!child.isLeaf) visit(child.content);
    });
    flush();
  };
  visit(fragment);
  return out;
}

export const Citation = Node.create<CitationOptions, CitationStorage>({
  name: 'citation',

  addOptions() {
    return { hoverDelayMs: 250 };
  },
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addStorage() {
    return {
      style: 'apa',
      renderedMap: {},
      removedSourceIds: new Set<string>(),
      meta: {},
      noteStyle: false,
      numeric: false,
      clusters: new Map(),
    };
  },

  addAttributes() {
    return {
      key: { default: null },
      sourceId: { default: null },
      chunkId: { default: null },
      role: { default: 'parenthetical' },
      locator: { default: null },
      prefix: { default: null },
      suffix: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-citation]',
        getAttrs: (el) => {
          const e = el as HTMLElement;
          return {
            key: e.getAttribute('data-key'),
            sourceId: e.getAttribute('data-source-id'),
            chunkId: e.getAttribute('data-chunk-id'),
            role: e.getAttribute('data-role') ?? 'parenthetical',
            locator: e.getAttribute('data-locator'),
            prefix: e.getAttribute('data-prefix'),
            suffix: e.getAttribute('data-suffix'),
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as CitationAttrs;
    return [
      'span',
      mergeAttributes(HTMLAttributes, citationDomAttrs(a)),
      // Copy/paste within the app carries the attrs; the label is recomputed on paste.
      `{{cite:${a.key}}}`,
    ];
  },

  /**
   * What `doc.textBetween` yields for the node — the same marker the model is shown everywhere
   * else (B.3). Without it a citation inside a selection was the empty string: the command
   * toolbar sent the model text with no citations in it and then replaced the selection with
   * the answer, deleting every citation the student had placed there (ADR-0045).
   */
  renderText({ node }) {
    return `{{cite:${String(node.attrs.key)}}}`;
  },
  // `renderText` only feeds `editor.getText()`; ProseMirror's own `textBetween` reads the
  // schema's `leafText`, and TipTap 2 does not derive one from the other.
  extendNodeSchema(extension) {
    return extension.name === 'citation'
      ? { leafText: (node: PmNode) => `{{cite:${String(node.attrs.key)}}}` }
      : {};
  },

  /**
   * Copying out of the editor (2026-10-04, from the Jenni study: "Copy" keeps citations). A
   * copy pasted into Word, Google Docs or an email read `{{cite:c_9}}`; it now reads as the label
   * the student sees — "(Rao, 2021)" or "[3]". The HTML still carries the data attributes, so a
   * paste back into the editor restores the citation itself, as before.
   */
  addProseMirrorPlugins() {
    const storage = this.storage;
    const base = DOMSerializer.fromSchema(this.editor.schema);
    // ADR-0117: a cluster copied whole reads as its one label. The labels are worked out once
    // per copy, at the outermost fragment (the serializer recurses into every node's content).
    let copying: Map<string, string> | null = null;
    let depth = 0;
    class CitationCopySerializer extends DOMSerializer {
      override serializeFragment(
        fragment: Fragment,
        options?: { document?: Document },
        target?: HTMLElement | DocumentFragment,
      ): DocumentFragment | HTMLElement {
        if (depth === 0) copying = clusterCopyLabels(fragment, storage);
        depth++;
        try {
          return super.serializeFragment(fragment, options, target);
        } finally {
          depth--;
          if (depth === 0) copying = null;
        }
      }
    }
    const serializer = new CitationCopySerializer(
      {
        ...base.nodes,
        citation: (node: PmNode) => [
          'span',
          citationDomAttrs(node.attrs as CitationAttrs),
          copying?.get(String(node.attrs.key)) ?? copiedLabel(node, storage),
        ],
      },
      base.marks,
    );
    return [
      new Plugin({
        key: new PluginKey('citationClipboard'),
        props: {
          clipboardSerializer: serializer,
          clipboardTextSerializer: (slice) => {
            const clustered = clusterCopyLabels(slice.content, storage);
            return slice.content.textBetween(0, slice.content.size, '\n\n', (leaf) =>
              leaf.type.name === 'citation'
                ? (clustered.get(String(leaf.attrs.key)) ?? copiedLabel(leaf, storage))
                : (leaf.type.spec.leafText?.(leaf) ?? ''),
            );
          },
          /**
           * Jenni build plan R9: the paper reader's "Copy with citation" puts the label on the
           * citation it copies (`data-label`), so a paste shows the real label at once rather
           * than the placeholder until the next render.
           */
          transformPastedHTML: (html) => {
            if (!html.includes('data-label')) return html;
            const doc = new DOMParser().parseFromString(html, 'text/html');
            for (const el of Array.from(doc.querySelectorAll('span[data-citation][data-label]'))) {
              const key = el.getAttribute('data-key');
              const label = el.getAttribute('data-label');
              if (key && label && !storage.renderedMap[key]) storage.renderedMap[key] = label;
            }
            return html;
          },
          /**
           * R9: a citation pasted twice, or pasted where its key is already in the chapter, gets
           * a key of its own (keys are per node — ADR-0045), carrying its label with it.
           */
          transformPasted: (slice, view) => {
            const taken = new Set<string>();
            view.state.doc.descendants((node) => {
              if (node.type.name === 'citation') taken.add(String(node.attrs.key ?? ''));
            });
            const rekey = (fragment: Fragment): Fragment => {
              const nodes: PmNode[] = [];
              fragment.forEach((node) => {
                if (node.type.name === 'citation') {
                  const key = String(node.attrs.key ?? '');
                  if (!key || taken.has(key)) {
                    const fresh = newCitationKey();
                    const label = storage.renderedMap[key];
                    if (label) storage.renderedMap[fresh] = label;
                    taken.add(fresh);
                    nodes.push(node.type.create({ ...node.attrs, key: fresh }, null, node.marks));
                    return;
                  }
                  taken.add(key);
                  nodes.push(node);
                  return;
                }
                nodes.push(node.isLeaf ? node : node.copy(rekey(node.content)));
              });
              return Fragment.fromArray(nodes);
            };
            return new Slice(rekey(slice.content), slice.openStart, slice.openEnd);
          },
        },
      }),
      /**
       * R40 (ADR-0117): which citations are drawn as one. Recomputed when the document changes or
       * new labels arrive (`citationsRerender`), and the decorations again when the selection
       * moves, so the visible first node can show that a hidden one is selected.
       */
      new Plugin<ClusterState>({
        key: citationClustersKey,
        state: {
          init: (_, state) => {
            const live = liveCitationClusters(state.doc, storage);
            return { live, decorations: clusterDecorations(state, live) };
          },
          apply: (tr, value, _old, state) => {
            if (tr.docChanged || tr.getMeta(CITATIONS_RERENDER)) {
              const live = liveCitationClusters(state.doc, storage);
              return { live, decorations: clusterDecorations(state, live) };
            }
            if (tr.selectionSet && value.live.length > 0) {
              return { live: value.live, decorations: clusterDecorations(state, value.live) };
            }
            return value;
          },
        },
        /**
         * A pointer selection that lands on one node of a cluster — the browser's caret put
         * inside the bracket's label by a click between its lines, which ProseMirror reads as a
         * node selection — becomes the whole bracket, as a click on it does (QA 2026-10-09).
         */
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((tr) => tr.getMeta('pointer'))) return null;
          const range = clusterRangeAt(state, state.selection);
          if (!range) return null;
          return state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to));
        },
        props: {
          decorations: (state) => citationClustersKey.getState(state)?.decorations,
          /**
           * A click on a cluster selects all of it: the student sees one bracket, so Delete or
           * typing over it acts on the whole bracket. One source is removed from the hover card.
           */
          handleClickOn: (view, _pos, node, nodePos) => {
            if (node.type.name !== 'citation') return false;
            const cluster = citationClustersKey
              .getState(view.state)
              ?.live.find((c) => c.positions.includes(nodePos));
            const from = cluster?.positions[0];
            const last = cluster?.positions[cluster.positions.length - 1];
            if (from === undefined || last === undefined) return false;
            view.dispatch(
              view.state.tr.setSelection(TextSelection.create(view.state.doc, from, last + 1)),
            );
            return true;
          },
        },
      }),
    ];
  },

  addNodeView() {
    const editor = this.editor;
    const storage = this.storage;
    const options = this.options;

    return ({ node, getPos, decorations }) => {
      let current = node;
      // R40 (ADR-0117): the node's place in a cluster comes in its decorations.
      let place = clusterSpecOf(decorations);
      const dom = document.createElement('span');
      dom.className = 'citation';
      dom.setAttribute('data-citation', '');
      dom.setAttribute('contenteditable', 'false');
      // The popover is positioned against the citation, so showing it never reflows the line.
      // An inline popover shifts the citation out from under a stationary pointer, and Chrome
      // then fires mouseleave on the layout change — closing the popover it just opened.
      dom.style.position = 'relative';

      // PHASES 3.5: "hover popover shows the real passage; 'Open PDF at page'". The popover is a
      // child of the atom's own DOM, so ProseMirror's `ignoreMutation` covers it and nothing here
      // ever touches the document. Fetched on hover after a short delay, never on render.
      let popover: HTMLElement | null = null;
      let hoverTimer: ReturnType<typeof setTimeout> | null = null;
      let hoverToken = 0;
      let closeOnScroll: ((event: Event) => void) | null = null;

      /** The cluster this node shows, when it is the first node of one the server rendered. */
      const shownCluster = (): { id: string; keys: string[]; label: string } | null => {
        if (place?.clusterIndex !== 0) return null;
        const label = storage.clusters.get(place.citationCluster);
        return label === undefined
          ? null
          : { id: place.citationCluster, keys: place.citationCluster.split(' '), label };
      };
      /** A later node of a cluster: the first node shows the label for all of them. */
      const hiddenInCluster = (): boolean =>
        place !== null && place.clusterIndex > 0 && storage.clusters.has(place.citationCluster);

      const closePopover = () => {
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = null;
        hoverToken++;
        popover?.remove();
        popover = null;
        if (closeOnScroll) window.removeEventListener('scroll', closeOnScroll, true);
        closeOnScroll = null;
      };

      const popoverShell = (): HTMLElement => {
        const el = document.createElement('span');
        el.className = 'citation-popover';
        el.setAttribute('role', 'tooltip');
        el.setAttribute('contenteditable', 'false');
        // Out of the text flow (see above). Appearance beyond that belongs to the app's CSS.
        el.style.position = 'absolute';
        el.style.top = '100%';
        el.style.left = '0';
        el.style.zIndex = '20';
        el.style.display = 'block';
        el.style.whiteSpace = 'normal';
        el.style.width = '22rem';
        return el;
      };

      /** The card for one citation: its paper, its passage, and the ways to open them. */
      const fillPassage = (el: HTMLElement, passage: CitationPassage, attrs: CitationAttrs) => {
        const head = document.createElement('span');
        head.className = 'citation-popover__ref';
        head.textContent = [
          passage.shortRef,
          passage.page !== null ? `p. ${passage.page}` : null,
          // "from its Abstract": the part of the paper this passage is, not how much was read.
          passage.section ? `from its ${passage.section}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        el.appendChild(head);

        if (passage.record) {
          const r = passage.record;
          const record = document.createElement('span');
          record.className = 'citation-popover__record';
          record.style.display = 'block';
          if (r.title) {
            const title = document.createElement('strong');
            title.className = 'citation-popover__title';
            title.style.display = 'block';
            title.textContent = r.title;
            record.appendChild(title);
          }
          const meta = document.createElement('span');
          meta.className = 'citation-popover__meta';
          meta.style.display = 'block';
          meta.textContent = [r.authors, r.year, r.venue].filter(Boolean).join(' · ');
          record.appendChild(meta);
          if (r.grounding === 'ABSTRACT' || r.grounding === 'FULL_TEXT') {
            const depth = document.createElement('span');
            depth.className = 'citation-popover__depth';
            depth.style.display = 'block';
            depth.textContent =
              r.grounding === 'FULL_TEXT'
                ? 'Drawn from the full text'
                : 'Abstract only: we could read the abstract, not the whole paper';
            record.appendChild(depth);
          }
          const badges = sourceMetricBadges(r);
          if (badges.length > 0) {
            const row = document.createElement('span');
            row.className = 'citation-popover__metrics';
            row.style.display = 'flex';
            row.style.flexWrap = 'wrap';
            row.style.gap = '0.25rem';
            for (const badge of badges) {
              const chip = document.createElement('span');
              chip.className = `citation-popover__metric citation-popover__metric--${badge.kind}`;
              chip.textContent = badge.label;
              chip.title = badge.title;
              row.appendChild(chip);
            }
            record.appendChild(row);
          }
          if (r.doi) {
            const doi = document.createElement('a');
            doi.className = 'citation-popover__doi';
            doi.href = `https://doi.org/${r.doi}`;
            doi.target = '_blank';
            doi.rel = 'noopener noreferrer';
            doi.textContent = `doi.org/${r.doi}`;
            record.appendChild(doi);
          }
          el.appendChild(record);
        }

        const body = document.createElement('span');
        body.className = 'citation-popover__text';
        body.textContent = passage.text;
        el.appendChild(body);

        if (passage.pdfUrl) {
          const link = document.createElement('a');
          link.className = 'citation-popover__pdf';
          link.href =
            passage.page !== null ? `${passage.pdfUrl}#page=${passage.page}` : passage.pdfUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent =
            passage.page !== null ? `Open PDF at page ${passage.page}` : 'Open PDF';
          el.appendChild(link);

          const sourceId = attrs.sourceId;
          if (options.readBeside && sourceId && (options.canReadBeside?.() ?? true)) {
            const beside = document.createElement('button');
            beside.type = 'button';
            beside.className = 'citation-popover__beside';
            beside.setAttribute('data-testid', 'citation-read-beside');
            beside.textContent = 'Read beside';
            // Not a selection change in the editor: the atom must not be selected by this press.
            beside.addEventListener('mousedown', (event) => event.preventDefault());
            beside.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              options.readBeside?.({
                sourceId,
                page: passage.page,
                label: passage.shortRef,
                quote: passage.text,
              });
              closePopover();
            });
            el.appendChild(beside);
          }
        }

        const readerFor = attrs.sourceId;
        if (options.readerHref && readerFor) {
          const reader = document.createElement('a');
          reader.className = 'citation-popover__reader';
          reader.setAttribute('data-testid', 'citation-open-reader');
          reader.href = options.readerHref(readerFor, passage.page, attrs.chunkId);
          // A new tab: the chapter stays where it was, unsaved caret and all.
          reader.target = '_blank';
          reader.rel = 'noopener';
          reader.textContent = 'Open in reader';
          reader.addEventListener('mousedown', (event) => event.stopPropagation());
          el.appendChild(reader);
        }
      };

      /**
       * ADR-0123: a table scrolls sideways inside its own box (`.tableWrapper`), and that box would
       * cut the card off at its edge. There the card is placed against the window, kept on screen,
       * and closed by any scroll, since it no longer moves with the citation.
       */
      const placeInTable = (el: HTMLElement) => {
        if (!dom.closest('.tableWrapper')) return;
        const at = dom.getBoundingClientRect();
        const width = Math.min(352, Math.max(0, window.innerWidth - 16));
        el.style.position = 'fixed';
        el.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - width - 8))}px`;
        el.style.width = `${width}px`;
        // QA 2026-10-08: a long passage ran off the bottom of a 768-px window, out of reach. The
        // card goes where there is more room, below or above the citation, and scrolls inside
        // itself when even that is not enough.
        const below = window.innerHeight - at.bottom - 8;
        const above = at.top - 8;
        const room = Math.max(below, above);
        el.style.maxHeight = `${Math.max(120, room)}px`;
        el.style.overflowY = 'auto';
        el.style.marginTop = '0';
        const height = Math.min(el.offsetHeight, Math.max(120, room));
        el.style.top =
          below >= height || below >= above ? `${at.bottom}px` : `${at.top - height}px`;
        closeOnScroll = (event: Event) => {
          // Scrolling the card's own passage keeps it open; anything else moves the citation.
          const target = event.target as { nodeType?: number } | null;
          if (target?.nodeType && el.contains(target as globalThis.Node)) return;
          closePopover();
        };
        window.addEventListener('scroll', closeOnScroll, true);
      };

      const showPopover = (passage: CitationPassage) => {
        closePopover();
        const el = popoverShell();
        fillPassage(el, passage, current.attrs as CitationAttrs);
        // Placed after it is in the page, so its height can be measured.
        dom.appendChild(el);
        placeInTable(el);
        popover = el;
      };

      /**
       * The nodes of the cluster this node heads, read from the document now: each with its key
       * and attributes. Null when they are no longer side by side behind it.
       */
      const clusterNodes = (
        keys: readonly string[],
      ): Array<{ key: string; attrs: CitationAttrs }> | null => {
        let start: number;
        try {
          start = getPos();
        } catch {
          return null;
        }
        if (typeof start !== 'number') return null;
        const nodes: Array<{ key: string; attrs: CitationAttrs }> = [];
        for (const [j, key] of keys.entries()) {
          const found = editor.state.doc.nodeAt(start + j);
          if (found?.type.name !== 'citation' || String(found.attrs.key) !== key) return null;
          nodes.push({ key, attrs: found.attrs as CitationAttrs });
        }
        return nodes;
      };

      /** Takes one citation out of the cluster: the student's own act, from the card. */
      const removeFromCluster = (key: string, keys: readonly string[]) => {
        let start: number;
        try {
          start = getPos();
        } catch {
          return;
        }
        const offset = keys.indexOf(key);
        const found = offset >= 0 ? editor.state.doc.nodeAt(start + offset) : null;
        if (found?.type.name !== 'citation' || String(found.attrs.key) !== key) return;
        closePopover();
        editor.view.dispatch(editor.state.tr.delete(start + offset, start + offset + 1));
      };

      /**
       * R40 (ADR-0117): the card for a cluster. One tab per source, in the order they were
       * written; under it, that source's card as a single citation has it, and — while the
       * chapter can be edited — a button that takes that one source out of the bracket.
       */
      const showClusterPopover = (
        nodes: Array<{ key: string; attrs: CitationAttrs }>,
        passages: Array<CitationPassage | null>,
      ) => {
        closePopover();
        const el = popoverShell();
        el.classList.add('citation-popover--cluster');
        el.setAttribute('data-testid', 'citation-cluster-card');
        const tabs = document.createElement('span');
        tabs.className = 'citation-popover__members';
        tabs.setAttribute('role', 'tablist');
        tabs.style.display = 'flex';
        tabs.style.flexWrap = 'wrap';
        tabs.style.gap = '0.25rem';
        const body = document.createElement('span');
        body.className = 'citation-popover__member';
        body.style.display = 'block';
        const keys = nodes.map((n) => n.key);
        const buttons: HTMLButtonElement[] = [];

        const select = (index: number) => {
          const chosen = nodes[index];
          if (!chosen) return;
          buttons.forEach((button, i) => {
            button.setAttribute('aria-selected', String(i === index));
            button.classList.toggle('citation-popover__tab--active', i === index);
          });
          body.replaceChildren();
          const passage = passages[index];
          if (passage) fillPassage(body, passage, chosen.attrs);
          else {
            const none = document.createElement('span');
            none.className = 'citation-popover__ref';
            none.textContent = 'Cited from the library, with no passage attached.';
            body.appendChild(none);
          }
          if (editor.isEditable) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'citation-popover__remove';
            remove.setAttribute('data-testid', 'citation-cluster-remove');
            remove.textContent = 'Remove this source from the citation';
            remove.addEventListener('mousedown', (event) => event.preventDefault());
            remove.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              removeFromCluster(chosen.key, keys);
            });
            body.appendChild(remove);
          }
        };

        nodes.forEach((n, index) => {
          const tab = document.createElement('button');
          tab.type = 'button';
          tab.className = 'citation-popover__tab';
          tab.setAttribute('role', 'tab');
          tab.setAttribute('data-testid', 'citation-cluster-tab');
          tab.textContent = passages[index]?.shortRef ?? storage.renderedMap[n.key] ?? 'Source';
          tab.addEventListener('mousedown', (event) => event.preventDefault());
          tab.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            select(index);
          });
          buttons.push(tab);
          tabs.appendChild(tab);
        });
        el.appendChild(tabs);
        el.appendChild(body);
        select(0);
        dom.appendChild(el);
        placeInTable(el);
        popover = el;
      };

      /** Opens the card after `delay` ms: the hover delay for a pointer, none for a tap. */
      const openCard = (delay: number) => {
        if (!options.resolvePassage) return;
        if (hiddenInCluster()) return;
        const cluster = shownCluster();
        const nodes = cluster ? clusterNodes(cluster.keys) : null;
        const a = current.attrs as CitationAttrs;
        if (!nodes && !a.sourceId) return;
        if (hoverTimer) clearTimeout(hoverTimer);
        const token = ++hoverToken;
        hoverTimer = setTimeout(() => {
          hoverTimer = null;
          if (nodes) {
            void Promise.all(
              nodes.map((n) =>
                n.attrs.sourceId
                  ? (options.resolvePassage?.(n.attrs.sourceId, n.attrs.chunkId) ?? null)
                  : null,
              ),
            )
              .then((passages) => {
                if (token !== hoverToken) return;
                showClusterPopover(nodes, passages);
              })
              .catch(() => undefined);
            return;
          }
          void options
            .resolvePassage?.(a.sourceId as string, a.chunkId)
            .then((passage) => {
              // The pointer may have left, or a newer hover started, while the fetch was out.
              if (token !== hoverToken || !passage) return;
              showPopover(passage);
            })
            .catch(() => undefined);
        }, delay);
      };
      const onEnter = () => openCard(options.hoverDelayMs ?? 250);
      dom.addEventListener('mouseenter', onEnter);
      dom.addEventListener('mouseleave', closePopover);

      /**
       * QA 2026-10-09: on a phone there is no hover, so the card — each source's passage, and
       * Remove — was out of reach. A tap (a touch or pen press) opens it at once and a second tap
       * closes it; a tap anywhere else closes it too. A mouse is untouched: its card is the
       * hover's, and a click only selects.
       */
      let pressedBy = '';
      const onPointerDown = (event: Event) => {
        pressedBy = String((event as PointerEvent).pointerType ?? '');
      };
      const onTap = (event: Event) => {
        const target = event.target as globalThis.Node | null;
        if (popover && target && popover.contains(target)) return;
        const touch = pressedBy === 'touch' || pressedBy === 'pen';
        pressedBy = '';
        if (!touch) return;
        if (popover) closePopover();
        else openCard(0);
      };
      const onPressElsewhere = (event: Event) => {
        if (!popover) return;
        const target = event.target as globalThis.Node | null;
        if (target && dom.contains(target)) return;
        closePopover();
      };
      dom.addEventListener('pointerdown', onPointerDown);
      dom.addEventListener('click', onTap);
      document.addEventListener('pointerdown', onPressElsewhere, true);

      const render = () => {
        const a = current.attrs as CitationAttrs;
        dom.setAttribute('data-key', a.key);
        // The ids on the live element too, not only in the serialised form: the Citations tab,
        // E2E and a debugger all read the DOM, and the label alone does not say what it points at.
        if (a.sourceId) dom.setAttribute('data-source-id', a.sourceId);
        else dom.removeAttribute('data-source-id');
        if (a.chunkId) dom.setAttribute('data-chunk-id', a.chunkId);
        else dom.removeAttribute('data-chunk-id');
        // A note style shows a footnote number (a CSS counter shared with the student's own
        // footnotes, editor.css) and keeps the note itself for the hover.
        dom.classList.toggle('citation--note', storage.noteStyle);

        // R40 (ADR-0117): a cluster shows once, on its first node; the others show nothing (and
        // take no footnote number), while they stay separate nodes in the document.
        const cluster = shownCluster();
        const hidden = hiddenInCluster();
        dom.classList.toggle('citation--cluster', cluster !== null);
        dom.classList.toggle('citation--member', hidden);
        if (hidden) {
          closePopover();
          dom.textContent = '';
          dom.title = '';
          dom.setAttribute('aria-hidden', 'true');
          dom.classList.remove('citation--removed');
          return;
        }
        dom.removeAttribute('aria-hidden');
        if (cluster) {
          dom.textContent = storage.noteStyle ? '' : cluster.label;
          dom.classList.remove('citation--removed');
          dom.title = storage.noteStyle ? cluster.label : `${cluster.keys.length} sources`;
          return;
        }

        dom.textContent = storage.noteStyle ? '' : labelFor(current, storage);
        const removed = a.sourceId === null || storage.removedSourceIds.has(a.sourceId);
        dom.classList.toggle('citation--removed', removed);
        const meta = a.sourceId ? storage.meta[a.sourceId] : undefined;
        dom.title = removed
          ? 'Source removed — click to fix or delete'
          : storage.noteStyle
            ? (storage.renderedMap[a.key] ?? 'Citation')
            : [meta?.title, meta?.year].filter(Boolean).join(', ') || 'Citation';
      };
      render();

      // B.5: re-render on `citationsRerender` meta; the document itself is untouched.
      const onTransaction = ({
        transaction,
      }: {
        transaction: { getMeta: (k: string) => unknown };
      }) => {
        if (transaction.getMeta(CITATIONS_RERENDER)) render();
      };
      editor.on('transaction', onTransaction);

      return {
        dom,
        update(updated, nextDecorations) {
          if (updated.type.name !== 'citation') return false;
          current = updated;
          place = clusterSpecOf(nextDecorations);
          render();
          return true;
        },
        selectNode() {
          dom.classList.add('citation--selected');
        },
        deselectNode() {
          dom.classList.remove('citation--selected');
        },
        // The card's own buttons and tabs are not clicks on the citation: ProseMirror leaves
        // them alone, so pressing one never selects the atom or moves the caret.
        stopEvent(event) {
          const target = event.target as HTMLElement | null;
          return Boolean(popover && target && popover.contains(target));
        },
        ignoreMutation(mutation) {
          // QA 2026-10-09: a click in the gap between the lines of a bracket that wraps lands on
          // the paragraph, and the browser puts its caret inside the label's own text. Ignoring
          // that selection left the editor's selection where it was (the chapter heading, on a
          // fresh chapter) and the caret stranded in a non-editable island, where Ctrl+End does
          // nothing. ProseMirror reads it instead and selects the citation (the cluster plugin
          // widens that to the bracket). A selection inside the card stays the card's own.
          if (mutation.type === 'selection') {
            return Boolean(popover?.contains(mutation.target));
          }
          return true;
        },
        destroy() {
          closePopover();
          dom.removeEventListener('mouseenter', onEnter);
          dom.removeEventListener('mouseleave', closePopover);
          dom.removeEventListener('pointerdown', onPointerDown);
          dom.removeEventListener('click', onTap);
          document.removeEventListener('pointerdown', onPressElsewhere, true);
          editor.off('transaction', onTransaction);
        },
      };
    };
  },

  addCommands() {
    return {
      insertCitation:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              key: attrs.key ?? newCitationKey(),
              sourceId: attrs.sourceId,
              chunkId: attrs.chunkId ?? null,
              role: attrs.role ?? 'parenthetical',
              locator: attrs.locator ?? null,
              prefix: attrs.prefix ?? null,
              suffix: attrs.suffix ?? null,
            },
          }),

      setCitationStyle:
        (style, renderedMap, noteStyle = false, numeric, clusters = []) =>
        ({ tr, dispatch }) => {
          this.storage.style = style;
          this.storage.renderedMap = renderedMap;
          this.storage.noteStyle = noteStyle;
          if (numeric !== undefined) this.storage.numeric = numeric;
          this.storage.clusters = new Map(
            clusters
              .filter((cluster) => cluster.keys.length > 1)
              .map((cluster) => [cluster.keys.join(' '), cluster.label] as const),
          );
          if (dispatch) tr.setMeta(CITATIONS_RERENDER, true);
          return true;
        },

      // Before ADR-0045 an accepted suggestion's node took the prompt-local passage id as its
      // key, so a chapter written over a few sessions holds several nodes keyed `S1#c1` that
      // point at different sources. One label map cannot serve them. The first keeps its key —
      // its `Citation` row and locator survive — and each later twin gets a fresh one, which the
      // next save turns into a row of its own.
      dedupeCitationKeys:
        () =>
        ({ tr, state, dispatch }) => {
          const seen = new Set<string>();
          const rekey: Array<{ pos: number; node: PmNode }> = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'citation') return true;
            const key = String(node.attrs.key ?? '');
            if (!key || seen.has(key)) rekey.push({ pos, node });
            else seen.add(key);
            return true;
          });
          if (rekey.length === 0) return false;
          if (!dispatch) return true;
          for (const { pos, node } of rekey) {
            const key = newCitationKey();
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, key });
            const old = this.storage.renderedMap[String(node.attrs.key)];
            if (old) this.storage.renderedMap[key] = old;
          }
          return true;
        },

      markSourceRemoved:
        (sourceId) =>
        ({ tr, dispatch }) => {
          this.storage.removedSourceIds.add(sourceId);
          if (dispatch) tr.setMeta(CITATIONS_RERENDER, true);
          return true;
        },
    };
  },
});

/** Keys of every citation in document order — the numeric-style ordering input (B.5). */
export function citationKeysInOrder(doc: PmNode): string[] {
  const keys: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'citation') keys.push(String(node.attrs.key));
  });
  return keys;
}
