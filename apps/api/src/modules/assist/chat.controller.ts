/**
 * `/chat`, `/commands/run`, and the per-user settings — PRD §9.3, FR-4.6, FR-4.8, FR-4.9.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CITATION_ROLES, COMMANDS } from '@tc/ai';
import type { Env } from '@tc/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENV } from '../../common/env.token.js';
import { ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ChatService } from './chat.service.js';
import { CiteRoleService } from './cite-role.service.js';
import { CommandService } from './command.service.js';
import { streamSse } from './sse.js';
import { WebScopeService } from './web-scope.service.js';

const chatBody = z.object({
  documentId: z.string().uuid(),
  message: z.string().trim().min(1).max(2_000),
  /** Where the answer may come from. Defaults to the library, which is what it has always been. */
  scope: z.enum(['library', 'document']).default('library'),
  /** Papers named with `@`: the answer comes from these alone. Ten is more than a question needs. */
  sourceIds: z.array(z.string().uuid()).max(10).optional(),
  filters: z
    .object({
      yearFrom: z.number().int().min(1800).max(2100).nullish(),
      yearTo: z.number().int().min(1800).max(2100).nullish(),
      minCitations: z.number().int().min(0).max(100_000).nullish(),
      excludePreprints: z.boolean().optional(),
    })
    .optional(),
});

const webBody = z.object({
  documentId: z.string().uuid(),
  message: z.string().trim().min(3).max(500),
});

const commandBody = z.object({
  chapterId: z.string().uuid(),
  command: z.enum(COMMANDS),
  selection: z.string().min(1).max(20_000),
  contextBefore: z.string().max(10_000).optional(),
  contextAfter: z.string().max(10_000).optional(),
});

const citeRoleBody = z.object({
  chapterId: z.string().uuid(),
  citationId: z.string().trim().min(1).max(120),
  targetRole: z.enum(CITATION_ROLES),
  sentence: z.string().trim().min(1).max(4_000),
});

const settingsBody = z.object({
  automaticSuggest: z.boolean().optional(),
  /** §2.2: auto-cite is toggled independently of autocomplete. On unless turned off. */
  autoCite: z.boolean().optional(),
  chatFilters: z
    .object({
      yearFrom: z.number().int().nullish(),
      yearTo: z.number().int().nullish(),
      minCitations: z.number().int().nullish(),
      excludePreprints: z.boolean().optional(),
    })
    .optional(),
});

@Controller()
@UseGuards(SessionGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly commands: CommandService,
    private readonly citeRoles: CiteRoleService,
    private readonly web: WebScopeService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** FR-4.9. SSE over POST, like `/assist/suggest` (Appendix B.8). */
  @Post('chat')
  async ask(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const parsed = chatBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Ask a question first', parsed.error.issues);
    await streamSse(request, reply, this.env, (signal) => this.chat.ask(user, parsed.data, signal));
  }

  /**
   * ADR-0016: the web scope returns *candidate sources*, never a prose answer.
   *
   * Not SSE and not metered, because no model is called — this is a scholarly index search whose
   * results become real sources through the ordinary resolve path.
   */
  @Post('chat/web')
  @HttpCode(200)
  async webSearch(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = webBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Ask a question first', parsed.error.issues);
    return this.web.search(user.id, parsed.data.documentId, parsed.data.message);
  }

  @Get('chat/:documentId')
  history(@CurrentUser() user: SessionUser, @Param('documentId') documentId: string) {
    return this.chat.history(user.id, documentId);
  }

  @Post('chat/:documentId/clear')
  @HttpCode(200)
  clear(@CurrentUser() user: SessionUser, @Param('documentId') documentId: string) {
    return this.chat.clear(user.id, documentId);
  }

  /** FR-4.8: `{ chapterId, selection, command }` → the rewrite and its diff. */
  @Post('commands/run')
  @HttpCode(200)
  run(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = commandBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid command', parsed.error.issues);
    return this.commands.run(user, parsed.data);
  }

  /**
   * FR-5.6: move a citation between narrative and parenthetical form.
   *
   * Answers with the rewritten sentence and its diff; nothing reaches the chapter until the
   * student applies it, exactly like a section command.
   */
  @Post('citations/role')
  @HttpCode(200)
  citeRole(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = citeRoleBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.issues);
    return this.citeRoles.run(user, parsed.data);
  }

  /** FR-4.6: automatic-suggest is per user and off by default (ADR-0006). */
  @Get('settings')
  async settings(@CurrentUser() user: SessionUser) {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { settings: true },
    });
    const settings = (row?.settings as Record<string, unknown> | null) ?? {};
    return {
      automaticSuggest: settings.automaticSuggest === true,
      // Unlike automatic-suggest, citations are on by default: a grounded suggestion that shows
      // where it came from is the product's whole argument, and turning that off is the choice.
      autoCite: settings.autoCite !== false,
      ...settings,
    };
  }

  @Put('settings')
  async saveSettings(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = settingsBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid settings', parsed.error.issues);
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { settings: true },
    });
    const settings = {
      ...((row?.settings as Record<string, unknown> | null) ?? {}),
      ...parsed.data,
    };
    await this.prisma.user.update({ where: { id: user.id }, data: { settings } });
    return settings;
  }
}
