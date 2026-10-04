/**
 * A chapter as the public read-only link shows it (ADR-0057): headings and paragraphs of text,
 * and nothing else from the stored document.
 *
 * The stored ProseMirror JSON carries more than the words — provenance marks (which passage was
 * AI-drafted), comment anchors, citation node keys, figure storage keys, footnote ids. A guide's
 * page receives the JSON because a guide is a named, signed-in person the student chose. A link
 * can reach anyone, so the server flattens the chapter to text before it leaves, and the browser
 * never sees the rest. Pending draft blocks are left out: until the student accepts one it is a
 * suggestion, not thesis text ("flag, don't fix").
 */

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

export type ReadBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string };

/** Inline text of a node, skipping anything that is not words. */
function textOf(node: Node | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return ' ';
  if (node.type === 'mathInline' || node.type === 'mathBlock') {
    const latex = node.attrs?.latex;
    return typeof latex === 'string' ? latex : '';
  }
  // A citation's label is rendered from the library, which the link does not expose; a footnote
  // is a note, not running text. Both are left out rather than shown half-formed.
  if (node.type === 'citation' || node.type === 'footnote' || node.type === 'image') return '';
  return (node.content ?? []).map(textOf).join('');
}

function isPendingDraft(node: Node): boolean {
  return node.type === 'draftBlock' && node.attrs?.status !== 'accepted';
}

/** The blocks of a chapter, in order, with pending drafts and empty blocks dropped. */
export function readBlocks(doc: unknown): ReadBlock[] {
  const out: ReadBlock[] = [];
  const walk = (nodes: Node[] | undefined): void => {
    for (const node of nodes ?? []) {
      if (!node || typeof node !== 'object' || isPendingDraft(node)) continue;
      if (node.type === 'heading') {
        const text = textOf(node).trim();
        const level = Number(node.attrs?.level);
        if (text) out.push({ kind: 'heading', level: level >= 1 && level <= 6 ? level : 2, text });
        continue;
      }
      // Containers whose children are blocks: walk in, so a list or an accepted draft reads as
      // its paragraphs rather than one run-on line.
      if (
        node.type === 'draftBlock' ||
        node.type === 'bulletList' ||
        node.type === 'orderedList' ||
        node.type === 'listItem' ||
        node.type === 'blockquote'
      ) {
        walk(node.content);
        continue;
      }
      if (node.type === 'table') {
        for (const row of node.content ?? []) {
          const cells = (row.content ?? []).map((cell) => textOf(cell).trim()).filter(Boolean);
          if (cells.length) out.push({ kind: 'paragraph', text: cells.join(' | ') });
        }
        continue;
      }
      const text = textOf(node).trim();
      if (text) out.push({ kind: 'paragraph', text });
    }
  };
  walk((doc as Node | undefined)?.content);
  return out;
}
