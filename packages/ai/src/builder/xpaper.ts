/**
 * Cross-paper consistency — PRD FR-1.6, Appendix A.16, PHASES 6.2.
 *
 * Runs once after every seed paper of a document is extracted (two or three papers). The prompt
 * is a structured Strong-tier call; this file builds its `<papers>` block from the stored
 * extractions, validates the JSON it returns, and merges terminology into the glossary the way
 * PHASES 6.2 asks: "dedupe by term, keep both definitions if they differ and flag".
 */

import type { PaperExtraction } from '@tc/types';
import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';

export const XPAPER = {
  tier: 'strong',
  maxTokens: 2_000,
  temperature: 0,
  /** FR-1.6: "Multi-paper (2–3 files)". */
  minPapers: 2,
  maxPapers: 3,
} as const;

export const crossPaperSchema = z.object({
  overlaps: z.array(z.object({ claim: z.string().trim().min(1), papers: z.array(z.string()) })),
  contradictions: z.array(
    z.object({
      topic: z.string().trim().min(1),
      a: z.object({ paper: z.string(), claim: z.string() }),
      b: z.object({ paper: z.string(), claim: z.string() }),
      explanation: z.string().max(400),
    }),
  ),
  terminology: z.array(
    z.object({
      term: z.string().trim().min(1),
      definitions: z.array(z.object({ paper: z.string(), definition: z.string() })),
    }),
  ),
});
export type CrossPaperResult = z.infer<typeof crossPaperSchema>;

export type CrossPaperInput = {
  /** In upload order; the id is what the model refers to ("p1", "p2", …). */
  papers: ReadonlyArray<{ id: string; title: string; extraction: PaperExtraction }>;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** A.16: "<papers> with one <paper id="p1" title="…"> block per extraction". */
export function crossPaperUserMessage(papers: CrossPaperInput['papers']): string {
  const blocks = papers.map(({ id, title, extraction }) => {
    const lines = [
      `<paper id="${id}" title="${escapeAttr(title || extraction.title)}">`,
      'Objectives:',
      ...extraction.objectives.map((o) => `- ${o}`),
      `Methodology: ${extraction.methodology || '(not stated)'}`,
      'Findings:',
      ...extraction.findings.map((f) => `- ${f.claim}${f.evidence ? ` [${f.evidence}]` : ''}`),
      'Terminology:',
      ...extraction.terminology.map((t) => `- ${t.term}: ${t.definition}`),
      '</paper>',
    ];
    return lines.join('\n');
  });
  return `<papers>\n${blocks.join('\n')}\n</papers>`;
}

export function buildCrossPaperRequest(input: CrossPaperInput): Omit<LlmRequest, 'schema'> {
  return {
    tier: XPAPER.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('xpaper').system}` },
    messages: [{ role: 'user', content: crossPaperUserMessage(input.papers) }],
    maxTokens: XPAPER.maxTokens,
    temperature: XPAPER.temperature,
    action: 'CROSS_PAPER',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Merged glossary (PHASES 6.2)
// ---------------------------------------------------------------------------------------------

export type GlossaryValue = {
  definition: string;
  usageNote?: string;
  /** PHASES 6.2: "keep both definitions if they differ and flag". */
  alternatives?: Array<{ paper: string; definition: string }>;
  conflict?: boolean;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Adds one paper's terminology to the glossary. A term already present with the same definition
 * is left alone; a different definition is kept alongside and the entry is flagged. The first
 * definition stays the primary one so the memory block (A.0) does not change under the student.
 */
export function mergeTerminology(
  glossary: Record<string, GlossaryValue>,
  paper: string,
  terminology: PaperExtraction['terminology'],
): { glossary: Record<string, GlossaryValue>; conflicts: string[] } {
  const out: Record<string, GlossaryValue> = { ...glossary };
  const conflicts: string[] = [];
  const keyFor = (term: string) =>
    Object.keys(out).find((k) => norm(k) === norm(term)) ?? term.trim();

  for (const t of terminology) {
    const key = keyFor(t.term);
    const existing = out[key];
    if (!existing) {
      out[key] = { definition: t.definition, ...(t.usageNote ? { usageNote: t.usageNote } : {}) };
      continue;
    }
    if (norm(existing.definition) === norm(t.definition)) continue;
    const alternatives = existing.alternatives ?? [];
    if (alternatives.some((a) => norm(a.definition) === norm(t.definition))) continue;
    out[key] = {
      ...existing,
      alternatives: [...alternatives, { paper, definition: t.definition }],
      conflict: true,
    };
    conflicts.push(key);
  }
  return { glossary: out, conflicts };
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

/**
 * A `MockResponse` for CROSS_PAPER that reads the `<papers>` block it was given and reports only
 * what is literally there: a finding stated word-for-word in two papers is an overlap, a term
 * defined differently in two papers is a terminology difference. No contradiction is ever
 * invented, because the mock cannot judge one.
 */
export const mockCrossPaperResponse = {
  match: (req: { action: string }) => req.action === 'CROSS_PAPER',
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): CrossPaperResult => {
    const text = req.messages.at(-1)?.content ?? '';
    const papers = [...text.matchAll(/<paper id="([^"]+)"[^>]*>([\s\S]*?)<\/paper>/g)].map((m) => {
      const body = m[2] ?? '';
      const section = (name: string) =>
        (new RegExp(`${name}:\\n([\\s\\S]*?)(?=\\n[A-Z][a-z]+:|$)`).exec(body)?.[1] ?? '')
          .split('\n')
          .map((l) => l.replace(/^- /, '').trim())
          .filter(Boolean);
      return {
        id: m[1] ?? '',
        findings: section('Findings').map((f) => f.replace(/\s*\[[^\]]*\]$/, '')),
        terms: section('Terminology').map((line) => {
          const i = line.indexOf(':');
          return { term: line.slice(0, i).trim(), definition: line.slice(i + 1).trim() };
        }),
      };
    });

    const overlaps: CrossPaperResult['overlaps'] = [];
    const seen = new Map<string, string[]>();
    for (const p of papers) {
      for (const f of p.findings) {
        const list = seen.get(norm(f)) ?? [];
        if (!list.includes(p.id)) list.push(p.id);
        seen.set(norm(f), list);
        if (list.length === 2) overlaps.push({ claim: f, papers: list });
      }
    }

    const terminology: CrossPaperResult['terminology'] = [];
    const byTerm = new Map<
      string,
      { term: string; definitions: Array<{ paper: string; definition: string }> }
    >();
    for (const p of papers) {
      for (const t of p.terms) {
        const entry = byTerm.get(norm(t.term)) ?? { term: t.term, definitions: [] };
        entry.definitions.push({ paper: p.id, definition: t.definition });
        byTerm.set(norm(t.term), entry);
      }
    }
    for (const entry of byTerm.values()) {
      const distinct = new Set(entry.definitions.map((d) => norm(d.definition)));
      if (entry.definitions.length >= 2 && distinct.size >= 2) terminology.push(entry);
    }

    return { overlaps, contradictions: [], terminology };
  },
};
