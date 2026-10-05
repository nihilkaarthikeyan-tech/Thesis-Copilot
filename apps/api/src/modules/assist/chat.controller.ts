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
  Query,
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
import { FlagsService } from '../flags/flags.service.js';
import { BEYOND_SETTINGS, beyondSettingOf } from './beyond-library.js';
import { ChatService } from './chat.service.js';
import { ChatAttachmentsService } from './chat-attachments.service.js';
import { CiteRoleService } from './cite-role.service.js';
import { CommandService } from './command.service.js';
import { EquationService } from './equation.service.js';
import { ProofreadService } from './proofread.service.js';
import { streamSse } from './sse.js';
import { ToneService } from './tone.service.js';
import { WebScopeService } from './web-scope.service.js';

const chatBody = z.object({
  documentId: z.string().uuid(),
  message: z.string().trim().min(1).max(2_000),
  /**
   * Where the answer may come from. Defaults to the library, which is what it has always been.
   * 'beyond' (ADR-0060) answers from the abstracts a scholarly search returns.
   */
  scope: z.enum(['library', 'document', 'beyond']).default('library'),
  /** Papers named with `@`: the answer comes from these alone. Ten is more than a question needs. */
  sourceIds: z.array(z.string().uuid()).max(10).optional(),
  /** ADR-0080: deep research — planned, searched per part, answered at length; one RESEARCH unit. */
  deep: z.boolean().optional(),
  /** ADR-0083: files uploaded to `POST /chat/attachments` for this question. */
  attachmentIds: z.array(z.string().uuid()).max(3).optional(),
  filters: z
    .object({
      yearFrom: z.number().int().min(1800).max(2100).nullish(),
      yearTo: z.number().int().min(1800).max(2100).nullish(),
      minCitations: z.number().int().min(0).max(100_000).nullish(),
      minJournalCitedness: z.number().min(0).max(1_000).nullish(),
      excludePreprints: z.boolean().optional(),
    })
    .optional(),
});

const webBody = z.object({
  documentId: z.string().uuid(),
  message: z.string().trim().min(3).max(500),
});

/** ADR-0084: the tone review, against the writing profile or a chosen paper. */
const toneBody = z.object({
  chapterId: z.string().uuid(),
  sampleSourceId: z.string().uuid().optional(),
  fromSentence: z.number().int().min(0).optional(),
});

