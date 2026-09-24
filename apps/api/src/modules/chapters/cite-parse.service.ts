/**
 * Paste-parse — PRD FR-5.5, Appendix A.15, PHASES v2 W10.4.
 *
 *   "a pasted reference string or an imported draft's citations are parsed to structured fields
 *    (fast tier) then verified against Crossref/OpenAlex; unverifiable ones are flagged, never
 *    silently accepted."
 *
 * Two steps, in this order and never merged: the model parses, then Crossref is asked whether the
 * thing exists. What comes back to the browser says which of the two happened, so the screen can
 * offer "insert" for a verified match and "check manually" for everything else. Nothing is
 * inserted here — the student's click does that, through the normal source path.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildCiteParseRequest,
  doiIn,
  type ParsedCitation,
  type Providers,
  parsedCitationSchema,
  referenceLinesIn,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import {
  CrossrefClient,
  OpenAlexClient,
  RESOLUTION_THRESHOLD,
  type ResolvedSource,
  type Resolver,
  resolveByDoi,
  resolveReference,
} from '@tc/retrieval';
import { jobId, jobKeyDigest } from '@tc/types';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { ScholarlyIndexes } from '../../common/scholarly-indexes.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import type { SessionUser } from '../auth/current-user.decorator.js';

/** FR-5.5: one parsed reference and what verification made of it. */
export type ParseOutcome = {
  /** What the student pasted, unchanged. */
  raw: string;
  parsed: ParsedCitation;
  verified: boolean;
  /** Present when Crossref matched: the fields it returned, which are what get stored. */
  match: {
    doi: string | null;
    title: string | null;
    authors: Array<{ family?: string; given?: string }>;
    year: number | null;
    venue: string | null;
  } | null;
  /** Why it is not verified, in the words the panel shows. */
  note: string | null;
  /** Set once the student accepts it and a `Source` exists. */
  sourceId?: string;
};

const MAX_LINES = 40;

