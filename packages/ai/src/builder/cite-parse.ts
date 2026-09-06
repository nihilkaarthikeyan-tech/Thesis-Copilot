/**
 * Citation parse — PRD FR-5.5, Appendix A.15, PHASES v2 W10.4.
 *
 * A Fast, temperature-0 structured call that turns a pasted reference string into fields. It is
 * the only step that guesses; A.15's own rules forbid it correcting spelling or inventing a DOI,
 * and the code that calls it verifies the result against Crossref before anything is inserted
 * (FR-5.5: "unverifiable ones are flagged, never silently accepted").
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';

export const CITE_PARSE = {
  tier: 'fast',
  maxTokens: 500,
  temperature: 0,
  /** A pasted reference longer than this is not a reference. */
  maxInputChars: 1_000,
} as const;

export const CSL_TYPES = [
  'article-journal',
  'book',
  'chapter',
  'paper-conference',
  'thesis',
  'report',
  'webpage',
  'unknown',
] as const;

/** A.15's output, verbatim. Every field may be empty; nothing here is trusted yet. */
export const parsedCitationSchema = z.object({
  type: z.enum(CSL_TYPES).default('unknown'),
  title: z.string().default(''),
  authors: z
    .array(z.object({ family: z.string().default(''), given: z.string().default('') }))
    .default([]),
  year: z.number().int().nullable().default(null),
  container: z.string().default(''),
  volume: z.string().default(''),
  issue: z.string().default(''),
  pages: z.string().default(''),
  doi: z.string().default(''),
  url: z.string().default(''),
});
export type ParsedCitation = z.infer<typeof parsedCitationSchema>;

export type CiteParseInput = {
  reference: string;
  userId: string;
  documentId?: string;
  signal?: AbortSignal;
};

export function buildCiteParseRequest(input: CiteParseInput): Omit<LlmRequest, 'schema'> {
  return {
    tier: CITE_PARSE.tier,
    // A.15 is a one-shot parse; there is no memory block to cache.
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('cite_parse').system}` },
    messages: [
      { role: 'user', content: input.reference.trim().slice(0, CITE_PARSE.maxInputChars) },
    ],
    maxTokens: CITE_PARSE.maxTokens,
    temperature: CITE_PARSE.temperature,
    action: 'PARSE_CITATION',
    userId: input.userId,
    ...(input.documentId ? { documentId: input.documentId } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/**
 * Citation-shaped strings in a block of text — what a chapter imported from `.docx` is full of.
 * The same patterns the mechanical check uses (FR-5.4), plus a full reference line, because an
 * imported bibliography is a list of them.
 */
const REFERENCE_LINE =
  /^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}\.)?\s*[A-Z][^\n]{20,400}\((?:19|20)\d{2}\)[^\n]{0,300}$/gm;

export function referenceLinesIn(text: string): string[] {
  REFERENCE_LINE.lastIndex = 0;
  const out: string[] = [];
  let match: RegExpExecArray | null = REFERENCE_LINE.exec(text);
  while (match) {
    const line = match[0].trim();
    if (line && !out.includes(line)) out.push(line);
    match = REFERENCE_LINE.exec(text);
  }
  return out;
}

/** A DOI printed in the string itself. Never guessed — A.15 forbids it, and so does §10.6. */
export function doiIn(text: string): string | null {
  const match = /\b10\.\d{4,9}\/[^\s"'<>,;]+/.exec(text);
  return match ? match[0].replace(/[.,;]+$/, '') : null;
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

/**
 * Reads the obvious shape out of a reference string — the year in brackets, the DOI if printed,
 * the leading family names, the title between the year and the container. It invents nothing: a
 * field it cannot see stays empty, which is exactly what A.15 asks the real model for.
 */
export const mockCiteParseResponse = {
  match: (req: { action: string }) => req.action === 'PARSE_CITATION',
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): ParsedCitation => {
    const text = (req.messages.at(-1)?.content ?? '').replace(/\s+/g, ' ').trim();
    const year = /\((19|20)\d{2}\)|\b(19|20)\d{2}\b/.exec(text)?.[0]?.replace(/[()]/g, '');
    const doi = doiIn(text) ?? '';
    const url = /\bhttps?:\/\/\S+/.exec(text)?.[0] ?? '';

    // Authors: the part before the year, split on "," and "&"/"and".
    const beforeYear = year ? text.slice(0, text.indexOf(year)) : '';
    const authors = beforeYear
      .replace(/\(|\)/g, '')
      .split(/,\s*(?:&\s*)?|\s+(?:and|&)\s+/)
      .map((part) => part.trim().replace(/\.$/, ''))
      .filter((part) => part.length > 1 && /[A-Za-z]/.test(part))
      .reduce<Array<{ family: string; given: string }>>((acc, part) => {
        // "Kumar" then "A." is one author across two fragments.
        const initials = /^[A-Z](\.\s*[A-Z])*\.?$/.test(part);
        const last = acc.at(-1);
        if (initials && last && !last.given) last.given = part;
        else acc.push({ family: part, given: '' });
        return acc;
      }, [])
      .slice(0, 20);

    // Title: between the year and the next full stop.
    const afterYear = year ? text.slice(text.indexOf(year) + year.length) : text;
    const segments = afterYear
      .replace(/^[).\s]+/, '')
      .split(/\.\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const title = segments[0] ?? '';
    const container = segments[1] ?? '';

    return parsedCitationSchema.parse({
      type: container ? 'article-journal' : 'unknown',
      title: title.replace(/[.,]$/, ''),
      authors,
      year: year ? Number(year) : null,
      container: container.replace(/[.,]$/, '').replace(/,?\s*\d+\s*\(\d+\).*$/, ''),
      volume: '',
      issue: '',
      pages: /\b(\d{1,4})\s*[–-]\s*(\d{1,4})\b/.exec(afterYear)?.[0] ?? '',
      doi,
      url,
    });
  },
};
