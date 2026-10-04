/**
 * Draft block — PRD Appendix B.6, FR-4.4 (Draft mode, the owner's requirement).
 *
 * A block node wrapping AI-drafted content until the student accepts or discards it. Accept
 * unwraps the node so its children (with their `provenance DRAFT` marks and citation nodes)
 * become normal content; `needsSourceNote` atoms become visible plain text with HUMAN provenance.
 * Discard deletes it. Only one pending draft per chapter.
 *
 * Generation is Phase 1 week 4 (job `draft-section`); this week is the editor side only.
 */

import { mergeAttributes, Node } from '@tiptap/core';
import type { Fragment, Node as PmNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';

export type DraftStatus = 'pending' | 'accepted';

export type DraftBlockOptions = {
  /** Called before accept so the app can take the PRE_DRAFT_ACCEPT snapshot (B.6, B.7). */
  onBeforeAccept?: (draftId: string) => Promise<void> | void;
  onOutcome?: (event: { draftId: string; outcome: 'ACCEPTED' | 'DISCARDED' }) => void;
  onRegenerate?: (draftId: string) => void;
  /** Regenerate is disabled in week 1 (PHASES 1.6). */
  regenerateEnabled: boolean;
  /**
   * Thumbs on a draft (2026-10-04, from the Jenni study), apart from keeping it. Shown only when
   * given; resolves false when the rating could not be saved, so the button goes back.
   */
  onRate?: (draftId: string, rating: 1 | -1 | 0) => Promise<boolean>;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    draftBlock: {
      /** Inserts a pending draft; refuses if one is already pending in the document. */
      insertDraft: (draftId: string, content: PmNode[] | Fragment, at?: number) => ReturnType;
      acceptDraft: (draftId: string) => ReturnType;
      discardDraft: (draftId: string) => ReturnType;
    };
  }
}

export function findDraft(doc: PmNode, draftId: string): { node: PmNode; pos: number } | null {
  let found: { node: PmNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'draftBlock' && node.attrs.draftId === draftId) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

export function pendingDraft(doc: PmNode): { node: PmNode; pos: number } | null {
  let found: { node: PmNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'draftBlock' && node.attrs.status === 'pending') {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * B.6 accept: `needsSourceNote` atoms become plain text `[NEEDS SOURCE: …]` with HUMAN provenance
 * so they stay visible until the student deals with them.
 */
function convertNotes(tr: Transaction, from: number, to: number): void {
  const schema = tr.doc.type.schema;
  const notes: Array<{ pos: number; text: string }> = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'needsSourceNote') notes.push({ pos, text: String(node.attrs.text) });
  });
  // Replace from the end so earlier positions stay valid.
  for (const note of notes.reverse()) {
    const mark = schema.marks.provenance?.create({ kind: 'HUMAN', actionId: null });
    const text = schema.text(`[NEEDS SOURCE: ${note.text}]`, mark ? [mark] : []);
    tr.replaceWith(note.pos, note.pos + 1, text);
  }
}

function DraftBlockView(props: {
  node: PmNode;
  editor: {
    commands: { acceptDraft: (id: string) => boolean; discardDraft: (id: string) => boolean };
  };
  extension: { options: DraftBlockOptions };
}) {
  const draftId = String(props.node.attrs.draftId);
  const pending = props.node.attrs.status === 'pending';
  const options = props.extension.options;
  const [rating, setRating] = useState<1 | -1 | 0>(0);
  const rate = (value: 1 | -1) => {
    if (!options.onRate) return;
    const next = rating === value ? 0 : value;
    const before = rating;
    setRating(next);
    void options.onRate(draftId, next).then((ok) => {
      if (!ok) setRating(before);
    });
  };

  return (
    <NodeViewWrapper
      className={`draft-block${pending ? ' draft-block--pending' : ''}`}
      data-draft="true"
      data-draft-id={draftId}
    >
      {pending ? (
        <div className="draft-block__header" contentEditable={false}>
          <span className="draft-block__label">AI draft — review before accepting</span>
          <span className="draft-block__actions">
            <button type="button" onClick={() => props.editor.commands.acceptDraft(draftId)}>
              Accept draft
            </button>
            <button type="button" onClick={() => props.editor.commands.discardDraft(draftId)}>
              Discard
            </button>
            <button
              type="button"
              disabled={!options.regenerateEnabled}
              title={
                options.regenerateEnabled ? 'Counts as another Draft action' : 'Available in week 4'
              }
              onClick={() => options.onRegenerate?.(draftId)}
            >
              Regenerate
            </button>
            {options.onRate ? (
              <>
                <button
                  type="button"
                  aria-pressed={rating === 1}
                  data-testid="draft-rate-up"
                  onClick={() => rate(1)}
                >
                  Useful
                </button>
                <button
                  type="button"
                  aria-pressed={rating === -1}
                  data-testid="draft-rate-down"
                  onClick={() => rate(-1)}
                >
                  Not useful
                </button>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      <NodeViewContent className="draft-block__content" />
    </NodeViewWrapper>
  );
}

export const DraftBlock = Node.create<DraftBlockOptions>({
  name: 'draftBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addOptions() {
    return { regenerateEnabled: false };
  },

  addAttributes() {
    return {
      draftId: { default: null },
      status: { default: 'pending' },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-draft]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-draft': 'true',
        'data-draft-id': node.attrs.draftId,
        'data-status': node.attrs.status,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DraftBlockView as never);
  },

  addCommands() {
    return {
      insertDraft:
        (draftId, content, at) =>
        ({ state, tr, dispatch }) => {
          // B.6: only one pending draft per chapter.
          if (pendingDraft(state.doc)) return false;
          const node = this.type.create({ draftId, status: 'pending' }, content);
          const pos = at ?? state.selection.$from.after(1) ?? state.doc.content.size;
          if (dispatch) {
            tr.insert(Math.min(pos, tr.doc.content.size), node);
            tr.setMeta('provenance-skip', true);
          }
          return true;
        },

      acceptDraft:
        (draftId) =>
        ({ state, tr, dispatch }) => {
          const found = findDraft(state.doc, draftId);
          if (!found) return false;
          if (dispatch) {
            const { node, pos } = found;
            // Unwrap: replace the block with its children. Marks and citation nodes survive.
            tr.replaceWith(pos, pos + node.nodeSize, node.content);
            convertNotes(tr, pos, pos + node.content.size);
            tr.setMeta('provenance-skip', true);
            this.options.onOutcome?.({ draftId, outcome: 'ACCEPTED' });
          }
          return true;
        },

      discardDraft:
        (draftId) =>
        ({ state, tr, dispatch }) => {
          const found = findDraft(state.doc, draftId);
          if (!found) return false;
          if (dispatch) {
            tr.delete(found.pos, found.pos + found.node.nodeSize);
            tr.setMeta('provenance-skip', true);
            this.options.onOutcome?.({ draftId, outcome: 'DISCARDED' });
          }
          return true;
        },
    };
  },
});
