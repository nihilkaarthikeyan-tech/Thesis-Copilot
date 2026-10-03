/**
 * Section commands — PRD FR-4.8, §9.3 `POST /commands/run`, A.11, PHASES v2 W9.2.
 *
 * One Strong call per run, metered as `COMMAND`. The rewrite never reaches the chapter here: the
 * response is the rewritten text plus a word-level diff, and the editor applies it only when the
 * student presses Apply ("flag, don't fix"). Provenance `COMMAND` is set by the editor at that
 * moment, so a discarded command leaves no trace but the cap unit and the call log.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildCommandRequest,
  COMMAND,
  type CommandName,
  commandResultSchema,
  type DiffOp,
  diffWords,
  type Providers,
  postProcessCommand,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import {
  aiCallLatency,
  aiCostMicroInr,
  capExceeded,
  hallucinatedCite,
} from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { ContextService } from './context.service.js';

export type CommandRunInput = {
  chapterId: string;
  command: CommandName;
  selection: string;
  contextBefore?: string;
  contextAfter?: string;
};

export type CommandRunResult = {
  command: CommandName;
  text: string;
  diff: DiffOp[];
  words: number;
  originalWords: number;
  /** Citations the model dropped from the selection — the student is warned before applying. */
  droppedCitations: string[];
  /**
   * Citations the rewrite added from the passages sent with an expand or consistency request,
   * resolved to real ids with the label to show. Keys that were already in the selection are not
   * here: the client keeps those nodes as they were (ADR-0045).
   */
  citations: Array<{ key: string; sourceId: string; chunkId: string; rendered: string }>;
  unchanged: boolean;
};

@Injectable()
export class CommandService {
  private readonly logger = new Logger(CommandService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly context: ContextService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run(user: { id: string; plan: string }, input: CommandRunInput): Promise<CommandRunResult> {
    const selection = input.selection.trim();
    if (!selection) throw new ValidationError('Select some text first.');
    if (selection.length > COMMAND.maxSelectionChars) {
      throw new ValidationError(
        `That selection is too long for one command (${selection.length} characters, limit ${COMMAND.maxSelectionChars}). Select a paragraph or two.`,
      );
    }

    const chapter = await this.prisma.chapter.findFirst({
      where: { id: input.chapterId, document: { ownerId: user.id } },
      select: {
        id: true,
        title: true,
        scopeNote: true,
        documentId: true,
        outlineNodeId: true,
        content: true,
        // §2.2: the prompts answer in the document's language.
        document: { select: { language: true } },
      },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    const cap = await this.usage.consume(
      user.id,
      user.plan as Parameters<UsageService['consume']>[1],
      'COMMAND',
    );
    if (!cap.ok) {
      capExceeded.inc({ action: 'COMMAND' });
      throw refusal('COMMAND', cap);
    }

    // A.11 sends passages only to expand and consistency; the others rewrite what is there.
    const retrieved = COMMAND.needsPassages.includes(input.command)
      ? await this.context.retrieve(chapter, selection, 'CHAT')
      : null;
    const passages = retrieved?.passages.slice(0, COMMAND.topK) ?? [];
    const memory = await this.context.memoryBlock(chapter);
    const request = buildCommandRequest({
      command: input.command,
      memoryBlock: memory.text,
      selection,
      contextBefore: (input.contextBefore ?? '').slice(-1_500),
      contextAfter: (input.contextAfter ?? '').slice(0, 1_500),
      passages,
      userId: user.id,
      documentId: chapter.documentId,
    });

    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor('strong');
    try {
      const result = await this.providers.llm.complete({
        ...request,
        schema: commandResultSchema,
      });
      modelId = result.modelId;
      const latencyMs = Date.now() - startedAt;
      aiCallLatency.observe({ action: 'COMMAND', tier: 'strong' }, latencyMs);

      const processed = postProcessCommand(
        result.value.text,
        selection,
        passages.map((p) => p.id),
      );
      for (const key of processed.hallucinated) {
        hallucinatedCite.inc();
        this.logger.warn({ chapterId: chapter.id, key }, 'HALLUCINATED_CITE');
      }
      await this.log(user.id, chapter.documentId, modelId, result.usage, latencyMs, true);

      // A.11's consistency command returns the selection unchanged when nothing conflicts.
      const unchanged = processed.text.trim() === selection;
      const inSelection = new Set(
        [...selection.matchAll(/\{\{cite:([^}]+)\}\}/g)].map((m) => (m[1] ?? '').trim()),
      );
      const citations = [
        ...new Set(
          [...processed.text.matchAll(/\{\{cite:([^}]+)\}\}/g)].map((m) => (m[1] ?? '').trim()),
        ),
      ].flatMap((key) => {
        if (inSelection.has(key)) return [];
        const real = retrieved?.byKey.get(key);
        return real
          ? [
              {
                key,
                sourceId: real.sourceId,
                chunkId: real.chunkId,
                rendered: `(${real.shortRef})`,
              },
            ]
          : [];
      });
      return {
        command: input.command,
        text: processed.text,
        diff: unchanged
          ? [{ type: 'same', text: selection }]
          : diffWords(selection, processed.text),
        words: processed.words,
        originalWords: processed.originalWords,
        droppedCitations: processed.dropped,
        citations,
        unchanged,
      };
    } catch (error) {
      await this.log(
        user.id,
        chapter.documentId,
        modelId,
        null,
        Date.now() - startedAt,
        false,
        error,
      );
      // §11.5: the student was never served, so the unit goes back.
      await this.usage.refund(user.id, 'COMMAND');
      throw error;
    }
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
        ? computeCallCost({ tier: 'strong', modelId: model, usage })
        : 0;
    if (cost > 0) aiCostMicroInr.inc({ action: 'COMMAND' }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'COMMAND',
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
