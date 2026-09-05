/**
 * Paper extraction — PRD Appendix A.5, FR-1.2, §10.7.1.
 *
 * A.5's system block is loaded verbatim from `prompts/extract.md` (§0.3 rule 11). What lives here
 * is the part A.5 delegates to code:
 *
 *   "User message: `<paper filename="{{filename}}">{{full_text}}</paper>`. If `full_text` exceeds
 *    the model's input limit, the builder splits into ≤ 3 parts (front matter + body, references)
 *    and merges results in code; references always come from the part containing the reference
 *    section."
 */

import { emptyExtraction, type PaperExtraction, paperExtractionSchema } from '@tc/types';
import { loadPrompt } from './prompts.js';
import type { LlmProvider, LlmRequest } from './types.js';

/**
 * Characters of paper text per request. A.5 is a Strong-tier call with a 4,000-token output
 * budget (§10.1); the input budget is the model's context less the system block and the reply.
 * 320,000 characters is roughly 80k tokens at the ~4-chars-per-token approximation used
 * throughout (§11.1), which leaves ample headroom on a 200k-token model.
 */
export const DEFAULT_MAX_PART_CHARS = 320_000;

/** A.5: at most three parts. */
export const MAX_PARTS = 3;

/** Headings that open a reference list. */
const REFERENCE_HEADING =
  /^\s*(?:\d+\.?\s*)?(references|bibliography|works\s+cited|literature\s+cited|reference\s+list)\s*:?\s*$/im;

export type ExtractionPart = {
  text: string;
  /** True for the part holding the reference list; its `references` win when merging. */
  hasReferences: boolean;
  index: number;
};

/** Character offset where the reference list begins, or null if no heading was found. */
export function findReferenceSection(text: string): number | null {
  let offset = 0;
  let last: number | null = null;
  for (const line of text.split('\n')) {
    if (REFERENCE_HEADING.test(line)) last = offset;
    offset += line.length + 1;
  }
  // The last such heading wins: a paper may mention "References" in a table of contents first.
  return last;
}

/**
 * Splits a paper for extraction.
 *
 * Short papers are one part. Longer ones split at the reference heading, so the reference list
 * arrives whole in a single request — A.5 forbids guessing at truncated entries, and a list cut
 * across two requests would produce exactly that. If the body is still over budget it is split
 * once more, giving the three parts A.5 allows.
 */
export function splitForExtraction(
  text: string,
  maxPartChars: number = DEFAULT_MAX_PART_CHARS,
): ExtractionPart[] {
  if (text.length <= maxPartChars) {
    return [{ text, hasReferences: true, index: 0 }];
  }

  const referenceStart = findReferenceSection(text);
  if (referenceStart === null) {
    // No reference heading: split on a paragraph boundary and let the tail carry the references,
    // since a reference list sits at the end of a paper.
    const cut = paragraphBoundaryNear(text, maxPartChars);
    return [
      { text: text.slice(0, cut), hasReferences: false, index: 0 },
      { text: text.slice(cut), hasReferences: true, index: 1 },
    ];
  }

  const body = text.slice(0, referenceStart);
  const references = text.slice(referenceStart);

  if (body.length <= maxPartChars) {
    return [
      { text: body, hasReferences: false, index: 0 },
      { text: references, hasReferences: true, index: 1 },
    ];
  }

  // Body still too long: one more cut, for three parts in total.
  const cut = paragraphBoundaryNear(body, maxPartChars);
  return [
    { text: body.slice(0, cut), hasReferences: false, index: 0 },
    { text: body.slice(cut), hasReferences: false, index: 1 },
    { text: references, hasReferences: true, index: 2 },
  ];
}

/** Nearest paragraph break at or before `target`, so a part never ends mid-sentence. */
function paragraphBoundaryNear(text: string, target: number): number {
  const limit = Math.min(target, text.length);
  const paragraph = text.lastIndexOf('\n\n', limit);
  if (paragraph > limit * 0.5) return paragraph + 2;
  const line = text.lastIndexOf('\n', limit);
  return line > limit * 0.5 ? line + 1 : limit;
}

