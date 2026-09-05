/**
 * Citation rows from a chapter document — PRD §8 `Citation`, Appendix B.5, PHASES 3.5.
 *
 *   "`Citation` rows upserted on save"
 *
 * The citation node's attrs are the only citation state in the document (B.2 rule); the table is
 * a queryable mirror of them, keyed by the node's stable `key`, so the bibliography, the export
 * and the coherence checks can ask "which sources does this chapter cite?" without parsing
 * ProseMirror JSON. It follows the document; it never leads it.
 */

export type CitationRow = {
  nodeKey: string;
  sourceId: string;
  chunkId: string | null;
  role: string;
  locator: string | null;
};

type PmNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
};

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Every citation node with a source, in document order. A node whose source was removed keeps
 * `sourceId: null` and is rendered red-dashed (B.5); it has no row, because a row must reference
 * a `Source` that exists. Duplicate keys (a copy-paste inside the same chapter) keep the first.
 */
export function citationsIn(doc: unknown): CitationRow[] {
  const rows: CitationRow[] = [];
  const seen = new Set<string>();

  const visit = (node: PmNode): void => {
    if (node.type === 'citation') {
      const attrs = node.attrs ?? {};
      const nodeKey = str(attrs.key);
      const sourceId = str(attrs.sourceId);
      if (nodeKey && sourceId && !seen.has(nodeKey)) {
        seen.add(nodeKey);
        rows.push({
          nodeKey,
          sourceId,
          chunkId: str(attrs.chunkId),
          role: str(attrs.role) ?? 'parenthetical',
          locator: str(attrs.locator),
        });
      }
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };

  if (doc && typeof doc === 'object') visit(doc as PmNode);
  return rows;
}
