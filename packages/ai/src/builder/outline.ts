/**
 * Outline generation — PRD FR-3.2, FR-3.3, Appendix A.9, PHASES v2 W8.2.
 *
 * One Strong, structured call per document: `<template>` (the chapter shape), `<scope>` (the
 * student's saved proposal), `<gap_map>` (themes with counts and thin flags) and, for Path B,
 * `<extraction>` (the paper's own sections and findings). The result validates against §10.7.2.
 *
 * What this file adds around the prompt: stable slug ids (A.9 asks for them but a model is not a
 * reliable slug generator), the guarantee that the tree keeps the template's top-level chapters
 * when the template is not flexible, and a mock that maps the paper's sections and names what a
 * thesis needs beyond them — inventing no content, only structure.
 */

import { type ChapterRole, renderTemplateBlock, TEMPLATE_SPECS, type Template } from '@tc/config';
import { type OutlineNode, outlineSchema, type PaperExtraction } from '@tc/types';
import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import { renderScope, type ScopeForQueries } from './queries.js';

export const OUTLINE = {
  tier: 'strong',
  /**
   * 6,000, not §11.2's 3,000.
   *
   * A.9 asks for a scope note of "2-4 sentences: what this part must establish and what it must
   * not cover" on every node, and a template's worth of chapters with their children is around
   * thirty nodes. Measured against a real model on 2026-09-14: the first full outline ran to 3,552
   * tokens of JSON and was still cut off mid-array, `finishReason: length`, which `generateObject`
   * reports as "could not parse the response" — an outline that failed for being too good.
   *
   * The mock never showed this because the mock writes one-line scope notes.
   *
   * It is a one-time operation per document, so the cost is small and amortised: `ONE_TIME_PROFILES
   * .OUTLINE` in `packages/config` carries the matching output estimate.
   */
  maxTokens: 6_000,
  temperature: 0.3,
} as const;

export type GapMapTheme = { name: string; count: number; thin: boolean };

