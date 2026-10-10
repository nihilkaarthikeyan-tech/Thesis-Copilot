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
  CHAT_RESEARCH,
  type DiscoveredWork,
  interleave,
  keywordsOf,
  type MatchedPassage,
  matchingPassage,
  mergeWorks,
  OpenAlexDiscovery,
  type ResearchPlan,
  type SearchFn,
  SemanticScholarClient,
  searchWithinBudget,
  type WorkFilters,
} from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { ScholarlyIndexes } from '../../common/scholarly-indexes.service.js';
import {
  type IndexName,
  type IndexOutcome,
  outcomeOfCount,
  outcomeOfError,
  type SearchedList,
  type SearchStatus,
  searchStatus,
  withStatus,
} from './search-status.js';

type Searcher = (
  query: string,
  now?: Date,
  signal?: AbortSignal,
  filters?: WorkFilters,
) => Promise<DiscoveredWork[]>;

/** The outcomes in the order the indexes are asked, whatever order they answered in. */
function sortOutcomes(
  outcomes: readonly IndexOutcome[],
  order: ReadonlyArray<{ name: IndexName }>,
): IndexOutcome[] {
  const rank = new Map(order.map(({ name }, i) => [name, i]));
  return [...outcomes].sort((a, b) => (rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0));
}