/** The A.5 user message. */
export function buildExtractionUserMessage(filename: string, partText: string): string {
  return `<paper filename="${filename}">${partText}</paper>`;
}

export function buildExtractionRequest(input: {
  userId: string;
  documentId?: string;
  filename: string;
  partText: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  return {
    tier: 'strong',
    // A.5 is "Not cached": a paper is read once, so a cached block would be written and never read.
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('extract').system}` },
    messages: [
      { role: 'user', content: buildExtractionUserMessage(input.filename, input.partText) },
    ],
    maxTokens: 4_000,
    temperature: 0,
    action: 'EXTRACT',
    userId: input.userId,
    ...(input.documentId ? { documentId: input.documentId } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/**
 * Merges the parts back into one extraction.
 *
 * Scalar fields (title, abstract, methodology) come from the first part that has them — the front
 * matter is in part one. Lists concatenate, de-duplicated. References come only from the part
 * flagged as holding the reference list, as A.5 requires: a body part that happens to quote a
 * citation must not contribute a reference.
 */
export function mergeExtractions(
  results: ReadonlyArray<{ part: ExtractionPart; extraction: PaperExtraction }>,
): PaperExtraction {
  const merged = emptyExtraction();
  const seenTerms = new Set<string>();
  const seenReferences = new Set<string>();
  const seenSections = new Set<string>();

  for (const { part, extraction } of [...results].sort((a, b) => a.part.index - b.part.index)) {
    if (!merged.title && extraction.title) merged.title = extraction.title;
    if (!merged.abstract && extraction.abstract) merged.abstract = extraction.abstract;
    if (!merged.methodology && extraction.methodology) merged.methodology = extraction.methodology;

    for (const objective of extraction.objectives) {
      if (!merged.objectives.includes(objective)) merged.objectives.push(objective);
    }
    merged.findings.push(...extraction.findings);

    for (const term of extraction.terminology) {
      const key = term.term.toLowerCase();
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      merged.terminology.push(term);
    }

    for (const section of extraction.sections) {
      const key = section.heading.toLowerCase();
      if (seenSections.has(key)) continue;
      seenSections.add(key);
      merged.sections.push(section);
    }

    if (part.hasReferences) {
      for (const reference of extraction.references) {
        const key = reference.raw.trim();
        if (seenReferences.has(key)) continue;
        seenReferences.add(key);
        merged.references.push(reference);
      }
    }
  }

  return merged;
}

export class ExtractionFailed extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ExtractionFailed';
  }
}

/**
 * Runs A.5 over a paper: split, one Strong-tier call per part, merge.
 *
 * PHASES 2.3: "retries once on invalid JSON". A model that returns malformed output usually
 * succeeds on a second attempt; a third would just cost money.
 */
export async function extractPaper(
  llm: LlmProvider,
  input: {
    userId: string;
    documentId?: string;
    filename: string;
    text: string;
    maxPartChars?: number;
    signal?: AbortSignal;
    onPart?: (info: { index: number; total: number }) => void;
  },
): Promise<{ extraction: PaperExtraction; parts: number; retries: number }> {
  const parts = splitForExtraction(input.text, input.maxPartChars);
  const results: Array<{ part: ExtractionPart; extraction: PaperExtraction }> = [];
  let retries = 0;

  for (const part of parts) {
    input.onPart?.({ index: part.index, total: parts.length });
    const request = {
      ...buildExtractionRequest({
        userId: input.userId,
        ...(input.documentId ? { documentId: input.documentId } : {}),
        filename: input.filename,
        partText: part.text,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
      schema: paperExtractionSchema,
    };

    let extraction: PaperExtraction | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await llm.complete(request);
        extraction = result.value;
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 1) retries++;
      }
    }

    if (!extraction) {
      throw new ExtractionFailed(
        `Extraction failed for part ${part.index + 1} of ${parts.length} of ${input.filename}`,
        lastError,
      );
    }
    results.push({ part, extraction });
  }

  return { extraction: mergeExtractions(results), parts: parts.length, retries };
}