@Injectable()
export class CiteParseService {
  private readonly logger = new Logger(CiteParseService.name);
  private readonly resolver: Resolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
    indexes: ScholarlyIndexes,
  ) {
    // The same resolver the library uses, so a pasted reference is scored by the same C.3 rules
    // as one extracted from a paper — a match here means what it means everywhere else.
    this.resolver = {
      crossref: new CrossrefClient({ mailto: env.CROSSREF_MAILTO }),
      openalex: new OpenAlexClient({ mailto: env.OPENALEX_MAILTO }),
      // ADR-0020: a pasted arXiv DOI for an e-print OpenAlex has not indexed yet.
      arxiv: indexes.arxiv,
    };
  }

  private async owned(ownerId: string, documentId: string): Promise<{ id: string }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /**
   * One pasted block: either a single reference, or the reference list of an imported chapter.
   * Every line is parsed and verified independently, so one unrecognisable entry does not cost
   * the student the rest.
   */
  async parse(
    user: SessionUser,
    documentId: string,
    text: string,
  ): Promise<{ outcomes: ParseOutcome[] }> {
    await this.owned(user.id, documentId);
    const lines = referenceLinesIn(text);
    const references = (lines.length > 0 ? lines : [text.trim()])
      .filter(Boolean)
      .slice(0, MAX_LINES);

    const outcomes: ParseOutcome[] = [];
    for (const reference of references) {
      outcomes.push(await this.one(user, documentId, reference));
    }
    return { outcomes };
  }

  private async one(
    user: SessionUser,
    documentId: string,
    reference: string,
  ): Promise<ParseOutcome> {
    const request = buildCiteParseRequest({
      reference,
      userId: user.id,
      documentId,
    });
    const startedAt = Date.now();
    let parsed: ParsedCitation;
    try {
      const answer = await this.providers.llm.complete({
        ...request,
        schema: parsedCitationSchema,
      });
      await this.log(
        user.id,
        documentId,
        answer.modelId,
        answer.usage,
        Date.now() - startedAt,
        true,
      );
      parsed = answer.value;
    } catch (error) {
      await this.log(
        user.id,
        documentId,
        this.providers.llm.modelIdFor('fast'),
        null,
        Date.now() - startedAt,
        false,
        error,
      );
      return {
        raw: reference,
        parsed: parsedCitationSchema.parse({}),
        verified: false,
        match: null,
        note: 'The parser did not answer. Add this source by DOI from the Sources screen instead.',
      };
    }

    // A DOI printed in the string is worth more than one the model produced; both are checked
    // against Crossref, which is the only thing that can say the paper exists.
    const printed = doiIn(reference);
    const doi = printed ?? (parsed.doi.trim() || null);
    let resolved: ResolvedSource | null = null;
    try {
      resolved = doi
        ? await resolveByDoi(doi, this.resolver)
        : await resolveReference(parsed.title.trim() || reference, this.resolver);
    } catch (error) {
      this.logger.warn({ err: error, reference }, 'Crossref verification failed');
    }

    if (!resolved?.title) {
      return {
        raw: reference,
        parsed,
        verified: false,
        match: null,
        note: doi
          ? 'Crossref does not know that DOI — check it against the paper itself.'
          : 'No match in Crossref. It may be a book, a thesis, or a paper Crossref does not index; add it by hand from the Sources screen.',
      };
    }

    // FR-5.5's bar: a DOI lookup is authoritative; a title search has to clear the same C.3
    // similarity threshold the library uses, and say the same title that was pasted — otherwise
    // the "match" is a different paper with similar words.
    const same = doi
      ? true
      : resolved.score >= RESOLUTION_THRESHOLD &&
        titlesMatch(parsed.title || reference, resolved.title);
    return {
      raw: reference,
      parsed,
      verified: same,
      match: {
        doi: resolved.doi ?? null,
        title: resolved.title,
        authors: resolved.authors ?? [],
        year: resolved.year ?? null,
        venue: resolved.venue ?? null,
      },
      note: same
        ? null
        : `Crossref's closest match is “${resolved.title}”, which is not what you pasted. Check it before inserting.`,
    };
  }

  /**
   * The student accepted a verified parse: it becomes a `Source` through the same resolution the
   * rest of the library goes through, so it gets full text, chunks and a grounding badge.
   */
  async accept(
    user: SessionUser,
    documentId: string,
    reference: string,
    doi: string | null,
  ): Promise<{ sourceId: string; alreadyPresent: boolean }> {
    await this.owned(user.id, documentId);
    const raw = reference.trim();
    const existing = await this.prisma.source.findFirst({
      where: {
        documentId,
        OR: [{ rawReference: raw }, ...(doi ? [{ doi }] : [])],
      },
      select: { id: true },
    });
    if (existing) return { sourceId: existing.id, alreadyPresent: true };

    const source = await this.prisma.source.create({
      data: { documentId, status: 'PENDING', rawReference: raw, ...(doi ? { doi } : {}) },
      select: { id: true },
    });
    await this.queue.enqueue(
      'resolve-reference',
      { documentId, userId: user.id, rawReference: raw, ...(doi ? { printedDoi: doi } : {}) },
      { jobId: jobId('resolve-reference', documentId, jobKeyDigest(raw)) },
    );
    return { sourceId: source.id, alreadyPresent: false };
  }

  private async log(
    userId: string,
    documentId: string,
    model: string,
    usage: {
      inputTokens: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
      outputTokens: number;
    } | null,
    latencyMs: number,
    ok: boolean,
    error?: unknown,
  ): Promise<void> {
    const cost =
      ok && usage && this.env.AI_PROVIDER !== 'mock'
        ? computeCallCost({ tier: 'fast', modelId: model, usage })
        : 0;
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'PARSE_CITATION',
        model,
        inputTokens: usage?.inputTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        costMicroInr: BigInt(cost),
        latencyMs,
        ok,
        error: ok ? null : String(error instanceof Error ? error.message : error).slice(0, 500),
      },
    });
  }
}

/** Same paper or not: normalised, and generous about subtitles and punctuation, strict about words. */
export function titlesMatch(pasted: string, found: string): boolean {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter((w) => w.length > 3),
    );
  const a = words(pasted);
  const b = words(found);
  if (b.size === 0) return false;
  let shared = 0;
  for (const word of b) if (a.has(word)) shared++;
  return shared / b.size >= 0.6;
}
