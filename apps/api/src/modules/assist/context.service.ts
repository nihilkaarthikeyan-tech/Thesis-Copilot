/**
 * Assist context — the cached document-memory block (A.0.1, §10.3) and the retrieved passages
 * (§10.4), for the request path.
 *
 * The work itself lives in `@tc/retrieval` because the worker needs the identical thing for draft
 * mode, and the two must not drift: a draft retrieved from a different candidate set than the
 * Assist call beside it would cite different sources for the same chapter. This class is the Nest
 * wiring plus the logging §10.3 asks for ("logs when it trims").
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MemoryBlock, Providers } from '@tc/ai';
import type { RetrievalAction } from '@tc/retrieval';
import {
  buildChapterMemory,
  type ContextChapter,
  type ContextClient,
  type RetrievalResult,
  retrievePassages,
} from '@tc/retrieval';
import { readSourcePrefs } from '@tc/types';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';

export type ChapterForContext = ContextChapter;

/** A source id that matches nothing: "search within no papers". */
const NO_SOURCE = '00000000-0000-0000-0000-000000000000';

/**
 * A chapter as the services select it: Prisma nests the document's language under `document`,
 * and the prompt builders want it flat. One place converts, so no caller has to remember.
 */
export type ChapterWithDocument = ContextChapter & {
  document?: { language: string | null } | null;
};

function withLanguage(chapter: ChapterWithDocument): ContextChapter {
  const language = chapter.language ?? chapter.document?.language ?? null;
  return { ...chapter, ...(language ? { language } : {}) };
}

export type { RetrievalResult };

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDERS) private readonly providers: Providers,
  ) {}

  private get db(): ContextClient {
    return this.prisma as unknown as ContextClient;
  }

  async memoryBlock(chapter: ChapterWithDocument): Promise<MemoryBlock> {
    const block = await buildChapterMemory(this.db, withLanguage(chapter));
    if (block.trimmed.length > 0) {
      this.logger.log(
        {
          documentId: chapter.documentId,
          chapterId: chapter.id,
          trimmed: block.trimmed,
          tokens: block.tokens,
          overBudget: block.overBudget,
        },
        'memory block trimmed',
      );
    }
    return block;
  }

  async retrieve(
    chapter: ChapterForContext,
    queryFrom: string,
    action: RetrievalAction,
    options: { sourceIds?: readonly string[]; section?: string | null } = {},
  ): Promise<RetrievalResult> {
    return retrievePassages(
      this.db,
      (texts) => this.providers.embeddings.embed(texts),
      chapter,
      queryFrom,
      action,
      options.sourceIds ? options : { ...options, ...(await this.foundOnly(chapter.documentId)) },
    );
  }

  /**
   * ADR-0087: "Library search" off at the start of the thesis — cite only the papers found for
   * the student, not the ones they added themselves. Returns the source ids to search within, or
   * nothing when the setting is on (every thesis made before it has it on). A student who names
   * papers with `@` has asked for those, so this does not apply then.
   */
  private async foundOnly(documentId: string): Promise<{ sourceIds?: string[] }> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { meta: true },
    });
    if (readSourcePrefs(document?.meta).librarySearch) return {};
    const found = await this.prisma.source.findMany({
      where: { documentId, autoAddedAt: { not: null } },
      select: { id: true },
    });
    // No paper found yet: an id that matches nothing, so nothing of the student's own is cited.
    return { sourceIds: found.length > 0 ? found.map((s) => s.id) : [NO_SOURCE] };
  }

  /**
   * Jenni build plan R3, "Cite from my library": the papers the student added themselves (not the
   * ones found for them, ADR-0037). None: an id that matches nothing, so the search finds nothing
   * and the student is told.
   */
  async ownSourceIds(documentId: string): Promise<string[]> {
    const own = await this.prisma.source.findMany({
      where: { documentId, autoAddedAt: null },
      select: { id: true },
    });
    return own.length > 0 ? own.map((s) => s.id) : [NO_SOURCE];
  }
}
