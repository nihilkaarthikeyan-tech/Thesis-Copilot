/**
 * "Search the literature" on an AI edit — ADR-0133. The wiring; the rules are in
 * `edit-literature.ts` and `@tc/retrieval`'s `edit-search.ts`.
 *
 * One edit with the switch on:
 *   1. the scholarly indexes are searched for the selection's subject, led by the thesis, chapter
 *      and scope note when they name something (`editSearchPlan`; chat's search,
 *      `WebScopeService.searchPlan`, ADR-0074 — no model, no unit);
 *   2. the found abstracts are scored against that subject in one embedding call (logged as
 *      `EMBED`, so the ₹100 ceiling sees it), and the few the measured rule keeps
 *      (`keepRelevant`) are **added to the library** the way `find-sources` adds papers
 *      (ADR-0037): a `Source` row carrying the index's metadata and abstract, marked
 *      `autoAddedAt`, filed into the thesis's "Add into" collection (ADR-0129), and handed to
 *      `resolve-reference` → `index-source`, which read and embed it in the background;
 *   3. their abstracts are this edit's passages for them, tied to the new library rows — nothing
 *      waits for the worker (the first live run waited 25 s and got nothing).
 *
 * Nothing here fails the edit. A failed or empty search leaves the edit to the library alone with
 * a one-line note. The COMMAND unit is the caller's.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Providers } from '@tc/ai';
import { computeEmbeddingCost, type Env } from '@tc/config';
import type { Prisma } from '@tc/db';
import type { RetrievedPassage } from '@tc/retrieval';
import {
  cosine,
  editSearchContext,
  editSearchPlan,
  researchEmbedText,
  shortReference,
} from '@tc/retrieval';
import { jobId, jobKeyDigest } from '@tc/types';
import { ENV } from '../../common/env.token.js';
import { type FilingTarget, LibraryFilingService } from '../../common/library-filing.js';
import { aiCostMicroInr } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import {
  abstractPassages,
  EDIT_LITERATURE,
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
};

export type EditLiterature = {
  added: AddedPaper[];
  /** Their abstracts, as this edit's passages, tied to the new library rows. */
  passages: RetrievedPassage[];
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

  /** Search, add the few on topic, hand back their abstracts. The caller owns the chapter. */
  async findAndAdd(input: {
    userId: string;
    documentId: string;
    chapterTitle: string;
    scopeNote?: string | null;
    selection: string;
    instruction?: string;
  }): Promise<EditLiterature> {
    const none = (outcome: LiteratureOutcome): EditLiterature => ({
      added: [],
      passages: [],
      collection: null,
      outcome,
      note: literatureNote(outcome),
    });

    const context = editSearchContext({
      thesisTitle: await this.thesisTitle(input.documentId),
      chapterTitle: input.chapterTitle,
      scopeNote: input.scopeNote ?? null,
    });
    const plan = editSearchPlan({
      selection: input.selection,
      instruction: input.instruction ?? null,
      context,
    });

    // 1. The indexes, on a clock. A failure is the library alone, said in one line.
    let results: WebResult[];
    try {
      results = (
        await this.web.searchPlan(
          input.documentId,
          plan.relevance,
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

    // 2. On topic, by one embedding call against the subject, and the measured rule.
    let chosen: Array<{ work: WebResult; cosine: number }>;
    try {
      const began = Date.now();
      const { vectors, tokens } = await raceTimeout(
        this.providers.embeddings.embedWithUsage([
          plan.relevance,
          ...results.map((r) => researchEmbedText(r)),
        ]),
        EDIT_LITERATURE.embedTimeoutMs,
        'edit search embedding',
      );
      await this.logEmbed(input.userId, input.documentId, tokens, Date.now() - began);
      const [asked, ...each] = vectors;
      const scored = results.map((result, i) => ({
        result,
        cosine: cosine(asked ?? [], each[i] ?? []),
      }));
      const score = new Map(scored.map((s) => [s.result, s.cosine]));
      chosen = papersToAdd(scored).map((work) => ({ work, cosine: score.get(work) ?? 0 }));
    } catch (error) {
      this.logger.warn({ err: error, documentId: input.documentId }, 'edit search scoring failed');
      return none('failed');
    }
    if (chosen.length === 0) return none('none-relevant');

    // 3. Into the library, filed where the thesis files new papers; read in the background.
    const collection = await this.filingTarget(input.userId, input.documentId);
    const ids = await this.add(
      input.userId,
      input.documentId,
      input.chapterTitle,
      chosen.map((c) => c.work),
    );
    await this.filing.file(input.documentId, collection, ids);

    const rows = await this.prisma.source.findMany({
      where: { id: { in: ids }, documentId: input.documentId },
      select: { id: true, title: true, authors: true, year: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const papers = ids.map((id, i) => {
      const row = byId.get(id);
      const found = chosen[i];
      const title = row?.title ?? found?.work.title ?? '';
      const year = row?.year ?? found?.work.year ?? null;
      return {
        sourceId: id,
        shortRef: shortReference(row?.authors, year, title) ?? title.slice(0, 40),
        title,
        year,
        abstract: found?.work.abstract ?? '',
        cosine: found?.cosine ?? 0,
      };
    });
    this.logger.log(
      {
        documentId: input.documentId,
        candidates: results.length,
        added: ids.length,
        best: Number((chosen[0]?.cosine ?? 0).toFixed(3)),
        collection: collection?.id ?? null,
        context: context.length > 0,
      },
      'edit literature search',
    );
    return {
      added: papers.map(({ sourceId, shortRef, title, year }) => ({
        sourceId,
        shortRef,
        title,
        year,
      })),
      passages: abstractPassages(papers),
      collection,
      outcome: 'added',
      note: null,
    };
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
