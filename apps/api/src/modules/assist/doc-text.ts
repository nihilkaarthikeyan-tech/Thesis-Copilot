/**
 * ProseMirror JSON → plain text, for the prompt builder.
 *
 * A.0.1's glossary trimming keeps "entries appearing in the current chapter's text", which needs
 * the chapter as prose, not as a node tree. Blocks become lines so a term at a paragraph boundary
 * is still a whole word; inline nodes with no text (a citation node, an image) contribute
 * nothing, because the glossary is about the student's words.
 */

type PmNode = {
  type?: string;
  text?: string;
  content?: PmNode[];
};

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'bulletList',
  'orderedList',
  'tableRow',
  'tableCell',
  'tableHeader',
  'draftBlock',
]);

export function docToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const parts: string[] = [];

  const visit = (node: PmNode): void => {
    if (typeof node.text === 'string') {
      parts.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      parts.push('\n');
      return;
    }
    const isBlock = node.type ? BLOCK_TYPES.has(node.type) : false;
    for (const child of node.content ?? []) visit(child);
    if (isBlock) parts.push('\n');
  };

  visit(doc as PmNode);
  return parts
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * ADR-0151: words written in a chapter outside its headings, the server's copy of the setup
 * card's `bodyWords`. Under three, the chapter has no first sentence yet.
 */
export function proseWords(doc: unknown): number {
  let words = 0;
  const visit = (node: PmNode): void => {
    if (node.type === 'heading') return;
    if (typeof node.text === 'string') {
      words += node.text.trim().split(/\s+/).filter(Boolean).length;
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  if (doc && typeof doc === 'object') visit(doc as PmNode);
  return words;
}
