/**
 * Documents — PRD §9.1.
 *
 * Create, list and get. Every document is created together with its `DocumentMemory` row (PRD §8)
 * and a first chapter, so the editor has somewhere to land (§6.1: `write/:chapterId` is the
 * default landing once a chapter exists). Path B derives the real chapter list from the paper in
 * Phase 1 week 3 (PHASES 3.1); the full outline tree is Phase 2.
 *
 * PRD §12.1: every query is scoped by `ownerId`. Nothing is ever fetched by id alone, and a
 * document belonging to someone else reads as absent rather than forbidden.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TEMPLATE_SPECS } from '@tc/config';
import type { Prisma } from '@tc/db';
import {
  isUntouchedNewThesis,
  newSetupCard,
  type SourcePrefs,
  sourcePrefsSchema,
  UNTITLED_THESIS,
  UNTOUCHED_HIDE_MS,
} from '@tc/types';
import { z } from 'zod';
import { setMetaKey } from '../../common/document-meta.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { AutoSourcesService, type SourcesProgress } from '../assist/auto-sources.service.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { emptyChapterDoc } from '../chapters/word-counts.js';
import { FlagsService } from '../flags/flags.service.js';
import { OutlineService } from '../memory/outline.service.js';
import { ClaimsService } from './claims.service.js';
import { ClaimsDocumentService } from './claims-document.service.js';
import { DocumentArchive } from './document-archive.service.js';
import { DocumentCopier } from './document-copier.service.js';
import { NextActionService, SetupProgressService } from './next-action.service.js';
import { OwnThesisDeletion } from './own-thesis-deletion.service.js';
import { ProgressService } from './progress.service.js';
import { SetupCardService, type SetupView } from './setup-card.service.js';
import { namesATopic } from './topic.js';

const languageBody = z.object({
  language: z
    .string()
    .trim()
    .min(2)
    .max(35)
    .refine((tag) => {
      try {
        return new Intl.Locale(tag).language.length >= 2;
      } catch {
        return false;
      }
    }, 'That is not a language tag — use one like "en", "hi" or "pt-BR".'),
});

const createDocument = z.object({
  title: z.string().trim().min(1, 'Give the thesis a working title').max(300),
  entryPath: z.enum(['A_TOPIC', 'B_PAPER']),
  field: z.string().trim().max(200).optional(),
  /**
   * ADR-0072: "writing" is the Start-writing-now button. Such a thesis has no proposal to plan
   * from, so its chapters are planned from the title at once. The proposal path plans from the
   * proposal when it is saved, as before.
   */
  start: z.enum(['writing', 'proposal']).optional(),
  /**
   * ADR-0087, Jenni's heading step: `standard` gives the thesis chapters at once (Introduction to
   * Conclusion, no AI); `smart` plans chapters and sections from the title (ADR-0072, the default
   * for "writing"); `none` keeps one chapter and plans nothing.
   */
  structure: z.enum(['standard', 'smart', 'none']).optional(),
  /** ADR-0087: the citation-preferences step. */
  sourcePrefs: sourcePrefsSchema.optional(),
  /**
   * ADR-0091 (Jenni build plan R4): the start step asks a few questions first, so the chapters
   * are not planned from the title yet — they are planned from the answers, or from the title
   * when the student skips (both by the existing outline routes).
   */
  askFirst: z.boolean().optional(),
  /**
   * ADR-0145: New opens the editor at once, and the "Set up this thesis" card takes the student
   * through title, field, aim, chapters and first line there. Starts the card at its first row.
   */
  setup: z.boolean().optional(),
});

export type DocumentSummary = {
  id: string;
  title: string;
  entryPath: string;
  createdAt: string;
  updatedAt: string;
  /** The chapter the editor opens by default. */
  firstChapterId: string | null;
  /** R29 (ADR-0114): when the student archived it; null for a thesis on the list. */
  archivedAt: string | null;
};

