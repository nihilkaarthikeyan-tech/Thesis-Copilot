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

/**
 * Keys that must never reach a node's `attrs`.
 *
 * GHSA (moderate, `@tiptap/core` < 3.30.4): `mergeAttributes()` turns an own `__proto__` key into
 * inherited executable DOM attributes. PRD §7.2 fixes TipTap at v2, so the patched version is a
 * major upgrade and an ADR — `docs/PENDING.md` carries the decision.
 *
 * Fastify's JSON parser already refuses a **request body** containing `__proto__` outright (a 400
 * before this code runs; the smoke test in `docs/BUILD_LOG.md` shows both halves). This covers the
 * paths that do not go through it: the worker writing a drafted section, and a `citation` node
 * whose attributes are built from Crossref and OpenAlex metadata. `constructor` and `prototype`
 * pass the parser, so they are stripped here too.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Strips those keys from every object in a ProseMirror document, in place. */
export function stripUnsafeKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripUnsafeKeys(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      delete (value as Record<string, unknown>)[key];
      continue;
    }
    stripUnsafeKeys((value as Record<string, unknown>)[key]);
  }
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