const proofreadBody = z.object({
  chapterId: z.string().uuid(),
  /** Where a previous run stopped, for a chapter longer than one run reads. */
  fromSentence: z.number().int().min(0).max(100_000).optional(),
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
  /** ADR-0037: find papers on the section when the library has none. On unless turned off. */
  autoSources: z.boolean().optional(),
  /**
   * ADR-0058: one email when a long job (search, chapter build, examiner review, coherence check)
   * finishes while its page is closed. On unless turned off; the worker reads it.
   */
  emailWhenJobDone: z.boolean().optional(),
  /**
   * ADR-0061: the language of the screens (menus, buttons, labels). Not the thesis's language,
   * which is the document's own (§2.2) and decides what the AI writes; nothing server-side reads
   * this one. Absent means English.
   */
  interfaceLanguage: z.enum(['en', 'hi']).optional(),
  /**
   * 2026-10-04 (Jenni's "document defaults"): the style a new thesis starts on. Only the five
   * the start screen offers; null clears it (APA 7, as before).
   */
  defaultCitationStyle: z
    .enum(['apa', 'harvard', 'ieee', 'vancouver', 'chicago-author-date'])
    .nullable()
    .optional(),
  /**
   * ADR-0060: when a library question finds nothing, search the scholarly indexes and answer from
   * their abstracts — never, after asking (the default), or at once.
   */
  searchBeyondLibrary: z.enum(BEYOND_SETTINGS).optional(),
  chatFilters: z
    .object({
      yearFrom: z.number().int().nullish(),
      yearTo: z.number().int().nullish(),
      minCitations: z.number().int().nullish(),
      minJournalCitedness: z.number().min(0).max(1_000).nullish(),
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
    private readonly proofread: ProofreadService,
    private readonly tone: ToneService,
    private readonly citeRoles: CiteRoleService,
    private readonly equations: EquationService,
    private readonly web: WebScopeService,
    private readonly attachments: ChatAttachmentsService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly flags: FlagsService,
  ) {}

  /**
   * ADR-0083: a file for the next question — a picture, a PDF, a Word or text file. Multipart,
   * one file; `?documentId=`. Read for that question only: nothing joins the library.
   */
  @Post('chat/attachments')
  @HttpCode(200)
  async attach(
    @CurrentUser() user: SessionUser,
    @Query('documentId') documentId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!z.string().uuid().safeParse(documentId).success) {
      throw new ValidationError('Which thesis is this file for?');
    }
    const file = await (
      request as unknown as {
        file: () => Promise<{ filename?: string; toBuffer: () => Promise<Buffer> } | undefined>;
      }
    ).file();
    if (!file) throw new ValidationError('Attach a file.');
    const bytes = new Uint8Array(await file.toBuffer());
    return this.attachments.upload(user.id, documentId, file.filename ?? 'attachment', bytes);
  }

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

  /**
   * ADR-0026: proofread one chapter. Corrections come back as data; the editor applies one only
   * when the student accepts it. One `COMMAND` unit a run.
   */
  @Post('proofread')
  @HttpCode(200)
  proofreadChapter(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = proofreadBody.safeParse(body);
    if (!parsed.success)
      throw new ValidationError('Invalid proofread request', parsed.error.issues);
    return this.proofread.run(user, parsed.data.chapterId, parsed.data.fromSentence ?? 0);
  }

  /**
   * ADR-0084: review one chapter's tone against the student's own profile or a library paper.
   * Rewrites come back as data; the editor applies one only when the student accepts it. One
   * `COMMAND` unit a run.
   */
  @Post('tone-review')
  @HttpCode(200)
  toneReview(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = toneBody.safeParse(body);
    if (!parsed.success)
      throw new ValidationError('Invalid tone review request', parsed.error.issues);
    return this.tone.run(user, parsed.data.chapterId, {
      ...(parsed.data.sampleSourceId ? { sampleSourceId: parsed.data.sampleSourceId } : {}),
      fromSentence: parsed.data.fromSentence ?? 0,
    });
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
  /** ADR-0063: an equation described in words, offered back for the student to check. */
  @Post('equations/from-words')
  @HttpCode(200)
  equationFromWords(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = z
      .object({
        documentId: z.string().uuid(),
        description: z.string().trim().min(1).max(600),
        current: z.string().max(4_000).nullish(),
      })
      .safeParse(body);
    if (!parsed.success)
      throw new ValidationError('Describe the equation first', parsed.error.issues);
    return this.equations.fromWords(user, parsed.data);
  }

  /** ADR-0064: an equation read from a photo (multipart, one picture; `?documentId=`). */
  @Post('equations/from-photo')
  @HttpCode(200)
  async equationFromPhoto(
    @CurrentUser() user: SessionUser,
    @Query('documentId') documentId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!z.string().uuid().safeParse(documentId).success) {
      throw new ValidationError('Which thesis is this equation for?');
    }
    const file = await (
      request as unknown as {
        file: () => Promise<{ toBuffer: () => Promise<Buffer> } | undefined>;
      }
    ).file();
    if (!file) throw new ValidationError('Attach a photo of the equation.');
    const bytes = new Uint8Array(await file.toBuffer());
    return this.equations.fromPhoto(user, documentId, bytes);
  }

  @Post('citations/role')
  @HttpCode(200)
  citeRole(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = citeRoleBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.issues);
    return this.citeRoles.run(user, parsed.data);
  }

  /**
   * FR-4.6: automatic-suggest is per user (ADR-0006). A student's own choice wins; until they make
   * one, the `automaticSuggest` flag sets the default (ADR-0053, 2026-10-04: on in production, as
   * Jenni suggests on a pause; the flag was seeded and never read).
   */
  /** Thumbs on a chat answer (2026-10-04). No model call, no unit. */
  @Post('chat/:documentId/turns/:turnId/rating')
  @HttpCode(200)
  rateAnswer(
    @CurrentUser() user: SessionUser,
    @Param('documentId') documentId: string,
    @Param('turnId') turnId: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({ rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]) })
      .safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid rating', parsed.error.issues);
    return this.chat.rate(user.id, documentId, turnId, parsed.data.rating);
  }

  @Get('settings')
  async settings(@CurrentUser() user: SessionUser) {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { settings: true },
    });
    const settings = (row?.settings as Record<string, unknown> | null) ?? {};
    const autoDefault = await this.flags.isEnabled('automaticSuggest');
    return {
      automaticSuggest:
        typeof settings.automaticSuggest === 'boolean' ? settings.automaticSuggest : autoDefault,
      // Unlike automatic-suggest, citations are on by default: a grounded suggestion that shows
      // where it came from is the product's whole argument, and turning that off is the choice.
      autoCite: settings.autoCite !== false,
      autoSources: settings.autoSources !== false,
      emailWhenJobDone: settings.emailWhenJobDone !== false,
      ...settings,
      searchBeyondLibrary: beyondSettingOf(settings),
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
