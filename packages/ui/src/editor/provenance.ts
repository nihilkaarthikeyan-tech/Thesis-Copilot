/**
 * Provenance mark — PRD Appendix B.4, FR-4.11.
 *
 * Every text range carries `{ kind, actionId }`. `inclusive: false` so typing at the boundary of AI
 * text does not extend the AI mark; `excludes: ''` so it coexists with bold, italic, links.
 *
 * The appendTransaction plugin runs after every transaction and, using the step maps only:
 *   1. gives any inserted text with no provenance mark `{ kind: 'HUMAN', actionId: null }`;
 *   2. re-marks text touched by a replacing step inside an ASSIST | DRAFT | COMMAND range as
 *      `HUMAN_EDITED`, keeping the `actionId`.
 * It never diffs the whole document.
 */

import { Mark, mergeAttributes } from '@tiptap/core';
import { isChangeOrigin } from '@tiptap/extension-collaboration';
import type { Mark as PmMark, Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';

export const PROVENANCE_KINDS = ['HUMAN', 'ASSIST', 'DRAFT', 'COMMAND', 'HUMAN_EDITED'] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

/** Kinds whose text, once edited by the student, becomes HUMAN_EDITED. */
export const AI_KINDS: ReadonlySet<ProvenanceKind> = new Set(['ASSIST', 'DRAFT', 'COMMAND']);

export type ProvenanceAttrs = { kind: ProvenanceKind; actionId: string | null };

export const provenancePluginKey = new PluginKey('provenance');

/** Transactions carrying this meta are the plugin's own re-marking and are not processed again. */
const SKIP_META = 'provenance-skip';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    provenance: {
      /** Applies a provenance mark to a range (used by accept-suggestion and draft insertion). */
      setProvenance: (from: number, to: number, attrs: ProvenanceAttrs) => ReturnType;
    };
  }
}

export const Provenance = Mark.create({
  name: 'provenance',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      kind: {
        default: 'HUMAN',
        parseHTML: (el) => el.getAttribute('data-provenance') ?? 'HUMAN',
        renderHTML: (attrs) => ({ 'data-provenance': attrs.kind }),
      },
      actionId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-action-id'),
        renderHTML: (attrs) => (attrs.actionId ? { 'data-action-id': attrs.actionId } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-provenance]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setProvenance:
        (from, to, attrs) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.removeMark(from, to, this.type);
            tr.addMark(from, to, this.type.create(attrs));
            tr.setMeta(SKIP_META, true);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const markType = this.type;

    return [
      new Plugin({
        key: provenancePluginKey,
        appendTransaction(transactions, _oldState, newState) {
          // ADR-0028: a change that arrived from another person's editor carries their marks
          // already; re-marking it here would call their words this editor's, on every peer.
          const own = transactions.filter((t) => !t.getMeta(SKIP_META) && !isChangeOrigin(t));
          const docChanged = own.some((t) => t.docChanged);
          if (!docChanged) return null;

          const tr = newState.tr;
          let changed = false;

          for (const transaction of own) {
            if (!transaction.docChanged) continue;

            // Map positions through the steps of *this* transaction. Steps are replayed against the
            // document as it was before each step, so `before` is rebuilt step by step.
            let before = transaction.before;
            transaction.steps.forEach((step, index) => {
              const map = step.getMap();
              const docAfterStep = transaction.docs[index + 1] ?? transaction.doc;

              // Replacing the entire document is a load (setContent), not the student typing:
              // existing marks are kept and unmarked text stays unmarked (it reads as HUMAN).
              if (isWholeDocumentReplace(step, before)) {
                before = docAfterStep;
                return;
              }

              map.forEach((oldStart, oldEnd, newStart, newEnd) => {
                // Was the touched range (or insertion point) inside AI-marked text?
                const touchedAi = aiMarkAt(before, oldStart, oldEnd, markType);

                if (newEnd > newStart) {
                  // Inserted or replaced text. Marks are read from the final document, but
                  // positions must be mapped forward through the remaining steps.
                  const mapped = mapThroughRemaining(transaction, index + 1, newStart, newEnd);
                  if (!mapped) return;
                  const [from, to] = mapped;
                  const kind: ProvenanceKind = touchedAi ? 'HUMAN_EDITED' : 'HUMAN';
                  const actionId = touchedAi?.attrs.actionId ?? null;

                  newState.doc.nodesBetween(from, to, (node, pos) => {
                    if (!node.isText) return;
                    const existing = markType.isInSet(node.marks);
                    const nodeFrom = Math.max(pos, from);
                    const nodeTo = Math.min(pos + node.nodeSize, to);

                    if (!existing) {
                      tr.addMark(nodeFrom, nodeTo, markType.create({ kind, actionId }));
                      changed = true;
                    } else if (touchedAi && AI_KINDS.has(existing.attrs.kind as ProvenanceKind)) {
                      // Text typed inside an AI range inherits the AI mark by ProseMirror's own
                      // rules when the cursor is strictly inside it; that is an edit.
                      tr.removeMark(nodeFrom, nodeTo, markType);
                      tr.addMark(
                        nodeFrom,
                        nodeTo,
                        markType.create({
                          kind: 'HUMAN_EDITED',
                          actionId: existing.attrs.actionId,
                        }),
                      );
                      changed = true;
                    }
                  });
                } else if (touchedAi && oldEnd > oldStart) {
                  // Pure deletion inside an AI range: the surviving text nodes on either side of
                  // the cut were touched and become HUMAN_EDITED.
                  const mapped = mapThroughRemaining(transaction, index + 1, newStart, newStart);
                  if (!mapped) return;
                  const at = mapped[0];
                  remarkTouchedTextAt(tr, newState.doc, at, markType, touchedAi);
                  changed = true;
                }
              });

              before = docAfterStep;
            });
          }

          if (!changed) return null;
          tr.setMeta(SKIP_META, true);
          tr.setMeta('addToHistory', false);
          return tr;
        },
      }),
    ];
  },
});

