/**
 * Section commands — PRD FR-4.8, §9.3 `POST /commands/run`, A.11, PHASES v2 W9.2.
 *
 * One Strong call per run, metered as `COMMAND`. The rewrite never reaches the chapter here: the
 * response is the rewritten text plus a word-level diff, and the editor applies it only when the
 * student presses Apply ("flag, don't fix"). Provenance `COMMAND` is set by the editor at that
 * moment, so a discarded command leaves no trace but the cap unit and the call log.
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  asksToEvadeDetection,
  buildCommandRequest,
  buildEditReasonsRequest,
  COMMAND,
  type CommandName,
  citationMoved,
  cleanEditReasons,
  commandResultSchema,
  type DiffOp,
  diffWords,
  EVASION_REFUSAL,
  editReasonsSchema,
  type Providers,
  postProcessCommand,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import type { Redis } from 'ioredis';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import {
  aiCallLatency,
  aiCostMicroInr,
  capExceeded,
  hallucinatedCite,
} from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { RedisService } from '../../common/redis.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { ContextService } from './context.service.js';

export type CommandRunInput = {
  chapterId: string;
  command: CommandName;
  selection: string;
  contextBefore?: string;
  contextAfter?: string;
  /** ADR-0095: the student's own instruction, for `custom`. */
  instruction?: string;
  /** ADR-0095: "Use my library" — `custom` is sent passages only when this is on. */
  useLibrary?: boolean;
  /**
   * ADR-0095: a follow-up refines the previous result (`selection`); the diff, the reasons and the
   * citation checks are against the student's original text, which this carries.
   */
  original?: string;
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
  /** ADR-0095: citations of the selection now on another claim — a warning, like a dropped one. */
  movedCitations: string[];
  /** ADR-0095: citations written twice; the copy was removed where that left a whole sentence. */
  doubledCitations: string[];
  /** ADR-0095: a second copy that is part of a sentence and stayed — a warning. */
  repeatedCitations: string[];
  /** ADR-0095: asks for "What changed and why" once, within this run's unit. */
  runId: string;
};

/**
 * One command call's time limit (CLAUDE.md: no model call without one). A 900-token rewrite on the
 * strong tier takes 10–25 s; this is the hung call, not a slow one.
 */
const COMMAND_TIMEOUT_MS = 90_000;
/** How long a run can still be explained. */
const EXPLAIN_TTL_S = 30 * 60;
/** The reasons call's time limit (CLAUDE.md: no model call without one). */
const EXPLAIN_TIMEOUT_MS = 30_000;
const explainKey = (runId: string) => `cmdrun:${runId}`;

type ExplainableRun = {
  userId: string;
  documentId: string;
  command: CommandName;
  instruction?: string;
  before: string;
  after: string;
};

@Injectable()
export class CommandService {
  private readonly logger = new Logger(CommandService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly context: ContextService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
    redis: RedisService,
  ) {
    this.redis = redis.client;
  }

