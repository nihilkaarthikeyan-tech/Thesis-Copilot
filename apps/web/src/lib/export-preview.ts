/**
 * What the export dialog's preview draws of a chapter (R27, ADR-0121): its title, and its first
 * headings, paragraphs and rules in order — never the text of an AI draft the student has not
 * accepted, which the file leaves out too.
 */

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

export type PreviewBlock = { kind: 'h2' | 'h3' | 'p' | 'rule'; text: string };

/** What stands in for a citation whose label has not been rendered yet (the server's own word). */
const UNLABELLED = '(Source)';

/**
 * A node's text. A citation node has no text of its own — its label lives in the rendered map
 * the server gives the editor — so before ADR-0150 the preview drew "…communities ." for a
 * paragraph the file prints as "…communities [1]." The label is read by the node's key, the
 * same labels the built file uses.
 */
const textOf = (node: Node, labels: Readonly<Record<string, string>>): string => {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'citation') {
    const key = String(node.attrs?.key ?? '');
    return labels[key] ?? UNLABELLED;
  }
  return (node.content ?? []).map((child) => textOf(child, labels)).join('');
};

/**
 * The chapter's first blocks as the preview draws them; `limit` is about a page's worth.
 * `labels`: the rendered citation labels by node key (`/documents/:id/citations`).
 */
export function previewBlocks(
  content: unknown,
  limit = 14,
  labels: Readonly<Record<string, string>> = {},
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
    const text = textOf(node, labels).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (node.type === 'heading') {
      blocks.push({ kind: Number(node.attrs?.level) === 3 ? 'h3' : 'h2', text });
    } else {
      blocks.push({ kind: 'p', text });
    }
  }
  return { title: titleNode ? textOf(titleNode, labels).trim() : null, blocks };
}
