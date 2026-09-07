/**
 * `/documents/:id/coherence*` — PRD §5.6, Appendix D.1.1, PHASES v2 B1.2, B1.8.
 *
 * The run itself is a job; this starts it, streams its progress (D.1.1 step 3) and serves the
 * flags. The stream is SSE over POST, the same transport as Assist and Draft (B.8), because a run
 * takes minutes and the sidebar should fill in as each check finishes rather than all at once.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Env } from '@tc/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENV } from '../../common/env.token.js';
import { ValidationError } from '../../common/errors.js';
import { RedisService } from '../../common/redis.service.js';
import { streamSse } from '../assist/sse.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CoherenceService } from './coherence.service.js';

const runBody = z.object({
  triggeredBy: z.enum(['MANUAL', 'AUTOSAVE', 'FEEDBACK']).default('MANUAL'),
});

const actBody = z.object({
  action: z.enum(['RESOLVE', 'IGNORE', 'REOPEN']),
  reason: z.string().trim().max(500).optional(),
});

/** A run cannot outlive this; D.1.1 gives the job a 120 s timeout per check, not per run. */
const RUN_TIMEOUT_MS = 10 * 60_000;

@Controller('documents/:id/coherence')
@UseGuards(SessionGuard)
export class CoherenceController {
  constructor(
    private readonly coherence: CoherenceService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** What the next run would cost, so the button can say it before it is pressed. */
  @Get('estimate')
  estimate(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.coherence.estimate(user.id, documentId);
  }

  @Post('run')
  @HttpCode(202)
  start(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = runBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid run request', parsed.error.issues);
    return this.coherence.start(user, documentId, parsed.data.triggeredBy);
  }

  @Get('flags')
  flags(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Query('status') status?: string,
  ) {
    return this.coherence.flags(user.id, documentId, status === 'ALL' ? 'ALL' : 'OPEN');
  }

  @Post('flags/:flagId')
  @HttpCode(200)
  act(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('flagId') flagId: string,
    @Body() body: unknown,
  ) {
    const parsed = actBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid action', parsed.error.issues);
    return this.coherence.act(user.id, documentId, flagId, parsed.data.action, parsed.data.reason);
  }

  @Get(':runId')
  run(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('runId') runId: string,
  ) {
    return this.coherence.run(user.id, documentId, runId);
  }

  /**
   * D.1.1 step 3: `check-started`, `check-done`, `run-done`, republished from the worker's Redis
   * channel. The stream also records the run's outcome, so a student who closes the tab still
   * finds a finished run when they come back.
   */
  @Post(':runId/events')
  async events(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('runId') runId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Ownership is checked before a single byte of the stream is written.
    await this.coherence.run(user.id, documentId, runId);
    await streamSse(request, reply, this.env, (signal) => this.watch(documentId, runId, signal));
  }

  private async *watch(
    documentId: string,
    runId: string,
    signal: AbortSignal,
  ): AsyncGenerator<{ event: string; data: unknown }> {
    const channel = `coherence:${runId}`;
    const subscriber = this.redis.client.duplicate();
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    await subscriber.subscribe(channel);
    subscriber.on('message', (_channel, message) => {
      queue.push(message);
      wake?.();
    });

    yield { event: 'start', data: { runId } };

    const startedAt = Date.now();
    try {
      for (;;) {
        if (signal.aborted) return;
        if (Date.now() - startedAt > RUN_TIMEOUT_MS) {
          await this.coherence.finish(documentId, runId, {}, { error: 'timed out' });
          yield {
            event: 'error',
            data: { code: 'RUN_TIMEOUT', message: 'The check took too long. Try again.' },
          };
          return;
        }

        const message = queue.shift();
        if (message === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 500);
          });
          wake = null;
          continue;
        }

        const parsed = JSON.parse(message) as { type: string; data: Record<string, unknown> };
        yield { event: parsed.type, data: parsed.data };
        if (parsed.type === 'run-done') {
          const totals = (parsed.data.totals ?? {}) as Record<string, unknown>;
          await this.coherence.finish(
            documentId,
            runId,
            (totals.byType as Record<string, number>) ?? {},
            {
              reducedScope: Boolean(totals.reducedScope),
              ...(typeof totals.skipped === 'string' ? { skipped: totals.skipped } : {}),
            },
          );
          return;
        }
      }
    } finally {
      await subscriber.unsubscribe(channel).catch(() => undefined);
      subscriber.disconnect();
    }
  }
}
