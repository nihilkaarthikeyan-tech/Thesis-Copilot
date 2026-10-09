/**
 * "Search the literature" on an AI edit — ADR-0133. The wiring; the rules are in
 * `edit-literature.ts`.
 *
 * One edit with the switch on:
 *   1. the scholarly indexes are searched with the instruction and the selection (chat's search,
 *      `WebScopeService.searchPlan`, ADR-0074 — no model, no unit);
 *   2. the found abstracts are scored against the thesis and the question in one embedding call
 *      (logged as `EMBED`, so the ₹100 ceiling sees it), and the few on topic are **added to the
 *      library** the way `find-sources` adds papers (ADR-0037): a `Source` row carrying the
 *      index's metadata and abstract, marked `autoAddedAt`, filed into the thesis's "Add into"
 *      collection (ADR-0129), and handed to `resolve-reference` → `index-source`;
 *   3. the edit waits a bounded time for their abstracts to be embedded, then retrieves from the
 *      library restricted to them, so each brings a passage into the request.
 *
 * Nothing here fails the edit. A failed or empty search, or papers not read in time, leave the
 * edit to the library alone with a one-line note. The COMMAND unit is the caller's.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Providers } from '@tc/ai';
import { computeEmbeddingCost, type Env } from '@tc/config';
import type { Prisma } from '@tc/db';
import { cosine, planResearchQueries, researchEmbedText, shortReference } from '@tc/retrieval';
import { jobId, jobKeyDigest } from '@tc/types';
import { ENV } from '../../common/env.token.js';
import { type FilingTarget, LibraryFilingService } from '../../common/library-filing.js';
import { aiCostMicroInr } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import {
  EDIT_LITERATURE,
  editSearchQuestion,
  type LiteratureOutcome,
  literatureNote,
  papersToAdd,
} from './edit-literature.js';
import { type WebResult, WebScopeService } from './web-scope.service.js';

/** One paper the edit added, as the panel lists it. */
export type AddedPaper = {
  sourceId: string;
  /** "Kumar 2021", or the title when the authors are not known yet. */
  shortRef: string;
  title: string;
  year: number | null;
  /** Its abstract was read in time to be offered to this edit. */
  ready: boolean;
};

export type EditLiterature = {
  added: AddedPaper[];
  /** The ones ready to cite, for the library retrieval restricted to them. */
  readyIds: string[];
  /** The collection they were filed into, when the thesis has an "Add into". */
  collection: FilingTarget | null;
  outcome: LiteratureOutcome;
  note: string | null;
};

