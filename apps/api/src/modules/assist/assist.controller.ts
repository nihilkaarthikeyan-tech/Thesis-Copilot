/**
 * `/assist/*` — PRD §9.3, Appendix B.8 (SSE over POST via fetch + ReadableStream).
 *
 * Response headers per B.8: `text/event-stream`, `Cache-Control: no-cache`,
 * `X-Accel-Buffering: no`. Caddy adds `flush_interval -1` in front (infra/compose/Caddyfile).
 */

import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AssistService, OUTCOMES } from './assist.service.js';

const suggestBody = z.object({
  chapterId: z.string().uuid(),
  before: z.string().max(40_000).default(''),
  after: z.string().max(10_000).default(''),
  guided: z.string().trim().max(500).optional(),
  cursorContext: z.object({ blockType: z.string().optional() }).optional(),
});

const outcomeBody = z.object({
  suggestionId: z.string().uuid(),
  outcome: z.enum(OUTCOMES),
  keptChars: z.number().int().min(0).default(0),
});

@Controller('assist')
@UseGuards(SessionGuard)
export class AssistController {
  constructor(private readonly assist: AssistService) {}

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
    //
    // Not `request.raw.on('close')`: since Node 16 an IncomingMessage's `close` fires once the
    // request body has been fully read, which for a JSON POST is before this handler runs. A
    // client that goes away mid-stream shows up as the *response* closing before it finished, or
    // as the socket closing.
    const abort = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableFinished) abort.abort();
    };
    reply.raw.on('close', onClose);
    request.raw.socket?.on('close', onClose);

    const stream = this.assist.suggest(user, parsed.data, abort.signal);

    // Refusals (404 / 409 / 429) are thrown before the first event, so pull it first and let the
    // problem-details filter answer with JSON when it throws.
    const first = await stream.next();

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
      'x-request-id': request.id,
    });
    raw.flushHeaders?.();

    const write = (event: string, data: unknown) => {
      if (raw.destroyed) return;
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      if (!first.done) write(first.value.event, first.value.data);
      for await (const evt of stream) write(evt.event, evt.data);
    } catch (error) {
      write('error', {
        code: 'STREAM_FAILED',
        message: error instanceof Error ? error.message : 'Stream failed',
      });
    } finally {
      reply.raw.off('close', onClose);
      request.raw.socket?.off('close', onClose);
      if (!raw.destroyed) raw.end();
    }
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
