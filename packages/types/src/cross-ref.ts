/**
 * "As Figure 3.2 shows" — numbering that survives an insertion (2026-09-21).
 *
 * A thesis refers to its own figures and tables constantly, and a student types those numbers by
 * hand. Then they insert one more figure in section 3.1 and every reference after it is silently
 * wrong — in the submitted PDF, where nobody will check them all. It is the classic thesis
 * formatting failure and it is entirely mechanical.
 *
 * A cross-reference stores **which** figure it points at (`refId`), never the number. The number
 * is computed from document order every time anything renders — the editor while typing, and the
 * exporter when it builds the `.docx` — so inserting a figure renumbers the references to it in
 * the same breath.
 *
 * ## Why this lives in `@tc/types`
 *
 * Both sides have to agree exactly, and they are in different packages: the editor's node view is
 * in `@tc/ui`, the `.docx` writer is in `@tc/export`. Two implementations of "figures are numbered
 * in document order" would be one implementation and one bug — the editor would show 3.2 and the
 * submitted file would say 3.3, and the student would find out from their examiner. This is the
 * one place both can reach.
 *
 * It returns an **index**, not a label. Formatting belongs to the caller: the exporter follows the
 * university template's pattern (`{chapter}.{n}`), and the editor has no template.
 */

export type RefKind = 'figure' | 'table';

export type NumberedTarget = {
  refId: string;
  kind: RefKind;
  /** 1-based, within the chapter, in document order. */
  index: number;
};

/** The node shapes this walks. Structural only — nothing here validates a document. */
type Node = {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: Node[];
};

/**
 * A figure or table's stable identity.
 *
 * An image carries `key` already — its object-storage path, which is unique and outlives any
 * edit. `refId` is the general case and what a table uses. Falling back through both means a
 * document written before cross-references existed still numbers correctly; only *pointing* at
 * one needs an id.
 */
export function refIdOf(node: Node): string | null {
  const attrs = node.attrs ?? {};
  for (const field of ['refId', 'key']) {
    const value = attrs[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export function kindOfNode(node: Node): RefKind | null {
  if (node.type === 'image') return 'figure';
  if (node.type === 'table') return 'table';
  return null;
}

/**
 * Every figure and table in one chapter, numbered in the order they appear.
 *
 * Figures and tables count separately — "Figure 3.1" and "Table 3.1" both exist in the same
 * chapter and neither displaces the other, which is what every university template expects.
 */
export function numberTargets(doc: unknown): NumberedTarget[] {
  const out: NumberedTarget[] = [];
  const counts: Record<RefKind, number> = { figure: 0, table: 0 };

  const walk = (node: Node | undefined): void => {
    if (!node || typeof node !== 'object') return;
    const kind = kindOfNode(node);
    if (kind) {
      counts[kind] += 1;
      const refId = refIdOf(node);
      // A figure with no id is still *counted* — it occupies a number, and skipping it would
      // shift every later figure. It simply cannot be pointed at.
      if (refId) out.push({ refId, kind, index: counts[kind] });
      // A table's cells never contain another table or figure worth numbering; not descending
      // also stops a nested structure double-counting.
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };

  walk(doc as Node);
  return out;
}

/** `refId` → its number, for resolving cross-references in one pass. */
export function numberingMap(doc: unknown): Map<string, NumberedTarget> {
  return new Map(numberTargets(doc).map((target) => [target.refId, target]));
}

/**
 * What a cross-reference reads as.
 *
 * `chapter` is the chapter's own number, so a reference in chapter 3 to its second figure reads
 * "Figure 3.2". A reference whose target has been deleted renders as a visible marker rather than
 * a plausible-looking number — a wrong number is worse than an obvious gap, because only one of
 * them gets noticed before submission.
 */
export function formatRef(
  target: NumberedTarget | undefined,
  chapter: number,
  kind: RefKind,
): string {
  const label = kind === 'figure' ? 'Figure' : 'Table';
  if (!target) return `[${label} — deleted]`;
  return `${label} ${chapter}.${target.index}`;
}