export type DocumentDetail = DocumentSummary & {
  chapters: Array<{
    id: string;
    title: string;
    order: number;
    outlineNodeId: string;
    wordCount: number;
  }>;
  memory: { scope: unknown; outline: unknown; glossary: unknown } | null;
  /** PRD §9.1 "(meta)": the Path A conversation and cross-paper flags live here. */
  meta: unknown;
  /**
   * ADR-0028: the editor opens live — through the room, not autosave — only when there is
   * someone to write with (a share with `canEdit`) and the feature is on.
   */
  liveEditing: boolean;
  /** The owner's address, for the name on their cursor when the chapter is live. */
  ownerEmail: string;
  /** ADR-0145: the setup card's field row and its folded Sources line. */
  field: string | null;
  citationStyle: string;
};

const summarySelect = {
  id: true,
  title: true,
  entryPath: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  chapters: { orderBy: { order: 'asc' }, take: 1, select: { id: true } },
} satisfies Prisma.DocumentSelect;

type SummaryRow = Prisma.DocumentGetPayload<{ select: typeof summarySelect }>;

function toSummary(d: SummaryRow): DocumentSummary {
  return {
    id: d.id,
    title: d.title,
    entryPath: d.entryPath,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    firstChapterId: d.chapters[0]?.id ?? null,
    archivedAt: d.archivedAt?.toISOString() ?? null,
  };
}

