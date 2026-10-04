/**
 * `/assist/*` — PRD §9.3, Appendix B.8 (SSE over POST via fetch + ReadableStream).
 *
 * Response headers per B.8: `text/event-stream`, `Cache-Control: no-cache`,
 * `X-Accel-Buffering: no`. nginx honours that header natively, and both proxies in front also
 * set `proxy_buffering off` (infra/compose/edge.conf, infra/nginx/thesis.rademics.ai.conf).
 */

import { Body, Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Env } from '@tc/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENV } from '../../common/env.token.js';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AssistService, OUTCOMES } from './assist.service.js';
import { streamSse } from './sse.js';

const suggestBody = z.object({
  chapterId: z.string().uuid(),
  before: z.string().max(40_000).default(''),
  after: z.string().max(10_000).default(''),
  // 1,500, not 500 (2026-10-04): a refine preset carries the suggestion it revises, which runs
  // to about 600 characters. A typed instruction is still held to 500 by the input.
  guided: z.string().trim().max(1_500).optional(),
  // `section`: the heading above the cursor, so the section's own scope note is read (A21).
  cursorContext: z
    .object({ blockType: z.string().optional(), section: z.string().max(300).optional() })
    .optional(),
});

const outcomeBody = z.object({
  suggestionId: z.string().uuid(),
  outcome: z.enum(OUTCOMES),
  keptChars: z.number().int().min(0).default(0),
});

@Controller('assist')
@UseGuards(SessionGuard)
export class AssistController {
  constructor(
    private readonly assist: AssistService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('suggest')
  async suggest(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const parsed = suggestBody.safeParse(body);
    if (!parsed.success)
      throw new ValidationError('Invalid suggestion request', parsed.error.issues);

    // B.8: abort propagates from the client's disconnect to the provider stream.
    await streamSse(request, reply, this.env, (signal) =>
      this.assist.suggest(user, parsed.data, signal),
    );
  }

  @Post('outcome')
  async outcome(@CurrentUser() user: SessionUser, @Body() body: unknown): Promise<{ ok: true }> {
    const parsed = outcomeBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid outcome payload', parsed.error.issues);
    await this.assist.recordOutcome(
      user.id,
      parsed.data.suggestionId,
      parsed.data.outcome,
      parsed.data.keptChars,
    );
    return { ok: true };
  }
}
