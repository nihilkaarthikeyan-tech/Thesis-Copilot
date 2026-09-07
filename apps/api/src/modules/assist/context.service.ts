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
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';

export type ChapterForContext = ContextChapter;

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
  ): Promise<RetrievalResult> {
    return retrievePassages(
      this.db,
      (texts) => this.providers.embeddings.embed(texts),
      chapter,
      queryFrom,
      action,
    );
  }
}