export type OutlineBuildInput = {
  template: Template;
  scope: ScopeForQueries;
  gapMap?: readonly GapMapTheme[];
  /** Path B only (FR-3.3). */
  extraction?: PaperExtraction | null;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

/**
 * What `readOutlineResult` will accept: a bare array, or an array under `outline` or `nodes`.
 * The model may omit ids or children; both are filled in afterwards.
 *
 * Not the schema to *ask* for — see `outlineRequestSchema`.
 */
export const outlineResultSchema = z.union([
  outlineSchema,
  z.object({ outline: outlineSchema }),
  z.object({ nodes: outlineSchema }),
]);

/**
 * The schema sent to the provider, which has to be a single JSON object.
 *
 * `outlineResultSchema` is a union whose first member is a bare array, and a union compiles to
 * `anyOf` with no top-level `type`. OpenAI's `response_format` refuses it — "schema must be a JSON
 * Schema of 'type: \"object\"', got 'type: \"None\"'" — which killed every outline generation
 * against a real model (`pnpm ai:shakedown`, 2026-09-14).
 *
 * The leniency the union buys is still worth having, so the two schemas stay separate rather than
 * one being narrowed into the other: this is what we ask for, that is what we will put up with.
 * `readOutlineResult` accepts `{ nodes }` already, so the consumer needs no change.
 */
export const outlineRequestSchema = z.object({ nodes: outlineSchema });

export function outlineUserMessage(input: OutlineBuildInput): string {
  const parts = [renderTemplateBlock(input.template), renderScope(input.scope)];
  if (input.gapMap && input.gapMap.length > 0) {
    parts.push(
      [
        '<gap_map>',
        ...input.gapMap.map(
          (t) =>
            `- ${t.name} | ${t.count} source${t.count === 1 ? '' : 's'}${t.thin ? ' | thin' : ''}`,
        ),
        '</gap_map>',
      ].join('\n'),
    );
  }
  if (input.extraction) {
    const e = input.extraction;
    parts.push(
      [
        '<extraction>',
        `Title: ${e.title}`,
        'Sections:',
        ...e.sections.map((s) => `- ${s.heading}${s.summary ? `: ${s.summary}` : ''}`),
        'Findings:',
        ...e.findings.map((f) => `- ${f.claim}`),
        '</extraction>',
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}

export function buildOutlineRequest(input: OutlineBuildInput): Omit<LlmRequest, 'schema'> {
  return {
    tier: OUTLINE.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('outline').system}` },
    messages: [{ role: 'user', content: outlineUserMessage(input) }],
    maxTokens: OUTLINE.maxTokens,
    temperature: OUTLINE.temperature,
    action: 'OUTLINE',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

const slug = (title: string, max = 40) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'section';

/**
 * A.9 asks for stable slugs like `ch2-literature-review` and `ch2-sec3-adoption-barriers`. Ids are
 * regenerated here from position and title so they are always in that shape and always unique;
 * a model-supplied id is kept only when it is already unique and slug-shaped, so re-running on an
 * unchanged document does not renumber the tree.
 */
export function normaliseOutline(nodes: readonly OutlineNode[]): OutlineNode[] {
  const used = new Set<string>();
  const take = (candidate: string): string => {
    let id = candidate;
    let n = 2;
    while (used.has(id)) id = `${candidate}-${n++}`;
    used.add(id);
    return id;
  };
  const visit = (list: readonly OutlineNode[], prefix: string): OutlineNode[] =>
    list.map((node, i) => {
      const here = prefix ? `${prefix}-sec${i + 1}` : `ch${i + 1}`;
      const wanted =
        node.id && /^[a-z0-9-]+$/.test(node.id) && !used.has(node.id)
          ? node.id
          : `${here}-${slug(node.title)}`;
      const id = take(wanted);
      return {
        id,
        title: node.title.trim(),
        scopeNote: node.scopeNote.trim(),
        ...(node.subTheme ? { subTheme: node.subTheme } : {}),
        ...(node.mappedFromPaperSection
          ? { mappedFromPaperSection: node.mappedFromPaperSection }
          : {}),
        children: visit(node.children ?? [], here),
      };
    });
  return visit(nodes, '');
}

/** Reads whichever wrapper the model used and normalises the tree. */
export function readOutlineResult(value: unknown): OutlineNode[] {
  const parsed = outlineResultSchema.safeParse(value);
  if (!parsed.success) return [];
  const nodes = Array.isArray(parsed.data)
    ? parsed.data
    : 'outline' in parsed.data
      ? parsed.data.outline
      : parsed.data.nodes;
  return normaliseOutline(nodes);
}

/**
 * A.9's first rule, enforced: with a fixed-count template, the top level is the template's chapter
 * list. A chapter the model dropped is added back from the template (with the template's intent as
 * its scope note, so the gap is visible rather than silent); anything extra is folded in as a
 * child of the nearest preceding chapter.
 */
export function enforceTemplateShape(nodes: OutlineNode[], template: Template): OutlineNode[] {
  const spec = TEMPLATE_SPECS[template];
  if (spec.flexibleChapterCount) return nodes;

  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const remaining = [...nodes];
  const out: OutlineNode[] = [];
  for (const chapter of spec.chapters) {
    const key = norm(chapter.title);
    const i = remaining.findIndex(
      (n) => norm(n.title).includes(key) || key.includes(norm(n.title)),
    );
    if (i >= 0) {
      out.push(remaining.splice(i, 1)[0] as OutlineNode);
    } else {
      out.push({
        id: `ch${out.length + 1}-${slug(chapter.title)}`,
        title: chapter.title,
        scopeNote: `${chapter.intent} (added from the template — the outline did not include it.)`,
        children: [],
      });
    }
  }
  // Anything left over becomes a section of the chapter before it rather than a lost chapter.
  for (const extra of remaining) {
    const host = out.at(-1);
    if (host) host.children.push(extra);
  }
  return normaliseOutline(out);
}

/** The chapter role for a top-level node, by position in the template. Used by the scaffold UI. */
export function roleForChapter(template: Template, index: number): ChapterRole {
  return TEMPLATE_SPECS[template].chapters[index]?.role ?? 'DISCUSSION';
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

/** What a thesis needs that a paper does not have (A.9's third rule, as structure only). */
const THESIS_ADDITIONS: Array<{ title: string; scopeNote: string }> = [
  {
    title: 'Extended Literature Review',
    scopeNote:
      'Review the field by sub-theme at thesis length, beyond the related work the paper summarised. Establish what is settled and what is not. Do not repeat the paper’s introduction.',
  },
  {
    title: 'Methodology Justification',
    scopeNote:
      'Justify the design and the choices the paper reported without arguing for. Explain alternatives considered and why they were rejected.',
  },
  {
    title: 'Limitations',
    scopeNote:
      'State honestly what the design cannot show, and how that bounds the claims. Do not defend; describe.',
  },
  {
    title: 'Conclusion and Future Work',
    scopeNote:
      'Answer the objectives in order, state the contribution, and name the next steps the work opens.',
  },
];

/**
 * An A.9-shaped outline built from the inputs themselves: the template's chapters, one Literature
 * Review section per gap-map theme (thin themes say so), the paper's sections mapped onto
 * chapters, and the standard additions named. It writes no prose beyond the template's own intent
 * lines and the student's theme names.
 */
export const mockOutlineResponse = {
  match: (req: { action: string }) => req.action === 'OUTLINE',
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): OutlineNode[] => {
    const text = req.messages.at(-1)?.content ?? '';
    const templateName = /<template name="([^"]*)"/.exec(text)?.[1] ?? '';
    const chapterLines = [...text.matchAll(/^- (.+?) — (.+)$/gm)].map((m) => ({
      title: (m[1] ?? '').trim(),
      intent: (m[2] ?? '').trim(),
    }));
    const themes = [...text.matchAll(/^- (.+?) \| (\d+) sources?(?: \| (thin))?$/gm)].map((m) => ({
      name: (m[1] ?? '').trim(),
      count: Number(m[2] ?? 0),
      thin: m[3] === 'thin',
    }));
    const paperSections = (() => {
      const block = /<extraction>([\s\S]*?)<\/extraction>/.exec(text)?.[1] ?? '';
      const sectionsPart = /Sections:\n([\s\S]*?)(?:\nFindings:|$)/.exec(block)?.[1] ?? '';
      return [...sectionsPart.matchAll(/^- (.+)$/gm)].map(
        (m) => (m[1] ?? '').split(':')[0]?.trim() ?? '',
      );
    })();

    const nodes: OutlineNode[] = chapterLines.map((chapter, i) => {
      const isLiterature = /literature/i.test(chapter.title);
      const children: OutlineNode[] = isLiterature
        ? themes.map((t, j) => ({
            id: `ch${i + 1}-sec${j + 1}-${slug(t.name)}`,
            title: t.name,
            scopeNote: t.thin
              ? `Review what the ${t.count} source${t.count === 1 ? '' : 's'} on this theme establish. Only ${t.count} available; needs expansion.`
              : `Review the ${t.count} sources on this theme: what they establish, where they disagree, what they leave open.`,
            subTheme: t.name,
            children: [],
          }))
        : [];
      const mapped = paperSections.find(
        (s) => s && slug(s).includes(slug(chapter.title).split('-')[0] ?? ''),
      );
      return {
        id: `ch${i + 1}-${slug(chapter.title)}`,
        title: chapter.title,
        scopeNote: chapter.intent,
        ...(mapped ? { mappedFromPaperSection: mapped } : {}),
        children,
      };
    });

    // A.9: "explicitly add what a thesis needs that the paper does not have".
    if (paperSections.length > 0) {
      for (const addition of THESIS_ADDITIONS) {
        const already = nodes.some((n) => slug(n.title) === slug(addition.title));
        if (
          !already &&
          !nodes.some((n) =>
            n.title.toLowerCase().includes(addition.title.toLowerCase().split(' ')[0] ?? ''),
          )
        ) {
          nodes.push({
            id: `ch${nodes.length + 1}-${slug(addition.title)}`,
            title: addition.title,
            scopeNote: addition.scopeNote,
            children: [],
          });
        }
      }
    }
    void templateName;
    return nodes;
  },
};
