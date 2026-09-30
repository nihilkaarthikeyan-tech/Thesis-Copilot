/**
 * A saved version, as something a person can read before deciding to restore it.
 *
 * The History panel shows old text, not an editor: the only thing to do with a version is read it
 * and choose. So this walks the stored ProseMirror JSON and returns one line per block, with the
 * things that are not prose — a figure, a table, an equation — named rather than dropped, because
 * "the version before I deleted the table" is exactly what someone goes looking for.
 */

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
};

export type PreviewBlock = {
  kind: 'heading' | 'paragraph' | 'item' | 'object';
  /** Heading level, for `heading` only. */
  level?: number;
  text: string;
};

/** The text inside a block. Citations are shown as a marker; their label lives in storage. */
function textOf(node: Node): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'citation') return '[cite]';
  if (node.type === 'crossRef') return '[ref]';
  if (node.type === 'mathInline') return `$${String(node.attrs?.latex ?? '')}$`;
  if (node.type === 'hardBreak') return ' ';
  return (node.content ?? []).map(textOf).join('');
}

function blocksOf(node: Node, out: PreviewBlock[]): void {
  switch (node.type) {
    case 'heading':
      out.push({ kind: 'heading', level: Number(node.attrs?.level ?? 2), text: textOf(node) });
      return;
    case 'paragraph': {
      const text = textOf(node).trim();
      if (text) out.push({ kind: 'paragraph', text });
      return;
    }
    case 'listItem': {
      const text = (node.content ?? [])
        .map((child) => textOf(child))
        .join(' ')
        .trim();
      if (text) out.push({ kind: 'item', text });
      return;
    }
    case 'image':
      out.push({ kind: 'object', text: `Figure: ${String(node.attrs?.alt ?? 'untitled')}` });
      return;
    case 'table': {
      const rows = node.content?.length ?? 0;
      out.push({ kind: 'object', text: `Table: ${rows} ${rows === 1 ? 'row' : 'rows'}` });
      return;
    }
    case 'mathBlock':
      out.push({ kind: 'object', text: `Equation: ${String(node.attrs?.latex ?? '')}` });
      return;
    case 'draftBlock':
      out.push({ kind: 'object', text: 'A draft that had not been accepted' });
      return;
    default:
      for (const child of node.content ?? []) blocksOf(child, out);
  }
}

export function previewBlocks(doc: unknown): PreviewBlock[] {
  const out: PreviewBlock[] = [];
  for (const block of (doc as Node | undefined)?.content ?? []) blocksOf(block, out);
  return out;
}

/** Plain words, for comparing a version's length against the chapter now. */
export function wordsIn(blocks: readonly PreviewBlock[]): number {
  return blocks
    .filter((b) => b.kind !== 'object')
    .reduce((n, b) => n + (b.text.match(/\S+/g)?.length ?? 0), 0);
}

const REASON_LABEL: Record<string, string> = {
  AUTOSAVE: 'Autosaved',
  MANUAL: 'Saved with Ctrl+S',
  PRE_DRAFT_ACCEPT: 'Before accepting a draft',
  PRE_REVISION: 'Before accepting a revision',
  PRE_RESTORE: 'Before restoring an older version',
  PRE_CHAPTER_BUILD: 'Before a chapter build added its sections',
};

/** What caused a version, in words. Unknown reasons are shown as they are rather than hidden. */
export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}

/** "Today", "Yesterday", or the date — the headings the list is grouped under. */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
