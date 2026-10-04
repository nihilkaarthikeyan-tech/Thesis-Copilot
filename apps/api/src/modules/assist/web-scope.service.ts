/**
 * "Find me papers about this" — the web scope for chat (ADR-0016, 2026-09-21).
 *
 * A competitor's chat offers a "Web Ask" button. Copying it directly was not possible: PRD §10.6
 * says the model may cite only passages present in the request, and everything else is stripped
 * and counted as `HALLUCINATED_CITE`. A prose answer synthesised from web pages has no passage to
 * ground against, no page number, and nothing that can enter a bibliography — it is precisely the
 * thing this product exists not to produce.
 *
 * So the owner chose the third option: **a web result is not an answer, it is a candidate source.**
 *
 * This searches the scholarly indexes the product already uses — OpenAlex, PubMed and arXiv
 * (ADR-0020) and, when a key is configured, Semantic Scholar — and returns *real works with real
 * metadata*. No prose is
 * generated. The model is not called at all on this path, which also means the scope is not
 * metered: there is no provider spend to meter.
 *
 * Adding one goes through `POST /documents/:id/sources/resolve`, the same path a pasted
 * bibliography takes. From that moment it is an ordinary `Source`: fetched, chunked, embedded,
 * and citable through the grounded pipeline like everything else. Nothing skips the queue.
 *
 * The honest summary of the trade: this answers "what has been written about X?" and refuses to
 * answer "what is the answer to X?". The second question is the one a general-purpose assistant
 * answers and a thesis tool must not.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@tc/config';
import {
  type DiscoveredWork,
  interleave,
  keywordsOf,
  mergeWorks,
  OpenAlexDiscovery,
  SemanticScholarClient,
} from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { ScholarlyIndexes } from '../../common/scholarly-indexes.service.js';

/** One candidate, with everything the panel needs to show it and to add it. */
export type WebResult = {
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  citationCount: number | null;
  isPreprint: boolean;
  openAccess: boolean;
  /** Already in this document's library — shown as such rather than offered again. */
  inLibrary: boolean;
  /** Which index found it first. An arXiv result links to arXiv, as arXiv's terms ask. */
  via: DiscoveredWork['via'];
  /** Exactly what `POST /sources/resolve` wants, so the client does not assemble it. */
  reference: { raw: string; doi?: string };
};

export const WEB_SCOPE = {
  maxResults: 8,
  /** Per index. One slow index costs its own results, never the whole answer. */
  timeoutMs: 12_000,
} as const;

/** A reference line good enough for the resolver to match on when there is no DOI. */
export function referenceLineOf(work: DiscoveredWork): string {
  return [work.title, work.venue, work.year].filter(Boolean).join('. ');
}

@Injectable()
export class WebScopeService {
  private readonly logger = new Logger(WebScopeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexes: ScholarlyIndexes,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The indexes a search will ask, by the names a student knows them by, in the order they are
   * asked — for chat's "Searching OpenAlex, Semantic Scholar…" step (ADR-0060). Semantic Scholar
   * is only asked when a key is configured, so it is only named then.
   */
  indexNames(): string[] {
    return [
      'OpenAlex',
      ...(this.env.SEMANTIC_SCHOLAR_API_KEY ? ['Semantic Scholar'] : []),
      'PubMed',
      'arXiv',
    ];
  }

  async search(
    ownerId: string,
    documentId: string,
    question: string,
    signal?: AbortSignal,
    /** ADR-0060 asks for more, so eight with abstracts usually survive its filter. */
    limit: number = WEB_SCOPE.maxResults,
  ): Promise<{ results: WebResult[]; query: string }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');

    const options = {
      mailto: this.env.OPENALEX_MAILTO ?? this.env.CROSSREF_MAILTO ?? '',
    };
    const openalex = new OpenAlexDiscovery({
      ...options,
      ...(this.env.OPENALEX_API_KEY ? { apiKey: this.env.OPENALEX_API_KEY } : {}),
    });

    // Every index is sent the question's content words, not the question. Rewriting it with the
    // model was rejected — it would make this a metered action — and sending it as typed was the
    // original choice, until a live check (2026-09-24, ADR-0020) put "What Will 5G Be?" first for
    // "What does the literature say about rooftop solar adoption barriers?": OpenAlex ranks the
    // question words too. `keywordsOf` drops them for nothing.
    const searchText = keywordsOf(question, 8).join(' ') || question;
    const s2 = this.env.SEMANTIC_SCHOLAR_API_KEY
      ? new SemanticScholarClient(this.env.SEMANTIC_SCHOLAR_API_KEY, options)
      : null;
    const clients = [
      { name: 'openalex', client: openalex },
      { name: 'semanticscholar', client: s2 },
      { name: 'pubmed', client: this.indexes.pubmed },
      { name: 'arxiv', client: this.indexes.arxiv },
    ].flatMap(({ name, client }) => (client ? [{ name, client }] : []));

    // All at once, each on its own clock: a failure or a timeout loses that index's results only.
    const lists = await Promise.all(
      clients.map(async ({ name, client }): Promise<DiscoveredWork[]> => {
        const timeout = AbortSignal.timeout(WEB_SCOPE.timeoutMs);
        try {
          return await client.search(
            searchText,
            new Date(),
            signal ? AbortSignal.any([signal, timeout]) : timeout,
          );
        } catch (error) {
          this.logger.warn({ err: error, index: name }, 'web scope search failed');
          return [];
        }
      }),
    );

    // Taken in turn, so each index that answered is on the page — eight results would otherwise
    // be eight of OpenAlex's.
    const works = mergeWorks([interleave(lists)]).slice(0, limit);

    // "Already yours" is worth knowing before adding: a student searching the literature will hit
    // their own seed papers constantly, and offering to add one again is how duplicates happen.
    const existing = await this.prisma.source.findMany({
      where: { documentId },
      select: { doi: true, title: true },
    });
    const haveDoi = new Set(
      existing.map((s) => s.doi?.toLowerCase()).filter((d): d is string => Boolean(d)),
    );
    const haveTitle = new Set(
      existing.map((s) => s.title?.trim().toLowerCase()).filter((t): t is string => Boolean(t)),
    );

    return {
      query: question,
      results: works.map((work) => ({
        title: work.title,
        abstract: work.abstract,
        year: work.year,
        venue: work.venue,
        doi: work.doi,
        citationCount: work.citationCount,
        isPreprint: work.isPreprint,
        // §2: whether the full text can actually be fetched decides whether a source can ever
        // reach FULL_TEXT grounding, so it is shown before the student spends a slot on it.
        openAccess: Boolean(work.oaStatus && work.oaStatus !== 'closed'),
        inLibrary:
          (work.doi ? haveDoi.has(work.doi.toLowerCase()) : false) ||
          haveTitle.has(work.title.trim().toLowerCase()),
        via: work.via,
        reference: {
          raw: referenceLineOf(work),
          ...(work.doi ? { doi: work.doi } : {}),
        },
      })),
    };
  }
}
