/**
 * What the export dialog's preview draws of a chapter (R27, ADR-0121): its title, and its first
 * headings, paragraphs and rules in order — never the text of an AI draft the student has not
 * accepted, which the file leaves out too.
 */

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

export type PreviewBlock = { kind: 'h2' | 'h3' | 'p' | 'rule'; text: string };

const textOf = (node: Node): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

/** The chapter's first blocks as the preview draws them; `limit` is about a page's worth. */
export function previewBlocks(
  content: unknown,
  limit = 14,
): { title: string | null; blocks: PreviewBlock[] } {
  const nodes = ((content as Node | undefined)?.content ?? []).filter(
    (n) => n.type !== 'draftBlock',
  );
  const titleNode = nodes.find((n) => n.type === 'heading' && Number(n.attrs?.level) === 1);
  const blocks: PreviewBlock[] = [];
  for (const node of nodes) {
    if (node === titleNode) continue;
    if (blocks.length >= limit) break;
    if (node.type === 'horizontalRule') {
      blocks.push({ kind: 'rule', text: '' });
      continue;
    }
    const text = textOf(node).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (node.type === 'heading') {
      blocks.push({ kind: Number(node.attrs?.level) === 3 ? 'h3' : 'h2', text });
    } else {
      blocks.push({ kind: 'p', text });
    }
  }
  return { title: titleNode ? textOf(titleNode).trim() : null, blocks };
}
