/**
 * Model text → editor nodes (ADR-0045).
 *
 * Every path that puts AI text into the chapter — an accepted Assist suggestion, an applied
 * command, a citation-role rewrite — used to do the same three things slightly differently, and
 * two of them wrong: the citation node took the prompt-local passage id (`S1#c1`) as its key, so
 * every later suggestion that cited "its" first passage collided with an earlier node and the
 * labels crossed; and an equation the model wrote (`$\sigma = E\varepsilon$`) stayed as the raw
 * dollar text. This is the one converter they now share.
 *
 * - `{{cite:KEY}}` → a `citation` node. A key the document already holds (a command rewrite
 *   keeps the citations that were in the selection) is reused with its attributes intact; a key
 *   the server resolved for this request gets a **fresh** node key, and the label the server
 *   rendered is reported through `onCitation` so the caller can seed the label store. A key that
 *   is neither is dropped — PRD §10.6 leaves no dangling marker.
 * - `$…$`, `\(…\)` → `mathInline`; `$$…$$`, `\[…\]` → `mathInline` too when the fragment is
 *   inline (a block cannot sit inside a paragraph), the display form is kept for the draft
 *   converter in `@tc/ai`, which builds whole paragraphs.
 * - Everything else → text carrying the provenance mark.
 */

import type { Fragment as PmFragment, Node as PmNode, Schema } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';
import { newCitationKey } from './citation.js';

export type AiCitation = {
  /** The key as it appears in the text (`S1#c1`, or a node key already in the document). */
  key: string;
  sourceId: string | null;
  chunkId: string | null;
  /** The label the server rendered, e.g. "(Kumar, 2021)". */
  rendered?: string | null;
};

export type ExistingCitation = {
  sourceId: string | null;
  chunkId: string | null;
  role?: string | null;
  locator?: string | null;
  prefix?: string | null;
  suffix?: string | null;
};

export type AiTextOptions = {
  provenance: { kind: 'ASSIST' | 'COMMAND' | 'DRAFT'; actionId: string | null };
  /** Keys the server resolved for this request. */
  citations?: readonly AiCitation[];
  /** Keys already in the document (a rewrite keeps them as they were). */
  existing?: ReadonlyMap<string, ExistingCitation>;
  /** Called once per new citation node with the key it was given and the label to show. */
  onCitation?: (nodeKey: string, rendered: string | null, promptKey: string) => void;
};

/**
 * One pass over the text for the three things that are not plain words. Order matters inside
 * the alternation: `$$` before `$`, and the citation marker first because its body can hold
 * anything but `}`.
 *
 * Inline `$…$` is deliberately narrow — no line break, no leading or trailing space, not
 * followed by a digit (so "$5 and $10" is money, not maths) — because the cost of a false
 * positive is a sentence turned into an equation.
 */
export const AI_TOKEN_RE =
  /\{\{cite:([^}]+)\}\}|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\d$])/g;

export type AiToken =
  | { type: 'text'; text: string }
  | { type: 'cite'; key: string }
  | { type: 'math'; latex: string; display: boolean };

/** Splits model text into text, citation markers and equations. Pure; shared with tests. */
export function tokenizeAiText(text: string): AiToken[] {
  const out: AiToken[] = [];
  let last = 0;
  for (const match of text.matchAll(AI_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) });
    const [, cite, display1, display2, inline1, inline2] = match;
    if (cite !== undefined) out.push({ type: 'cite', key: cite.trim() });
    else if (display1 !== undefined || display2 !== undefined)
      out.push({ type: 'math', latex: (display1 ?? display2 ?? '').trim(), display: true });
    else out.push({ type: 'math', latex: (inline1 ?? inline2 ?? '').trim(), display: false });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** Inline nodes for one run of model text. */
export function aiTextToNodes(schema: Schema, text: string, options: AiTextOptions): PmNode[] {
  const provenance = schema.marks.provenance?.create({
    kind: options.provenance.kind,
    actionId: options.provenance.actionId,
  });
  const marks = provenance ? [provenance] : [];
  const resolved = new Map((options.citations ?? []).map((c) => [c.key, c]));
  const citationType = schema.nodes.citation;
  const mathType = schema.nodes.mathInline;
  const nodes: PmNode[] = [];

  const pushText = (value: string) => {
    if (value.length === 0) return;
    const previous = nodes[nodes.length - 1];
    if (previous?.isText)
      nodes[nodes.length - 1] = schema.text(`${previous.text ?? ''}${value}`, marks);
    else nodes.push(schema.text(value, marks));
  };

  for (const token of tokenizeAiText(text)) {
    if (token.type === 'text') {
      pushText(token.text);
      continue;
    }
    if (token.type === 'math') {
      if (mathType && token.latex.length > 0) nodes.push(mathType.create({ latex: token.latex }));
      else pushText(token.latex);
      continue;
    }
    if (!citationType) continue;
    const kept = options.existing?.get(token.key);
    if (kept) {
      nodes.push(
        citationType.create({
          key: token.key,
          sourceId: kept.sourceId,
          chunkId: kept.chunkId,
          role: kept.role ?? 'parenthetical',
          locator: kept.locator ?? null,
          prefix: kept.prefix ?? null,
          suffix: kept.suffix ?? null,
        }),
      );
      continue;
    }
    const citation = resolved.get(token.key);
    if (!citation) continue; // §10.6: not in the request, not in the document — gone.
    const nodeKey = newCitationKey();
    nodes.push(
      citationType.create({
        key: nodeKey,
        sourceId: citation.sourceId,
        chunkId: citation.chunkId,
      }),
    );
    options.onCitation?.(nodeKey, citation.rendered ?? null, token.key);
  }
  return nodes;
}

export function aiTextToFragment(schema: Schema, text: string, options: AiTextOptions): PmFragment {
  return Fragment.fromArray(aiTextToNodes(schema, text, options));
}

/** Every citation node in a range, by key — what a rewrite must keep (A.11 "never remove"). */
export function citationsInRange(
  doc: PmNode,
  from: number,
  to: number,
): Map<string, ExistingCitation> {
  const out = new Map<string, ExistingCitation>();
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'citation') {
      out.set(String(node.attrs.key), {
        sourceId: (node.attrs.sourceId as string | null) ?? null,
        chunkId: (node.attrs.chunkId as string | null) ?? null,
        role: (node.attrs.role as string | null) ?? null,
        locator: (node.attrs.locator as string | null) ?? null,
        prefix: (node.attrs.prefix as string | null) ?? null,
        suffix: (node.attrs.suffix as string | null) ?? null,
      });
    }
    return true;
  });
  return out;
}