/** True for a step that replaces the document end to end (what setContent produces). */
function isWholeDocumentReplace(
  step: {
    getMap: () => { forEach: (f: (a: number, b: number, c: number, d: number) => void) => void };
  },
  doc: PmNode,
): boolean {
  let whole = false;
  step.getMap().forEach((oldStart, oldEnd) => {
    if (oldStart === 0 && oldEnd === doc.content.size) whole = true;
  });
  return whole;
}

/** The AI provenance mark covering the touched range in `doc`, if any. */
function aiMarkAt(doc: PmNode, from: number, to: number, markType: PmMark['type']): PmMark | null {
  const size = doc.content.size;
  if (from > size) return null;
  const clampedTo = Math.min(to, size);

  // An insertion point inherits marks the way ProseMirror would (respecting inclusive: false),
  // so typing exactly at the end of an ASSIST range is NOT "inside" it.
  const inherited = doc
    .resolve(from)
    .marks()
    .find((m) => m.type === markType);
  if (inherited && AI_KINDS.has(inherited.attrs.kind as ProvenanceKind)) return inherited;

  if (clampedTo > from) {
    let found: PmMark | null = null;
    doc.nodesBetween(from, clampedTo, (node) => {
      if (found || !node.isText) return;
      const mark = markType.isInSet(node.marks);
      if (mark && AI_KINDS.has(mark.attrs.kind as ProvenanceKind)) found = mark;
    });
    return found;
  }
  return null;
}

/** Maps a range through steps `fromStep..end` of the transaction; null if it was deleted. */
function mapThroughRemaining(
  transaction: Transaction,
  fromStep: number,
  from: number,
  to: number,
): [number, number] | null {
  let a = from;
  let b = to;
  for (let i = fromStep; i < transaction.steps.length; i++) {
    const map = transaction.steps[i]?.getMap();
    if (!map) continue;
    a = map.map(a, 1);
    b = map.map(b, -1);
  }
  return b < a ? null : [a, b];
}

function remarkTouchedTextAt(
  tr: Transaction,
  doc: PmNode,
  pos: number,
  markType: PmMark['type'],
  aiMark: PmMark,
): void {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  const candidates = [$pos.nodeBefore, $pos.nodeAfter];
  let offset = $pos.pos - ($pos.nodeBefore?.nodeSize ?? 0);

  for (const node of candidates) {
    if (node?.isText) {
      const existing = markType.isInSet(node.marks);
      if (existing && existing.attrs.actionId === aiMark.attrs.actionId) {
        tr.removeMark(offset, offset + node.nodeSize, markType);
        tr.addMark(
          offset,
          offset + node.nodeSize,
          markType.create({ kind: 'HUMAN_EDITED', actionId: existing.attrs.actionId }),
        );
      }
    }
    offset = $pos.pos;
  }
}

/** Word counts by provenance kind — computed on save and stored on `Chapter.wordCounts` (B.4). */
export function wordCountByProvenance(doc: PmNode): Record<ProvenanceKind, number> {
  const counts: Record<ProvenanceKind, number> = {
    HUMAN: 0,
    ASSIST: 0,
    DRAFT: 0,
    COMMAND: 0,
    HUMAN_EDITED: 0,
  };
  doc.descendants((node) => {
    if (!node.isText || !node.text) return;
    const mark = node.marks.find((m) => m.type.name === 'provenance');
    const kind = (mark?.attrs.kind as ProvenanceKind | undefined) ?? 'HUMAN';
    const words = node.text.trim().split(/\s+/).filter(Boolean).length;
    counts[kind] += words;
  });
  return counts;
}
