/**
 * `/research-chats` — a research question asked with no thesis (ADR-0132, Jenni build plan
 * R30/R32). The asking is SSE over POST like `/chat`; the rest is the list, one chat, rename and
 * delete. The student's own only: anything else is a 404.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Env } from '@tc/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENV } from '../../common/env.token.js';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { RESEARCH_CHAT_SOURCES } from './research-chat.js';
import { ResearchChatService } from './research-chat.service.js';
import { streamSse } from './sse.js';

const askBody = z.object({
  message: z.string().trim().min(1).max(2_000),
  /** The chat to continue; absent starts a new one. */
  chatId: z.string().uuid().optional(),
  /** The literature (the default) or "All my theses". */
  source: z.enum(RESEARCH_CHAT_SOURCES).optional(),
  /** The chat filters a search result can answer (ADR-0060 §9). */
  filters: z
    .object({
      yearFrom: z.number().int().min(1800).max(2100).nullish(),
      yearTo: z.number().int().min(1800).max(2100).nullish(),
      minCitations: z.number().int().min(0).max(100_000).nullish(),
      excludePreprints: z.boolean().optional(),
    })
    .optional(),
});

const chatIdParam = z.string().uuid();
const renameBody = z.object({ title: z.string().trim().min(1).max(200) });

function chatId(value: string): string {
  const parsed = chatIdParam.safeParse(value);
  if (!parsed.success) throw new ValidationError('Which chat?');
  return parsed.data;
}

@Controller('research-chats')
@UseGuards(SessionGuard)
export class ResearchChatController {
  constructor(
    private readonly chats: ResearchChatService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** One question: SSE, one CHAT unit (refunded on every refusal after it is taken). */
  @Post('ask')
  async ask(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const parsed = askBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Ask a question first', parsed.error.issues);
    await streamSse(request, reply, this.env, (signal) =>
      this.chats.ask(user, parsed.data, signal),
    );
  }

  /** The student's research chats, the one used last first. */
  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.chats.list(user.id);
  }

  @Get(':chatId')
  get(@CurrentUser() user: SessionUser, @Param('chatId') id: string) {
    return this.chats.get(user.id, chatId(id));
  }

  @Patch(':chatId')
  rename(@CurrentUser() user: SessionUser, @Param('chatId') id: string, @Body() body: unknown) {
    const parsed = renameBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Give the chat a name.', parsed.error.issues);
    return this.chats.rename(user.id, chatId(id), parsed.data.title);
  }

  @Delete(':chatId')
  remove(@CurrentUser() user: SessionUser, @Param('chatId') id: string) {
    return this.chats.remove(user.id, chatId(id));
  }
}
