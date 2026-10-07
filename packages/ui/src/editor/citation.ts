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
import { Plugin, PluginKey } from '@tiptap/pm/state';
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
  readBeside?: (target: { sourceId: string; page: number | null; label: string }) => void;
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
};

export const CITATIONS_RERENDER = 'citationsRerender';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: Partial<CitationAttrs> & { sourceId: string | null }) => ReturnType;
      /** Swap style / labels and re-render every citation without touching the document. */
      setCitationStyle: (
        style: string,
        renderedMap: Record<string, string>,
        noteStyle?: boolean,
        numeric?: boolean,
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
    const serializer = new DOMSerializer(
      {
        ...base.nodes,
        citation: (node: PmNode) => [
          'span',
          citationDomAttrs(node.attrs as CitationAttrs),
          copiedLabel(node, storage),
        ],
      },
      base.marks,
    );
    return [
      new Plugin({
        key: new PluginKey('citationClipboard'),
        props: {
          clipboardSerializer: serializer,
          clipboardTextSerializer: (slice) =>
            slice.content.textBetween(0, slice.content.size, '\n\n', (leaf) =>
              leaf.type.name === 'citation'
                ? copiedLabel(leaf, storage)
                : (leaf.type.spec.leafText?.(leaf) ?? ''),
            ),
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
    ];
  },

  addNodeView() {
    const editor = this.editor;
    const storage = this.storage;
    const options = this.options;

    return ({ node }) => {
      let current = node;
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

      const closePopover = () => {
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = null;
        hoverToken++;
        popover?.remove();
        popover = null;
      };

      const showPopover = (passage: CitationPassage) => {
        closePopover();
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

        const head = document.createElement('span');
        head.className = 'citation-popover__ref';
        head.textContent = [
          passage.shortRef,
          passage.page !== null ? `p. ${passage.page}` : null,
          passage.section,
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

          const sourceId = (current.attrs as CitationAttrs).sourceId;
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
              options.readBeside?.({ sourceId, page: passage.page, label: passage.shortRef });
              closePopover();
            });
            el.appendChild(beside);
          }
        }

        const readerFor = (current.attrs as CitationAttrs).sourceId;
        if (options.readerHref && readerFor) {
          const reader = document.createElement('a');
          reader.className = 'citation-popover__reader';
          reader.setAttribute('data-testid', 'citation-open-reader');
          reader.href = options.readerHref(
            readerFor,
            passage.page,
            (current.attrs as CitationAttrs).chunkId,
          );
          // A new tab: the chapter stays where it was, unsaved caret and all.
          reader.target = '_blank';
          reader.rel = 'noopener';
          reader.textContent = 'Open in reader';
          reader.addEventListener('mousedown', (event) => event.stopPropagation());
          el.appendChild(reader);
        }

        dom.appendChild(el);
        popover = el;
      };

      const onEnter = () => {
        const a = current.attrs as CitationAttrs;
        if (!options.resolvePassage || !a.sourceId) return;
        if (hoverTimer) clearTimeout(hoverTimer);
        const token = ++hoverToken;
        hoverTimer = setTimeout(() => {
          hoverTimer = null;
          void options
            .resolvePassage?.(a.sourceId as string, a.chunkId)
            .then((passage) => {
              // The pointer may have left, or a newer hover started, while the fetch was out.
              if (token !== hoverToken || !passage) return;
              showPopover(passage);
            })
            .catch(() => undefined);
        }, options.hoverDelayMs ?? 250);
      };
      dom.addEventListener('mouseenter', onEnter);
      dom.addEventListener('mouseleave', closePopover);

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
        update(updated) {
          if (updated.type.name !== 'citation') return false;
          current = updated;
          render();
          return true;
        },
        selectNode() {
          dom.classList.add('citation--selected');
        },
        deselectNode() {
          dom.classList.remove('citation--selected');
        },
        ignoreMutation() {
          return true;
        },
        destroy() {
          closePopover();
          dom.removeEventListener('mouseenter', onEnter);
          dom.removeEventListener('mouseleave', closePopover);
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
        (style, renderedMap, noteStyle = false, numeric) =>
        ({ tr, dispatch }) => {
          this.storage.style = style;
          this.storage.renderedMap = renderedMap;
          this.storage.noteStyle = noteStyle;
          if (numeric !== undefined) this.storage.numeric = numeric;
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