@Controller('documents')
@UseGuards(SessionGuard)
export class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nextActionService: NextActionService,
    private readonly setupProgress: SetupProgressService,
    private readonly progressService: ProgressService,
    private readonly flags: FlagsService,
    private readonly deletion: OwnThesisDeletion,
    private readonly copier: DocumentCopier,
    private readonly archives: DocumentArchive,
    private readonly autoSources: AutoSourcesService,
    private readonly outline: OutlineService,
    private readonly claimsMap: ClaimsService,
    private readonly claimsDocument: ClaimsDocumentService,
    private readonly setupCard: SetupCardService,
  ) {}

  /**
   * Not in §9.1, which has no list route, but the document list screen in §6.1 needs one.
   *
   * R29 (ADR-0114): the theses on the list, without the archived ones — so every screen that asks
   * for "my theses" (the list, the Chrome add-on's picker) leaves them out without knowing
   * archiving exists. `?archived=1` is the other half: only the archived ones, last archived first.
   */
  @Get()
  async list(
    @CurrentUser() user: SessionUser,
    @Query('archived') archived?: string,
  ): Promise<DocumentSummary[]> {
    const onlyArchived = archived === '1' || archived === 'true';
    const documents = await this.prisma.document.findMany({
      where: { ownerId: user.id, archivedAt: onlyArchived ? { not: null } : null },
      orderBy: onlyArchived ? { archivedAt: 'desc' } : { updatedAt: 'desc' },
      select: summarySelect,
    });
    if (onlyArchived) return documents.map(toSummary);
    // ADR-0145: New makes a thesis the moment it is pressed. One nobody named or wrote in is left
    // off the list after a day — not deleted, and back as soon as it is named or written in.
    const now = new Date();
    const untitled = await this.prisma.document.findMany({
      where: {
        ownerId: user.id,
        archivedAt: null,
        title: UNTITLED_THESIS,
        createdAt: { lt: new Date(now.getTime() - UNTOUCHED_HIDE_MS) },
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        meta: true,
        chapters: { select: { title: true, wordCount: true } },
      },
    });
    const hidden = new Set(untitled.filter((d) => isUntouchedNewThesis(d, now)).map((d) => d.id));
    return documents.filter((d) => !hidden.has(d.id)).map(toSummary);
  }

  @Post()
  async create(@CurrentUser() user: SessionUser, @Body() body: unknown): Promise<DocumentSummary> {
    const parsed = createDocument.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('The document could not be created.', parsed.error.issues);
    }

    // FR-9.6/D.3.1: a thesis started inside an institution begins on that institution's
    // formatting template, so a student never has to know which one their department uses.
    const member = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { institution: { select: { templateId: true } } },
    });
    const institutionTemplateId = member?.institution?.templateId ?? null;

    // ADR-0087: Standard headings are the empirical thesis's chapters, made now, with what each
    // must establish as its note. No model is asked.
    const standard =
      parsed.data.structure === 'standard' ? TEMPLATE_SPECS.STEM_EMPIRICAL.chapters : null;
    const outline = standard
      ? standard.map((c, i) => ({
          id: `ch-${i + 1}`,
          title: c.title,
          scopeNote: c.intent,
          children: [],
        }))
      : [];
    const document = await this.prisma.document.create({
      data: {
        ownerId: user.id,
        title: parsed.data.title,
        entryPath: parsed.data.entryPath,
        ...(parsed.data.sourcePrefs || parsed.data.setup
          ? {
              meta: {
                ...(parsed.data.sourcePrefs ? { sourcePrefs: parsed.data.sourcePrefs } : {}),
                ...(parsed.data.setup ? { setup: newSetupCard() } : {}),
              } as Prisma.InputJsonValue,
            }
          : {}),
        ...(parsed.data.field ? { field: parsed.data.field } : {}),
        ...(institutionTemplateId ? { institutionTemplateId } : {}),
        // Every document has exactly one memory row (PRD §8). Created with the document so nothing
        // downstream has to handle its absence.
        memory: {
          create: { scope: {}, outline: outline as Prisma.InputJsonValue, glossary: {} },
        },
        // A first chapter so the editor has somewhere to land (§6.1); every chapter, for
        // Standard headings.
        chapters: {
          create: standard
            ? standard.map((c, i) => ({
                outlineNodeId: `ch-${i + 1}`,
                title: c.title,
                scopeNote: c.intent,
                order: i + 1,
                content: emptyChapterDoc(c.title) as Prisma.InputJsonValue,
              }))
            : {
                outlineNodeId: 'ch-1',
                title: 'Chapter 1',
                order: 1,
                content: emptyChapterDoc('Chapter 1') as Prisma.InputJsonValue,
              },
        },
      },
      select: summarySelect,
    });

    // ADR-0070: the search for papers starts the moment the thesis exists, not when the student
    // first asks for a suggestion, so the library is filling while they answer the proposal
    // questions. A title that names nothing ("Untitled thesis") would search for nothing.
    const firstChapter = document.chapters[0];
    if (firstChapter && namesATopic(parsed.data.title)) {
      await this.autoSources
        .start({
          documentId: document.id,
          userId: user.id,
          chapterId: firstChapter.id,
          query: parsed.data.title,
          // ADR-0087: a starting library of fifteen papers, not five.
          initial: true,
        })
        .catch(() => false);
    }

    // ADR-0072: Start writing now plans the chapters from the title in the background, so the
    // student sees headings with what each must argue instead of one empty "Chapter 1". Every
    // bound of the button applies (a monthly count, the trial, the ₹100 ceiling, the site budget);
    // a refusal here only means no plan, never a failed create.
    const structure = parsed.data.structure ?? 'smart';
    if (
      parsed.data.start === 'writing' &&
      structure === 'smart' &&
      !parsed.data.askFirst &&
      namesATopic(parsed.data.title)
    ) {
      await this.outline
        .planFromTitle(user, document.id, { automatic: true })
        .catch(() => undefined);
    }

    return toSummary(document);
  }

  /** ADR-0070: the editor's "finding papers" line. Free; counts only. */
  @Get(':id/sources/progress')
  async sourcesProgress(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<SourcesProgress> {
    const owned = await this.prisma.document.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });
    if (!owned) throw new NotFoundError('That document');
    return this.autoSources.progress(id);
  }

  /**
   * §2.2: the language the thesis is written in. Every prompt built for this document carries it,
   * so a Hindi thesis gets Hindi suggestions rather than English ones.
   *
   * An IETF tag, validated by `Intl` rather than against a list of our own: the set of languages
   * a student may write in is not ours to decide, and a list would be a list we had to maintain.
   */
  @Put(':id/language')
  async setLanguage(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ language: string }> {
    const parsed = languageBody.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Pick a language', parsed.error.issues);
    }
    const updated = await this.prisma.document.updateMany({
      where: { id, ownerId: user.id },
      data: { language: parsed.data.language },
    });
    if (updated.count === 0) throw new NotFoundError('That document');
    return { language: parsed.data.language };
  }

  /**
   * Jenni build plan R6: the source settings, changed from inside the editor — the same choices as
   * at the start (ADR-0087). Jenni's "select sources" is our pins (ADR-0085), per chapter and
   * section. Only `meta.sourcePrefs` is written (`setMetaKey`), so nothing else kept on `meta` is
   * lost. Free.
   */
  @Put(':id/source-prefs')
  async setSourcePrefs(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ sourcePrefs: SourcePrefs }> {
    const parsed = sourcePrefsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Check the source settings', parsed.error.issues);
    }
    const owned = await this.prisma.document.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });
    if (!owned) throw new NotFoundError('That document');
    const sourcePrefs: SourcePrefs = parsed.data;
    await setMetaKey(this.prisma, id, 'sourcePrefs', sourcePrefs);
    return { sourcePrefs };
  }

  /** PRD §9.1: document + memory + chapters (meta). */
  /**
   * FR-none: not a PRD requirement, but the answer to the question a student actually opens the
   * app with. Free — no model call, only counts already in the database.
   */
  /** The five-step arc and how far through it this thesis is. Free; nothing is computed twice. */
  @Get(':id/setup')
  setup(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.setupProgress.forDocument(id, user.id);
  }

  /**
   * ADR-0145: the "Set up this thesis" card's answers — title (which starts the paper search),
   * source settings, field, university and the card's own state. Free; no model call.
   */
  @Put(':id/setup')
  updateSetup(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SetupView> {
    return this.setupCard.update(user.id, id, body);
  }

  @Get(':id/next-action')
  async nextAction(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.nextActionService.forDocument(id, user.id);
  }

  /**
   * How the thesis is going, as against the usage meter's how-much-AI-is-left. Also free: word
   * counts and provenance are written on every save, so this is a read and some arithmetic.
   */
  @Get(':id/progress')
  async progress(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.progressService.forDocument(id, user.id);
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string): Promise<DocumentDetail> {
    const document = await this.prisma.document.findFirst({
      where: { id, ownerId: user.id },
      select: {
        ...summarySelect,
        memory: { select: { scope: true, outline: true, glossary: true } },
        meta: true,
        field: true,
        citationStyle: true,
        chapters: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true, outlineNodeId: true, wordCount: true },
        },
        shares: { where: { canEdit: true }, select: { id: true }, take: 1 },
      },
    });

    if (!document) throw new NotFoundError('That document');

    return {
      ...toSummary({ ...document, chapters: document.chapters.map((c) => ({ id: c.id })) }),
      chapters: document.chapters,
      memory: document.memory,
      meta: document.meta,
      field: document.field,
      citationStyle: document.citationStyle,
      liveEditing: document.shares.length > 0 && (await this.flags.isEnabled('collaboration')),
      ownerEmail: user.email,
    };
  }

  /**
   * ADR-0057: "Make a copy". A new thesis with its own copies of the chapters, memory, settings
   * and library; no shares, comments, usage or exports. No model call, so no allowance.
   */
  /** ADR-0086: the claims map of the library — stored, and read again on open. */
  @Get(':id/claims')
  claims(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.claimsMap.get(user.id, id);
  }

  /** ADR-0086: map the claims now (one strong-model pass, once an hour per thesis). */
  @Post(':id/claims')
  @HttpCode(200)
  mapClaims(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.claimsMap.map(user, id);
  }

  /**
   * R38 (ADR-0123): the stored claims map as a new chapter of pending drafts, every claim cited
   * from the papers the map read. Free: no model call, no allowance. The same map opens the same
   * chapter again.
   */
  @Post(':id/claims/document')
  @HttpCode(200)
  openClaimsDocument(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.claimsDocument.open(user, id);
  }

  @Post(':id/copy')
  @HttpCode(200)
  async copy(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.copier.copy(user.id, id);
  }

  /** R29 (ADR-0114): off the list, nothing deleted. Free. */
  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.archives.archive(user.id, id);
  }

  /** R29 (ADR-0114): back on the list, as it was. Free. */
  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.archives.restore(user.id, id);
  }

  /**
   * Deletes one of the student's own theses for good (2026-09-29): chapters, sources, versions
   * and every file. The thesis list offers an export first.
   */
  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.deletion.delete(user.id, id);
  }
}
