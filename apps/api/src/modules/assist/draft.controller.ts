/**
 * `/draft/*` — PRD §9.3, FR-4.4. SSE over POST, the same transport as `/assist/suggest` (B.8).
 */

import { Body, Controller, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Env } from '@tc/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENV } from '../../common/env.token.js';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { DraftService } from './draft.service.js';
import { streamSse } from './sse.js';

const sectionBody = z.object({
  chapterId: z.string().uuid(),
  outlineNodeId: z.string().trim().min(1).max(200),
  targetWords: z.number().int().min(100).max(2_000).optional(),
});

const resolveBody = z.object({ keptChars: z.number().int().min(0).default(0) });

@Controller('draft')
@UseGuards(SessionGuard)
export class DraftController {
  constructor(
    private readonly draft: DraftService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('section')
  async section(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const parsed = sectionBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid draft request', parsed.error.issues);
    await streamSse(request, reply, this.env, (signal) =>
      this.draft.draft(user, parsed.data, signal),
    );
  }

  @Post(':draftId/accept')
  async accept(
    @CurrentUser() user: SessionUser,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
  ) {
    const parsed = resolveBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid payload', parsed.error.issues);
    return this.draft.resolve(user.id, draftId, 'ACCEPTED', parsed.data.keptChars);
  }

  @Post(':draftId/discard')
  async discard(@CurrentUser() user: SessionUser, @Param('draftId') draftId: string) {
    return this.draft.resolve(user.id, draftId, 'DISCARDED');
  }
}
