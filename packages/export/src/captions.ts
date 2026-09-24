/**
 * Captions for figures and tables — one answer, read by every exporter and the compliance check.
 *
 * Until 2026-09-24 there were three answers and none was right. A figure's caption was its `alt`,
 * which the editor set to the uploaded file's name, so the submitted thesis read "Figure 3.1:
 * IMG_2034.png". A table's caption was a `caption` attribute the table node did not have, so every
 * table read "Table 2.1:" and stopped. And the compliance check took a paragraph beside the figure
 * starting "Figure…" as its caption — so a student who did what it asked and typed one got it
 * printed twice, under the exporter's own.
 *
 * Now a caption is the node's `caption`, which the editor lets the student write. A caption the
 * student typed as a paragraph beside the figure ("Figure 2: Survey sites") is taken as that
 * figure's caption and not printed again (`withCaptionsResolved`) — their words, in the place and
 * numbering the template wants. A file name is never a caption.
 */

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

/**
 * The caption a figure or table carries, or ''. Never `alt`: the editor has only ever set that to
 * the uploaded file's name, and a file name is not a caption.
 */
export function captionOf(node: Node): string {
  return typeof node.attrs?.caption === 'string' ? node.attrs.caption.trim() : '';
}

/**
 * A rendered label with its caption: "Figure 3.1: Survey sites", or "Figure 3.1" when there is
 * none — not "Figure 3.1:" with nothing after it. `rendered` still holds `{caption}`.
 */
export function withCaption(rendered: string, caption: string): string {
  if (caption) return rendered.replace('{caption}', caption);
  return rendered.replace(/\s*[:.\-–—]?\s*\{caption\}/, '').trim();
}

/**
 * The words of a paragraph a student typed as a caption, or null. It has to look like one: the
 * label, a number, a separator, then text — "Figure 2: Survey sites", "Table 3.1 – Results". A
 * sentence that begins "Figure 2 shows…" is prose, and stays prose.
 */
export function typedCaption(text: string, kind: 'figure' | 'table'): string | null {
  const label = kind === 'figure' ? '(?:figure|fig\\.)' : 'table';
  const match = new RegExp(
    `^\\s*${label}\\s+[A-Z]?\\d+(?:[.\\-–]\\d+)*\\s*[:.\\-–—]\\s+(\\S[\\s\\S]*?)\\s*$`,
    'i',
  ).exec(text);
  return match?.[1] ?? null;
}

const kindOf = (node: Node): 'figure' | 'table' | null =>
  node.type === 'image' ? 'figure' : node.type === 'table' ? 'table' : null;

/** A paragraph's text, or null if it holds anything but text — a citation must not be lost. */
function plainParagraph(node: Node): string | null {
  if (node.type !== 'paragraph') return null;
  let text = '';
  for (const child of node.content ?? []) {
    if (child.type !== 'text') return null;
    text += child.text ?? '';
  }
  return text.length <= 400 ? text : null;
}

/**
 * The document with every typed caption moved into the figure or table it belongs to.
 *
 * A figure or table with no caption of its own takes the caption-shaped paragraph right after it,
 * or failing that right before it; the paragraph is then not part of the text. Only a paragraph of
 * plain text is taken, so a caption carrying a citation stays where it is rather than losing it.
 */
export function withCaptionsResolved(content: unknown): unknown {
  const resolve = (node: Node): Node => {
    if (!node.content) return node;
    const children = node.content.map(resolve);
    const taken = new Set<number>();
    const updated = children.map((child, i) => {
      const kind = kindOf(child);
      if (!kind || captionOf(child)) return child;
      for (const j of [i + 1, i - 1]) {
        const candidate = children[j];
        if (!candidate || taken.has(j) || kindOf(candidate)) continue;
        const text = plainParagraph(candidate);
        const caption = text === null ? null : typedCaption(text, kind);
        if (caption) {
          taken.add(j);
          return { ...child, attrs: { ...child.attrs, caption } };
        }
      }
      return child;
    });
    return { ...node, content: updated.filter((_, i) => !taken.has(i)) };
  };
  return content && typeof content === 'object' ? resolve(content as Node) : content;
}
