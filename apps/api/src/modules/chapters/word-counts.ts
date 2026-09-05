/**
 * Word counts by provenance, computed on save from the ProseMirror JSON — PRD Appendix B.4
 * ("computed on save by walking text nodes; stored on Chapter as a JSON breakdown; these feed
 * FR-8.6"). Server-side twin of `wordCountByProvenance` in packages/ui, working on JSON so the API
 * does not need a schema instance.
 */

export const PROVENANCE_KINDS = ['HUMAN', 'ASSIST', 'DRAFT', 'COMMAND', 'HUMAN_EDITED'] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];
export type WordCounts = Record<ProvenanceKind, number>;

type JsonNode = {
  type?: string;
  text?: string;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: JsonNode[];
};

export function wordCountsOf(doc: unknown): WordCounts {
  const counts: WordCounts = { HUMAN: 0, ASSIST: 0, DRAFT: 0, COMMAND: 0, HUMAN_EDITED: 0 };
  const walk = (node: JsonNode | undefined) => {
    if (!node) return;
    if (node.type === 'text' && typeof node.text === 'string') {
      const mark = node.marks?.find((m) => m.type === 'provenance');
      const kind = (mark?.attrs?.kind as ProvenanceKind | undefined) ?? 'HUMAN';
      const words = node.text.trim().split(/\s+/).filter(Boolean).length;
      counts[(PROVENANCE_KINDS as readonly string[]).includes(kind) ? kind : 'HUMAN'] += words;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc as JsonNode);
  return counts;
}

export function totalWords(counts: WordCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** A ProseMirror document must be `{ type: 'doc', content: [...] }`; anything else is rejected. */
export function looksLikeDoc(value: unknown): value is { type: 'doc'; content: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'doc' &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

/** Empty chapter body: the level-1 title heading plus one paragraph (Appendix B.2). */
export function emptyChapterDoc(title: string): { type: 'doc'; content: unknown[] } {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
      { type: 'paragraph' },
    ],
  };
}