  async run(user: { id: string; plan: string }, input: CommandRunInput): Promise<CommandRunResult> {
    const selection = input.selection.trim();
    if (!selection) throw new ValidationError('Select some text first.');
    if (selection.length > COMMAND.maxSelectionChars) {
      throw new ValidationError(
        `That selection is too long for one command (${selection.length} characters, limit ${COMMAND.maxSelectionChars}). Select a paragraph or two.`,
      );
    }

    // §12.3, in code (ADR-0095): a request to get text past a detector is refused before the
    // allowance is touched or a model is called.
    if (input.command === 'custom' && asksToEvadeDetection(input.instruction ?? '')) {
      throw new ValidationError(EVASION_REFUSAL);
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
    // ADR-0095: the student's own instruction gets them when "Use my library" is on.
    const retrieved =
      COMMAND.needsPassages.includes(input.command) ||
      (input.command === 'custom' && input.useLibrary === true)
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
      // ADR-0081: translate's one target is the thesis language (§2.2).
      ...(chapter.document.language ? { language: chapter.document.language } : {}),
      ...(input.command === 'custom' && input.instruction
        ? { instruction: input.instruction }
        : {}),
      ...(input.command === 'custom' && input.original?.trim() ? { original: input.original } : {}),
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
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

      // The untrimmed selection, so the rewrite keeps its edges (the space before the next word).
      const processed = postProcessCommand(
        result.value.text,
        input.selection,
        passages.map((p) => p.id),
        input.command,
      );
      for (const key of processed.hallucinated) {
        hallucinatedCite.inc();
        this.logger.warn({ chapterId: chapter.id, key }, 'HALLUCINATED_CITE');
      }
      await this.log(user.id, chapter.documentId, modelId, result.usage, latencyMs, true);

      // ADR-0095: a follow-up is shown, explained and checked against the student's own text.
      const original = input.original?.trim() ? input.original : null;
      // A.11's consistency command returns the selection unchanged when nothing conflicts. A
      // follow-up is unchanged only when it is back to the student's own text.
      const unchanged = processed.text.trim() === (original ?? selection).trim();
      const originalKeys = original
        ? [...original.matchAll(/\{\{cite:([^}]+)\}\}/g)].map((m) => (m[1] ?? '').trim())
        : [];
      const keptKeys = new Set(
        [...processed.text.matchAll(/\{\{cite:([^}]+)\}\}/g)].map((m) => (m[1] ?? '').trim()),
      );
      const droppedFromOriginal = originalKeys.filter((k) => !keptKeys.has(k));
      const runId = randomUUID();
      const run: ExplainableRun = {
        userId: user.id,
        documentId: chapter.documentId,
        command: input.command,
        ...(input.instruction ? { instruction: input.instruction } : {}),
        before: original ?? input.selection,
        after: processed.text,
      };
      await this.redis.set(explainKey(runId), JSON.stringify(run), 'EX', EXPLAIN_TTL_S);
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
        diff: original
          ? diffWords(original.trim(), processed.text)
          : unchanged
            ? [{ type: 'same', text: selection }]
            : diffWords(selection, processed.text),
        words: processed.words,
        originalWords: original
          ? original.trim().split(/\s+/).filter(Boolean).length
          : processed.originalWords,
        droppedCitations: [...new Set([...processed.dropped, ...droppedFromOriginal])],
        citations,
        unchanged,
        // A follow-up's citations are checked against where the student had them, not against
        // the previous version (which may itself have moved them).
        movedCitations: original
          ? [...new Set(originalKeys)].filter(
              (k) => keptKeys.has(k) && citationMoved(original, processed.text, k),
            )
          : processed.moved,
        doubledCitations: processed.doubled,
        repeatedCitations: processed.repeated,
        runId,
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

  /**
   * ADR-0095: "What changed and why" for a run this student just paid for — once per run, inside
   * its unit, on the fast tier. Anything that goes wrong is an empty list: the rewrite is already
   * on the screen, and an explanation that failed must not read as an error about it.
   */
  async explain(user: { id: string }, runId: string): Promise<{ reasons: string[] }> {
    const raw = await this.redis.getdel(explainKey(runId));
    if (!raw) throw new NotFoundError('That edit');
    const run = JSON.parse(raw) as ExplainableRun;
    if (run.userId !== user.id) throw new NotFoundError('That edit');
    const request = buildEditReasonsRequest({
      command: run.command,
      ...(run.instruction ? { instruction: run.instruction } : {}),
      before: run.before,
      after: run.after,
      userId: user.id,
      documentId: run.documentId,
      signal: AbortSignal.timeout(EXPLAIN_TIMEOUT_MS),
    });
    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor('fast');
    try {
      const result = await this.providers.llm.complete({ ...request, schema: editReasonsSchema });
      modelId = result.modelId;
      await this.log(
        user.id,
        run.documentId,
        modelId,
        result.usage,
        Date.now() - startedAt,
        true,
        undefined,
        'fast',
      );
      return { reasons: cleanEditReasons(result.value.reasons) };
    } catch (error) {
      await this.log(
        user.id,
        run.documentId,
        modelId,
        null,
        Date.now() - startedAt,
        false,
        error,
        'fast',
      );
      return { reasons: [] };
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
    tier: 'fast' | 'strong' = 'strong',
  ): Promise<void> {
    const cost =
      ok && usage && this.env.AI_PROVIDER !== 'mock'
        ? computeCallCost({ tier, modelId: model, usage })
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
