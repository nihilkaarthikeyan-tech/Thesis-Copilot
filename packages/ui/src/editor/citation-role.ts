/**
 * FR-5.6's editor half — moving a citation between narrative and parenthetical form.
 *
 * The server rewrites the sentence (ADR-0010); this finds which sentence to send and puts the
 * answer back. Both halves are here because both need the same idea of where a sentence starts and
 * ends, and two different answers to that would apply a rewrite over the wrong range.
 *
 * A citation is an atom node, so the sentence has to be serialised with `{{cite:KEY}}` standing in
 * for it — the same convention the model already reads and writes everywhere else — and rebuilt
 * from that on the way back. Rebuilding, rather than patching the text around the node, is what
 * lets the citation legitimately move from the end of the sentence to the front.
 */

import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PmNode, type Schema } from '@tiptap/pm/model';

export type CitationRole = 'parenthetical' | 'narrative';

/** Everything the server needs, plus the range the answer will replace. */
export type SentenceForCitation = {
  /** The sentence with `{{cite:KEY}}` where each citation node sits. */
  text: string;
  from: number;
  to: number;
  /** Attributes of every citation in the range, so the rebuild keeps its source and chunk. */
  citations: Array<{
    key: string;
    sourceId: string | null;
    chunkId: string | null;
    role?: string | null;
    locator?: string | null;
    prefix?: string | null;
    suffix?: string | null;
  }>;
};

const CITE_RE = /\{\{cite:([^}]+)\}\}/g;
/** A sentence ends at `.`, `!` or `?`. Matches `splitSentences` in `packages/retrieval`. */
const SENTENCE_END = /[.!?]/;

/**
 * The sentence containing the citation whose `key` is given, or null when it is not in the
 * document.
 *
 * Bounded to the citation's own paragraph: a rewrite must never reach across a paragraph break,
 * and a missing full stop at the end of a paragraph is common enough that walking past it would
 * regularly swallow the next one.
 */
export function sentenceAroundCitation(editor: Editor, key: string): SentenceForCitation | null {
  const { doc } = editor.state;

  // One pass over each paragraph, recording every child's span in characters *and* in document
  // positions. A citation is one position wide and many characters long, so the two scales only
  // agree if they are measured together.
  type Piece = {
    charStart: number;
    charEnd: number;
    posStart: number;
    posEnd: number;
    isTarget: boolean;
    citation: SentenceForCitation['citations'][number] | null;
  };

  let result: SentenceForCitation | null = null;

  doc.descendants((node, pos) => {
    if (result || !node.isTextblock) return;
    const pieces: Piece[] = [];
    let text = '';
    let cursor = pos + 1; // just inside the paragraph

    node.forEach((child) => {
      const isCitation = child.type.name === 'citation';
      const childKey = isCitation ? String(child.attrs.key) : '';
      const rendered = isCitation ? `{{cite:${childKey}}}` : child.textContent;
      pieces.push({
        charStart: text.length,
        charEnd: text.length + rendered.length,
        posStart: cursor,
        posEnd: cursor + child.nodeSize,
        isTarget: isCitation && childKey === key,
        citation: isCitation
          ? {
              key: childKey,
              sourceId: (child.attrs.sourceId as string | null) ?? null,
              chunkId: (child.attrs.chunkId as string | null) ?? null,
              role: (child.attrs.role as string | null) ?? null,
              locator: (child.attrs.locator as string | null) ?? null,
              prefix: (child.attrs.prefix as string | null) ?? null,
              suffix: (child.attrs.suffix as string | null) ?? null,
            }
          : null,
      });
      text += rendered;
      cursor += child.nodeSize;
    });

    const target = pieces.find((piece) => piece.isTarget);
    if (!target) return;

    const from = sentenceStart(text, target.charStart);
    const to = sentenceEnd(text, target.charStart);
    const slice = text.slice(from, to).trim();
    if (!slice) return;

    result = {
      text: slice,
      from: positionAt(pieces, pos, from),
      to: positionAt(pieces, pos, to),
      citations: pieces
        .map((piece) => piece.citation)
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .filter((c) => slice.includes(`{{cite:${c.key}}}`)),
    };
  });

  return result;
}

/**
 * Document position for a character offset in the serialised paragraph.
 *
 * An offset inside a citation snaps to that citation's own boundary — there is no position
 * "three characters into" an atom, and a range that claimed there was would split the node.
 */
function positionAt(
  pieces: ReadonlyArray<{
    charStart: number;
    charEnd: number;
    posStart: number;
    posEnd: number;
    citation: unknown;
  }>,
  paragraphPos: number,
  offset: number,
): number {
  for (const piece of pieces) {
    if (offset >= piece.charEnd) continue;
    if (offset <= piece.charStart) return piece.posStart;
    return piece.citation ? piece.posEnd : piece.posStart + (offset - piece.charStart);
  }
  const last = pieces.at(-1);
  return last ? last.posEnd : paragraphPos + 1;
}

/** Start of the sentence containing `at`: just after the previous terminator. */
function sentenceStart(text: string, at: number): number {
  for (let i = at - 1; i > 0; i--) {
    if (SENTENCE_END.test(text[i] as string)) {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] as string)) j++;
      return j;
    }
  }
  return 0;
}

/** End of that sentence: through its terminator, or the end of the paragraph. */
function sentenceEnd(text: string, at: number): number {
  for (let i = at; i < text.length; i++) {
    if (SENTENCE_END.test(text[i] as string)) return i + 1;
  }
  return text.length;
}

/**
 * Replaces `range` with the rewritten sentence, rebuilding each `{{cite:KEY}}` as the citation
 * node it stands for, with the role the student asked for.
 *
 * Provenance is `COMMAND`, not `ASSIST`: FR-4.11 asks what produced a range, and this was a
 * requested rewrite of the student's own sentence rather than a suggestion they accepted.
 */
export function applyCitationRole(
  editor: Editor,
  range: SentenceForCitation,
  rewritten: string,
  targetKey: string,
  targetRole: CitationRole,
  actionId: string,
): boolean {
  const fragment = sentenceToFragment(
    editor.schema,
    rewritten.trim(),
    range.citations,
    targetKey,
    targetRole,
    actionId,
  );
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(range.from, range.to, fragment);
      tr.setMeta('provenance-skip', true);
      return true;
    })
    .run();
}

export function sentenceToFragment(
  schema: Schema,
  text: string,
  citations: SentenceForCitation['citations'],
  targetKey: string,
  targetRole: CitationRole,
  actionId: string,
): Fragment {
  const provenance = schema.marks.provenance?.create({ kind: 'COMMAND', actionId });
  const marks = provenance ? [provenance] : [];
  const byKey = new Map(citations.map((c) => [c.key, c]));
  const nodes: PmNode[] = [];

  let last = 0;
  CITE_RE.lastIndex = 0;
  for (const match of text.matchAll(CITE_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(schema.text(text.slice(last, index), marks));
    const key = match[1] ?? '';
    const citation = byKey.get(key);
    const citationType = schema.nodes.citation;
    if (citation && citationType) {
      nodes.push(
        citationType.create({
          key: citation.key,
          sourceId: citation.sourceId,
          chunkId: citation.chunkId,
          // The page the student had set stays with the citation (ADR-0045).
          locator: citation.locator ?? null,
          prefix: citation.prefix ?? null,
          suffix: citation.suffix ?? null,
          // Only the one the student asked about changes form; the others keep theirs.
          role: key === targetKey ? targetRole : (citation.role ?? 'parenthetical'),
        }),
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(schema.text(text.slice(last), marks));

  return Fragment.fromArray(nodes);
}