const raceTimeout = <T>(work: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

@Injectable()
export class EditLiteratureService {
  private readonly logger = new Logger(EditLiteratureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly web: WebScopeService,
    private readonly queue: QueueService,
    private readonly filing: LibraryFilingService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Search, add the few on topic, wait for them to be read. The caller owns the chapter. */
  async findAndAdd(input: {
    userId: string;
    documentId: string;
    chapterTitle: string;
    selection: string;
    instruction?: string;
  }): Promise<EditLiterature> {
    const none = (outcome: LiteratureOutcome): EditLiterature => ({
      added: [],
      readyIds: [],
      collection: null,
      outcome,
      note: literatureNote(outcome),
    });

    const question = editSearchQuestion(input.selection, input.instruction);
    const thesis = await this.thesisTitle(input.documentId);
    const plan = planResearchQueries(question, thesis ?? input.chapterTitle);

    // 1. The indexes, on a clock. A failure is the library alone, said in one line.
    let results: WebResult[];
    try {
      results = (
        await this.web.searchPlan(
          input.documentId,
          question,
          plan,
          AbortSignal.timeout(EDIT_LITERATURE.searchTimeoutMs),
        )
      )
        .filter((r) => !r.inLibrary && (r.abstract ?? '').trim().length >= 80 && r.title.trim())
        .slice(0, EDIT_LITERATURE.maxCandidates);
    } catch (error) {
      this.logger.warn({ err: error, documentId: input.documentId }, 'edit search failed');
      return none('failed');
    }
    if (results.length === 0) return none('none-relevant');

    // 2. On topic, by one embedding call against the thesis and the question.
    let chosen: WebResult[];
    try {
      const began = Date.now();
      const { vectors, tokens } = await raceTimeout(
        this.providers.embeddings.embedWithUsage([
          plan.semantic,
          ...results.map((r) => researchEmbedText(r)),
        ]),
        EDIT_LITERATURE.embedTimeoutMs,
        'edit search embedding',
      );
      await this.logEmbed(input.userId, input.documentId, tokens, Date.now() - began);
      const [asked, ...each] = vectors;
      chosen = papersToAdd(
        results.map((result, i) => ({ result, cosine: cosine(asked ?? [], each[i] ?? []) })),
      );
    } catch (error) {
      this.logger.warn({ err: error, documentId: input.documentId }, 'edit search scoring failed');
      return none('failed');
    }
    if (chosen.length === 0) return none('none-relevant');

    // 3. Into the library, filed where the thesis files new papers, and read.
    const collection = await this.filingTarget(input.userId, input.documentId);
    const ids = await this.add(input.userId, input.documentId, input.chapterTitle, chosen);
    await this.filing.file(input.documentId, collection, ids);
    const readyIds = await this.waitUntilReadable(ids);

    const rows = await this.prisma.source.findMany({
      where: { id: { in: ids }, documentId: input.documentId },
      select: { id: true, title: true, authors: true, year: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ready = new Set(readyIds);
    const added = ids.flatMap((id, i): AddedPaper[] => {
      const row = byId.get(id);
      const found = chosen[i];
      const title = row?.title ?? found?.title ?? '';
      const year = row?.year ?? found?.year ?? null;
      return [
        {
          sourceId: id,
          shortRef: shortReference(row?.authors, year, title) ?? title.slice(0, 40),
          title,
          year,
          ready: ready.has(id),
        },
      ];
    });
    const outcome: LiteratureOutcome = readyIds.length > 0 ? 'added' : 'not-ready';
    this.logger.log(
      {
        documentId: input.documentId,
        candidates: results.length,
        added: ids.length,
        ready: readyIds.length,
        collection: collection?.id ?? null,
      },
      'edit literature search',
    );
    return { added, readyIds, collection, outcome, note: literatureNote(outcome) };
  }

  /**
   * The source ids whose text is stored to cite, waiting at most `readyTimeoutMs`. A paper the
   * resolver gave up on stops the wait for itself. Public so a test can stand in for the worker.
   */
  async waitUntilReadable(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const deadline = Date.now() + EDIT_LITERATURE.readyTimeoutMs;
    for (;;) {
      const rows = await this.prisma.source.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, status: true, _count: { select: { chunks: true } } },
      });
      const ready = rows.filter((r) => r._count.chunks > 0).map((r) => r.id);
      const settled = rows.every((r) => r._count.chunks > 0 || r.status === 'UNRESOLVED');
      if (settled || Date.now() >= deadline) return ready;
      await new Promise((resolve) => setTimeout(resolve, EDIT_LITERATURE.readyPollMs));
    }
  }

  /** Adds the papers as `find-sources` does, and starts the read every added paper gets. */
  private async add(
    userId: string,
    documentId: string,
    chapterTitle: string,
    works: readonly WebResult[],
  ): Promise<string[]> {
    const now = new Date();
    const ids: string[] = [];
    for (const w of works) {
      const raw = w.reference.raw.trim();
      // The same text a chat Add would send, so pressing Add there later finds this row.
      const existing = await this.prisma.source.findFirst({
        where: { documentId, rawReference: raw },
        select: { id: true },
      });
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const created = await this.prisma.source.create({
        data: {
          documentId,
          status: 'PENDING',
          rawReference: raw,
          doi: w.doi,
          title: w.title,
          year: w.year,
          venue: w.venue,
          citationCount: w.citationCount,
          isPreprint: w.isPreprint,
          subTheme: chapterTitle,
          // Found for the student, not chosen by them paper by paper: shown "Added
          // automatically" with the rest, and citable under either library-search setting.
          autoAddedAt: now,
          ...(w.abstract ? { cslJson: { abstract: w.abstract } as Prisma.InputJsonValue } : {}),
        },
        select: { id: true },
      });
      ids.push(created.id);
      await this.queue.enqueue(
        'resolve-reference',
        {
          documentId,
          userId,
          rawReference: raw,
          ...(w.doi ? { printedDoi: w.doi } : {}),
        },
        { jobId: jobId('resolve-reference', documentId, jobKeyDigest(raw)) },
      );
    }
    return ids;
  }

  /** The thesis's "Add into", or the library only when none is chosen (or it was deleted). */
  private async filingTarget(ownerId: string, documentId: string): Promise<FilingTarget | null> {
    const { collectionId } = await this.filing.stored(ownerId, documentId);
    return collectionId ? this.filing.target(ownerId, documentId, collectionId) : null;
  }

  private async thesisTitle(documentId: string): Promise<string | null> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { title: true, memory: { select: { scope: true } } },
    });
    const working = (document?.memory?.scope as { workingTitle?: unknown } | null)?.workingTitle;
    if (typeof working === 'string' && working.trim()) return working.trim();
    return document?.title?.trim() || null;
  }

  /** The relevance call's spend, as chat's research logs its own (`EMBED`, real tokens). */
  private async logEmbed(
    userId: string,
    documentId: string,
    tokens: number,
    latencyMs: number,
  ): Promise<void> {
    const cost = this.env.EMBED_PROVIDER !== 'mock' ? computeEmbeddingCost(tokens) : 0;
    if (cost > 0) aiCostMicroInr.inc({ action: 'EMBED' }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'EMBED',
        model: this.env.AI_EMBED_MODEL,
        inputTokens: tokens,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        costMicroInr: BigInt(cost),
        latencyMs,
        ok: true,
        error: null,
      },
    });
  }
}