/** One candidate, with everything the panel needs to show it and to add it. */
export type WebResult = {
  title: string;
  abstract: string | null;
  /**
   * The one or two sentences of `abstract` that best match the student's question, verbatim,
   * with the matching words marked (coverage-map row 23). Null when there is no abstract or
   * nothing in it matches: never text that was not in the fetched record.
   */
  matchedPassage: MatchedPassage | null;
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

/** What the library already holds, to mark a result "already yours". */
export type LibraryKeys = { dois: ReadonlySet<string>; titles: ReadonlySet<string> };

/** One discovered work as the panel shows it. Pure, so the shape is tested without a network. */
export function webResultOf(work: DiscoveredWork, question: string, have: LibraryKeys): WebResult {
  return {
    title: work.title,
    abstract: work.abstract,
    matchedPassage: matchingPassage(work.abstract, question),
    year: work.year,
    venue: work.venue,
    doi: work.doi,
    citationCount: work.citationCount,
    isPreprint: work.isPreprint,
    // §2: whether the full text can actually be fetched decides whether a source can ever
    // reach FULL_TEXT grounding, so it is shown before the student spends a slot on it.
    openAccess: Boolean(work.oaStatus && work.oaStatus !== 'closed'),
    inLibrary:
      (work.doi ? have.dois.has(work.doi.toLowerCase()) : false) ||
      have.titles.has(work.title.trim().toLowerCase()),
    via: work.via,
    reference: {
      raw: referenceLineOf(work),
      ...(work.doi ? { doi: work.doi } : {}),
    },
  };
}

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

  /**
   * `documentId` null (ADR-0132): a research question asked with no thesis. There is no library
   * to mark results against, so every result is "not in your library".
   */
  async search(
    ownerId: string,
    documentId: string | null,
    question: string,
    signal?: AbortSignal,
    /** ADR-0060 asks for more, so eight with abstracts usually survive its filter. */
    limit: number = WEB_SCOPE.maxResults,
  ): Promise<{ results: WebResult[]; query: string; status: SearchStatus; notice: string | null }> {
    if (documentId !== null) {
      const document = await this.prisma.document.findFirst({
        where: { id: documentId, ownerId },
        select: { id: true },
      });
      if (!document) throw new NotFoundError('That document');
    }

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
    const clients: Array<{ name: IndexName; client: { search: Searcher } }> = [
      { name: 'openalex' as const, client: openalex },
      { name: 'semanticscholar' as const, client: s2 },
      { name: 'pubmed' as const, client: this.indexes.pubmed },
      { name: 'arxiv' as const, client: this.indexes.arxiv },
    ].flatMap(({ name, client }) => (client ? [{ name, client }] : []));

    // All at once, each on its own clock: a failure or a timeout loses that index's results only.
    // ADR-0149: and is named, so the student is told which index did not answer.
    const outcomes: IndexOutcome[] = [];
    const lists = await Promise.all(
      clients.map(async ({ name, client }): Promise<DiscoveredWork[]> => {
        const timeout = AbortSignal.timeout(WEB_SCOPE.timeoutMs);
        try {
          const found = await client.search(
            searchText,
            new Date(),
            signal ? AbortSignal.any([signal, timeout]) : timeout,
          );
          outcomes.push(outcomeOfCount(name, found.length));
          return found;
        } catch (error) {
          const outcome = outcomeOfError(name, error);
          outcomes.push(outcome);
          this.logger.warn(
            { err: error, index: name, reason: outcome.reason, until: outcome.until },
            'web scope search failed',
          );
          return [];
        }
      }),
    );
    const status = searchStatus(sortOutcomes(outcomes, clients));

    // Taken in turn, so each index that answered is on the page — eight results would otherwise
    // be eight of OpenAlex's.
    const works = mergeWorks([interleave(lists)]).slice(0, limit);
    const have: LibraryKeys =
      documentId === null
        ? { dois: new Set(), titles: new Set() }
        : await this.libraryKeys(documentId);
    return {
      query: question,
      results: works.map((work) => webResultOf(work, question, have)),
      status,
      // The one line for the panel; `status` has the detail.
      notice: status.notice,
    };
  }

  /**
   * ADR-0074: chat's research plan — OpenAlex's semantic search with the thesis and the question,
   * and each keyword query on every keyword index, one after another per index within
   * `CHAT_RESEARCH.budget` (`searchWithinBudget`, ADR-0050), all indexes at once. No model. A
   * failed or slow index loses its own results, never the answer. The caller has checked the
   * document is the student's.
   */
  async searchPlan(
    documentId: string,
    question: string,
    plan: ResearchPlan,
    signal?: AbortSignal,
    limit: number = CHAT_RESEARCH.maxCandidates,
  ): Promise<SearchedList<WebResult>> {
    const openalex = new OpenAlexDiscovery({
      mailto: this.env.OPENALEX_MAILTO ?? this.env.CROSSREF_MAILTO ?? '',
      ...(this.env.OPENALEX_API_KEY ? { apiKey: this.env.OPENALEX_API_KEY } : {}),
    });
    const s2 = this.env.SEMANTIC_SCHOLAR_API_KEY
      ? new SemanticScholarClient(this.env.SEMANTIC_SCHOLAR_API_KEY, {
          mailto: this.env.OPENALEX_MAILTO ?? '',
        })
      : null;
    const keywordIndexes: Array<{ name: IndexName; client: { search: Searcher } }> = [
      { name: 'openalex' as const, client: openalex },
      { name: 'semanticscholar' as const, client: s2 },
      { name: 'pubmed' as const, client: this.indexes.pubmed },
      { name: 'arxiv' as const, client: this.indexes.arxiv },
    ].flatMap(({ name, client }) => (client ? [{ name, client }] : []));

    const withSignal = (own: AbortSignal) => (signal ? AbortSignal.any([signal, own]) : own);
    const onSkip = (index: string) => (query: string, reason: string) =>
      this.logger.warn({ index, query, reason }, 'chat research search skipped');
    // ADR-0149: `searchWithinBudget` keeps the run going past a failure; the failure itself is
    // kept here, by index, so the status can say what happened and not only that nothing came.
    const errors = new Map<IndexName, unknown>();
    const noting =
      (name: IndexName, search: SearchFn): SearchFn =>
      async (q, own) => {
        try {
          return await search(q, own);
        } catch (error) {
          if (!errors.has(name)) errors.set(name, error);
          throw error;
        }
      };
    const lists = await Promise.all([
      searchWithinBudget(
        [plan.semantic],
        noting('openalex', (q, own) => openalex.semanticSearch(q, new Date(), withSignal(own))),
        { ...CHAT_RESEARCH.budget, onSkip: onSkip('openalex-semantic') },
      ),
      ...keywordIndexes.map(({ name, client }) =>
        searchWithinBudget(
          plan.keyword,
          noting(name, (q, own) => client.search(q, new Date(), withSignal(own))),
          {
            ...CHAT_RESEARCH.budget,
            onSkip: onSkip(name),
          },
        ),
      ),
    ]);
    // An index is "answering" when any of its queries came back; one that failed every query
    // (OpenAlex: the semantic search and every keyword one) is reported with its first error.
    const counts = new Map<IndexName, number>();
    counts.set('openalex', (lists[0] ?? []).flat().length);
    keywordIndexes.forEach(({ name }, i) => {
      counts.set(name, (counts.get(name) ?? 0) + (lists[i + 1] ?? []).flat().length);
    });
    const outcomes = [...counts].map(([name, count]) =>
      count === 0 && errors.has(name)
        ? outcomeOfError(name, errors.get(name))
        : outcomeOfCount(name, count),
    );
    const status = searchStatus(outcomes);
    // Each index's lists in turn, so one index's twenty-five do not crowd out the others.
    const works = mergeWorks([interleave(lists.map((perIndex) => interleave(perIndex)))]).slice(
      0,
      limit * 2,
    );
    const have = await this.libraryKeys(documentId);
    return withStatus(
      works.map((work) => webResultOf(work, question, have)),
      status,
    );
  }

  /** What the library already holds, to mark a result "already yours". */
  private async libraryKeys(documentId: string): Promise<LibraryKeys> {
    // "Already yours" is worth knowing before adding: a student searching the literature will hit
    // their own seed papers constantly, and offering to add one again is how duplicates happen.
    const existing = await this.prisma.source.findMany({
      where: { documentId },
      select: { doi: true, title: true },
    });
    return {
      dois: new Set(
        existing.map((s) => s.doi?.toLowerCase()).filter((d): d is string => Boolean(d)),
      ),
      titles: new Set(
        existing.map((s) => s.title?.trim().toLowerCase()).filter((t): t is string => Boolean(t)),
      ),
    };
  }
}
