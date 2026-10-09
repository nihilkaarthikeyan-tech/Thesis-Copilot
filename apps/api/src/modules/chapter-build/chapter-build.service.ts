/**
 * Chapter build — ADR-0039. Starts a build (one `CHAPTER_BUILD` unit, taken before the job is
 * queued), serves its state and QA report, keeps the student's profile choice, and records the
 * student's decision on an issue. The worker does the work and owns the build's status.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildEntitiesRequest,
  entitiesSchema,
  intakeQuestions,
  type Providers,
  postProcessEntities,
} from '@tc/ai';
import {
  CHECKS,
  capFor,
  chapterRoleFor,
  computeCallCost,
  DISCIPLINE_PROFILES,
  disciplineProfile,
  type Env,
  LANGUAGES,
  LIT_REVIEW_BUILD_FLAG,
  PARADIGM_LABELS,
  PARADIGMS,
  type Plan,
  suggestDiscipline,
  type Template,
  UNIVERSITY_PROFILES,
  universityProfile,
} from '@tc/config';
import type { Prisma } from '@tc/db';
import {
  type BuildProgress,
  type ChapterBuildPlan,
  type ChapterBuildReport,
  type ChapterProfile,
  type Clarification,
  chapterBuildReportSchema,
  chapterProfileSchema,
  jobId,
  planEditSchema,
  readOutline,
  readThesisDetails,
} from '@tc/types';
import { ENV } from '../../common/env.token.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { FlagsService } from '../flags/flags.service.js';
import { RatingsService, type RunRating } from '../ratings/ratings.service.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { qaReportHtml } from './qa-report-html.js';

export type BuildSummary = {
  id: string;
  /** ADR-0124: CHAPTER (ADR-0039) or LIT_REVIEW, the whole literature review. */
  kind: string;
  chapterId: string;
  chapterTitle: string;
  status: string;
  progress: BuildProgress | null;
  createdAt: string;
  finishedAt: string | null;
  blockingOpen: number | null;
  sections: number | null;
  error: string | null;
};

export type BuildView = BuildSummary & {
  profile: ChapterProfile;
  plan: ChapterBuildPlan | null;
  report: ChapterBuildReport | null;
  /** R36 (ADR-0115): the student's "How was this?" on this build, so the card opens as left. */
  rating: RunRating;
};

export type ProfilesView = {
  disciplines: Array<{
    id: string;
    displayName: string;
    departments: string[];
    defaultParadigms: string[];
    entityTypes: Array<{ code: string; label: string }>;
    specialChecks: string[];
    /** The same checks in plain words, for the student: the ids are ours, not theirs. */
    specialCheckLabels: string[];
    sensitiveNote: string | null;
  }>;
  paradigms: Array<{ id: string; label: string }>;
  universities: Array<{ id: string; displayName: string; spelling: string; confirmed: boolean }>;
  languages: Array<{ id: string; label: string; script: string }>;
};

export type OverviewView = {
  profile: ChapterProfile;
  /** True when the profile was suggested from the field rather than chosen by the student. */
  suggested: boolean;
  chapters: Array<{
    id: string;
    title: string;
    order: number;
    wordCount: number;
    pendingBuild: boolean;
  }>;
  builds: BuildSummary[];
  remaining: { used: number; cap: number } | null;
  hasCoAuthor: boolean;
  /**
   * ADR-0124: the whole literature review. `enabled` is the feature flag; off, nothing else is
   * said and the screen does not offer it. On: the chapters it can write (the ones the build
   * calls LITERATURE) and the allowance, which is 0 on every plan until the owner sets one.
   */
  literatureReview: LiteratureReviewOffer;
};

export type LiteratureReviewOffer =
  | { enabled: false }
  | {
      enabled: true;
      chapters: Array<{ id: string; title: string; order: number; pendingBuild: boolean }>;
      remaining: { used: number; cap: number };
    };

@Injectable()
export class ChapterBuildService {
  private readonly logger = new Logger(ChapterBuildService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly queue: QueueService,
    private readonly ratings: RatingsService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
    private readonly flags: FlagsService,
  ) {}

  profiles(): ProfilesView {
    return {
      disciplines: DISCIPLINE_PROFILES.map((d) => ({
        id: d.id,
        displayName: d.displayName,
        departments: [...d.departments],
        defaultParadigms: [...d.defaultParadigms],
        entityTypes: d.entityTypes.map((t) => ({ code: t.code, label: t.label })),
        specialChecks: [...d.specialChecks],
        specialCheckLabels: d.specialChecks.map((id) => CHECKS[id].label),
        sensitiveNote: d.sensitiveNote ?? null,
      })),
      paradigms: PARADIGMS.map((p) => ({ id: p, label: PARADIGM_LABELS[p] })),
      universities: UNIVERSITY_PROFILES.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        spelling: u.spelling,
        confirmed: u.confirmed,
      })),
      languages: LANGUAGES.map((l) => ({ id: l.id, label: l.label, script: l.script })),
    };
  }

  async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        title: true,
        field: true,
        language: true,
        template: true,
        meta: true,
        chapters: {
          select: {
            id: true,
            title: true,
            order: true,
            outlineNodeId: true,
            wordCount: true,
            content: true,
          },
          orderBy: { order: 'asc' },
        },
        shares: { where: { canEdit: true }, select: { id: true }, take: 1 },
        memory: { select: { outline: true, scope: true } },
      },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /** The saved profile, or one suggested from the thesis's field and title. */
  profileFor(document: { title: string; field: string | null; language: string; meta: unknown }): {
    profile: ChapterProfile;
    suggested: boolean;
  } {
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    const saved = chapterProfileSchema.safeParse(meta.chapterProfile);
    if (saved.success) return { profile: saved.data, suggested: false };
    const discipline = suggestDiscipline(document.field, document.title) ?? disciplineProfile(null);
    // ADR-0145: the university the student chose in the editor's setup card, when they chose one.
    const universityId = typeof meta.universityId === 'string' ? meta.universityId : null;
    return {
      profile: {
        disciplineId: discipline.id,
        paradigm: discipline.defaultParadigms[0] ?? 'experimental',
        universityId: universityProfile(universityId).id,
        language: document.language,
      },
      suggested: true,
    };
  }

  async overview(user: { id: string; plan: string }, documentId: string): Promise<OverviewView> {
    const document = await this.owned(user.id, documentId);
    const { profile, suggested } = this.profileFor(document);
    const builds = await this.prisma.chapterBuild.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        kind: true,
        chapterId: true,
        status: true,
        progress: true,
        createdAt: true,
        finishedAt: true,
        report: true,
        error: true,
      },
    });
    const titles = new Map(document.chapters.map((c) => [c.id, c.title]));
    const usage = await this.usage.usageFor(user.id);
    const lineFor = (action: 'CHAPTER_BUILD' | 'LIT_REVIEW_BUILD') => {
      const row = usage.find((a) => a.action === action);
      return {
        used: row?.count ?? 0,
        cap: capFor(user.plan as Plan, action) + (row?.bonus ?? 0),
      };
    };
    return {
      profile,
      suggested,
      chapters: document.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        order: c.order,
        wordCount: c.wordCount,
        pendingBuild: hasPendingBuildBlocks(c.content),
      })),
      builds: builds.map((b) => summarise(b, titles.get(b.chapterId) ?? 'A deleted chapter')),
      remaining: lineFor('CHAPTER_BUILD'),
      hasCoAuthor: document.shares.length > 0,
      literatureReview: (await this.literatureReviewEnabled())
        ? {
            enabled: true,
            chapters: literatureChapters(document).map((c) => ({
              id: c.id,
              title: c.title,
              order: c.order,
              pendingBuild: hasPendingBuildBlocks(c.content),
            })),
            remaining: lineFor('LIT_REVIEW_BUILD'),
          }
        : { enabled: false },
    };
  }

  /** ADR-0124: the DB-backed switch, read at request time (cached 60 s), off by default. */
  literatureReviewEnabled(): Promise<boolean> {
    return this.flags.isEnabled(LIT_REVIEW_BUILD_FLAG);
  }

  async saveProfile(ownerId: string, documentId: string, body: unknown): Promise<ChapterProfile> {
    const parsed = chapterProfileSchema.safeParse(body);
    if (!parsed.success)
      throw new ValidationError(
        'Choose a discipline, a paradigm and a university.',
        parsed.error.issues,
      );
    if (!DISCIPLINE_PROFILES.some((d) => d.id === parsed.data.disciplineId))
      throw new ValidationError('Unknown discipline.');
    if (!(PARADIGMS as readonly string[]).includes(parsed.data.paradigm))
      throw new ValidationError('Unknown paradigm.');
    if (!UNIVERSITY_PROFILES.some((u) => u.id === parsed.data.universityId))
      throw new ValidationError('Unknown university profile.');
    const document = await this.owned(ownerId, documentId);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: documentId },
      data: { meta: { ...meta, chapterProfile: parsed.data } as Prisma.InputJsonValue },
    });
    return parsed.data;
  }

  /**
   * The refusals that cost nothing, shared by the plan step and the start — of a chapter build and
   * of a literature review build (ADR-0124), which write the chapter the same way.
   */
  async guard(user: { id: string }, documentId: string, chapterId: string) {
    const document = await this.owned(user.id, documentId);
    const chapter = document.chapters.find((c) => c.id === chapterId);
    if (!chapter) throw new NotFoundError('That chapter');
    if (document.shares.length > 0) {
      throw new ConflictError(
        'This thesis has a co-author with live editing. A chapter build writes the chapter directly, so it is off while co-authoring is on.',
      );
    }
    if (hasPendingBuildBlocks(chapter.content)) {
      throw new ConflictError(
        'This chapter still has built sections waiting for your decision. Accept or discard them first.',
      );
    }
    const running = await this.prisma.chapterBuild.findFirst({
      where: { documentId, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true },
    });
    if (running) {
      throw new ConflictError('A chapter build is already running on this thesis. One at a time.');
    }
    const outline = readOutline(document.memory?.outline);
    if (outline.length === 0) {
      throw new ValidationError(
        'Generate the outline first: the build plans the chapter from it and from your objectives.',
      );
    }
    return document;
  }

  /**
   * Spec stages 1 and 2: extract the key terms (one fast-tier call, logged, no unit taken) and ask
   * the clarifying questions, then wait for the student to confirm. The row is PLANNED; nothing
   * is queued and nothing is charged until `start`.
   */
  async plan(
    user: { id: string; plan: string },
    documentId: string,
    chapterId: string,
    profileBody?: unknown,
  ): Promise<BuildView> {
    const document = await this.guard(user, documentId, chapterId);
    const profile = profileBody
      ? await this.saveProfile(user.id, documentId, profileBody)
      : this.profileFor(document).profile;
    const discipline = disciplineProfile(profile.disciplineId);
    const scope = (document.memory?.scope as { objectives?: unknown[] } | null) ?? {};
    const objectives = (scope.objectives ?? []).map((o) => String(o).trim()).filter(Boolean);

    // Older PLANNED rows for this chapter are superseded; they never cost anything.
    await this.prisma.chapterBuild.deleteMany({
      where: { documentId, chapterId, status: 'PLANNED', kind: 'CHAPTER' },
    });

    const input = {
      title: document.title,
      objectives,
      questions: [] as string[],
      hypotheses: [] as string[],
      entityTypes: discipline.entityTypes,
      userId: user.id,
      documentId,
    };
    let entities: ChapterBuildPlan['entities'] = [];
    const started = Date.now();
    const request = buildEntitiesRequest(input);
    try {
      const result = await this.providers.llm.complete({ ...request, schema: entitiesSchema });
      await this.logCall(
        user.id,
        documentId,
        result.modelId,
        result.usage,
        Date.now() - started,
        true,
      );
      entities = postProcessEntities(result.value, input);
    } catch (error) {
      await this.logCall(
        user.id,
        documentId,
        this.providers.llm.modelIdFor('fast'),
        null,
        Date.now() - started,
        false,
        error,
      );
      this.logger.warn(
        {
          documentId,
          error: String(error),
          cause: String((error as { cause?: unknown }).cause ?? ''),
          innerCause: String((error as { cause?: { cause?: unknown } }).cause?.cause ?? ''),
        },
        'entity extraction failed; the student can type the terms',
      );
    }
    const clarifications: Clarification[] = intakeQuestions(entities, {
      objectives,
      fallbackType: discipline.entityTypes[0]?.code ?? 'TERM',
    }).map((q) => ({ ...q, answer: null }));

    const plan: ChapterBuildPlan = {
      chapterRole: '',
      entities,
      sections: [],
      coverage: {},
      uncovered: [],
      clarifications,
      confirmedAt: null,
    };
    const build = await this.prisma.chapterBuild.create({
      data: {
        documentId,
        chapterId,
        userId: user.id,
        status: 'PLANNED',
        profile: profile as Prisma.InputJsonValue,
        plan: plan as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return this.view(user.id, documentId, build.id);
  }

  /** The student's edits to the key terms and answers to the questions, while still PLANNED. */
  async updatePlan(
    ownerId: string,
    documentId: string,
    buildId: string,
    body: unknown,
  ): Promise<BuildView> {
    const parsed = planEditSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Check the key terms.', parsed.error.issues);
    await this.owned(ownerId, documentId);
    const build = await this.prisma.chapterBuild.findFirst({
      where: { id: buildId, documentId, kind: 'CHAPTER' },
    });
    if (!build) throw new NotFoundError('That build');
    if (build.status !== 'PLANNED') {
      throw new ConflictError('This build has already started; its key terms are fixed.');
    }
    const profile = chapterProfileSchema.safeParse(build.profile);
    const discipline = disciplineProfile(profile.success ? profile.data.disciplineId : null);
    const codes = new Set(discipline.entityTypes.map((t) => t.code));
    const current = (build.plan as ChapterBuildPlan | null) ?? {
      chapterRole: '',
      entities: [],
      sections: [],
      coverage: {},
      uncovered: [],
    };
    const seen = new Set<string>();
    const entities = parsed.data.entities
      .filter((e) => {
        const key = e.text.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((e, i) => ({
        id: `E${String(i + 1).padStart(2, '0')}`,
        text: e.text,
        type: codes.has(e.type) ? e.type : (discipline.entityTypes[0]?.code ?? 'TERM'),
        aliases: [...new Set(e.aliases.filter((a) => a.toLowerCase() !== e.text.toLowerCase()))],
        sourceObjective: e.sourceObjective,
        coveredBy: [],
      }));
    const byId = new Map(parsed.data.answers.map((a) => [a.id, a.answer]));
    const clarifications = (current.clarifications ?? []).map((q) => {
      const answer = byId.has(q.id) ? (byId.get(q.id) as string) || null : q.answer;
      return { ...q, answer };
    });
    // An expansion given for an abbreviation becomes an alias, so coverage and L3 see it.
    for (const q of clarifications) {
      if (q.kind !== 'abbreviation' || !q.answer || !q.entityId) continue;
      const original = current.entities.find((e) => e.id === q.entityId);
      const entity = entities.find(
        (e) => original && e.text.toLowerCase() === original.text.toLowerCase(),
      );
      if (entity && !entity.aliases.some((a) => a.toLowerCase() === q.answer?.toLowerCase())) {
        entity.aliases.push(q.answer);
      }
    }
    const plan: ChapterBuildPlan = { ...current, entities, clarifications };
    await this.prisma.chapterBuild.update({
      where: { id: buildId },
      data: { plan: plan as Prisma.InputJsonValue },
    });
    return this.view(ownerId, documentId, buildId);
  }

  /**
   * Starts a PLANNED build: the refusals again (nothing has been charged yet), then one
   * `CHAPTER_BUILD` unit, then the job. The worker takes it from here.
   */
  async start(
    user: { id: string; plan: string },
    documentId: string,
    buildId: string,
  ): Promise<{ buildId: string }> {
    // A literature review row (ADR-0124) is started by its own route, on its own unit.
    const build = await this.prisma.chapterBuild.findFirst({
      where: { id: buildId, documentId, userId: user.id, kind: 'CHAPTER' },
    });
    if (!build) throw new NotFoundError('That build');
    if (build.status !== 'PLANNED') throw new ConflictError('This build has already started.');
    await this.guard(user, documentId, build.chapterId);
    const profile = chapterProfileSchema.safeParse(build.profile);
    if (!profile.success) throw new ValidationError('The build has no profile; plan it again.');

    const cap = await this.usage.consume(user.id, user.plan as Plan, 'CHAPTER_BUILD');
    if (!cap.ok) throw refusal('CHAPTER_BUILD', cap);

    const plan = (build.plan as ChapterBuildPlan | null) ?? null;
    await this.prisma.chapterBuild.update({
      where: { id: buildId },
      data: {
        status: 'QUEUED',
        progress: { stage: 'loading', sectionsTotal: 0, sectionsDone: 0 } as Prisma.InputJsonValue,
        ...(plan
          ? { plan: { ...plan, confirmedAt: new Date().toISOString() } as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.queue.enqueue(
      'chapter-build',
      { buildId, documentId, chapterId: build.chapterId, userId: user.id, profile: profile.data },
      { jobId: jobId('chapter-build', buildId) },
    );
    this.logger.log(
      { documentId, chapterId: build.chapterId, buildId, discipline: profile.data.disciplineId },
      'chapter build queued',
    );
    return { buildId };
  }

  /**
   * The QA report as a file (spec §11). HTML always; PDF through Gotenberg's Chromium route, the
   * same service the thesis PDF uses.
   */
  async reportDocument(
    ownerId: string,
    documentId: string,
    buildId: string,
    format: 'html' | 'pdf',
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const document = await this.owned(ownerId, documentId);
    const view = await this.view(ownerId, documentId, buildId);
    if (!view.report) throw new ConflictError('This build has no report yet.');
    const details = readThesisDetails(
      (document.meta as Record<string, unknown> | null)?.thesisDetails,
    );
    const html = qaReportHtml({
      thesisTitle: document.title,
      chapterTitle:
        view.kind === 'LIT_REVIEW' ? `Literature review · ${view.chapterTitle}` : view.chapterTitle,
      studentName: details.studentName,
      disciplineName: disciplineProfile(view.profile.disciplineId).displayName,
      paradigm:
        (PARADIGM_LABELS as Record<string, string>)[view.profile.paradigm] ?? view.profile.paradigm,
      universityName: universityProfile(view.profile.universityId).displayName,
      builtAt: (view.finishedAt ?? view.createdAt).slice(0, 10),
      plan: view.plan,
      report: view.report,
    });
    const stem = `QA_Report_${view.chapterTitle.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}`;
    if (format === 'html') {
      return {
        body: Buffer.from(html, 'utf8'),
        contentType: 'text/html; charset=utf-8',
        filename: `${stem}.html`,
      };
    }
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    form.append('paperWidth', '8.27');
    form.append('paperHeight', '11.7');
    form.append('marginTop', '0');
    form.append('marginBottom', '0');
    form.append('marginLeft', '0');
    form.append('marginRight', '0');
    form.append('printBackground', 'true');
    const response = await fetch(`${this.env.GOTENBERG_URL}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
    }).catch((error: unknown) => {
      throw new ConflictError(
        `The PDF service is not reachable (${error instanceof Error ? error.message : String(error)}). Download the HTML report instead.`,
      );
    });
    if (!response.ok) {
      throw new ConflictError(
        `The PDF service refused the conversion (HTTP ${response.status}). Download the HTML report instead.`,
      );
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: 'application/pdf',
      filename: `${stem}.pdf`,
    };
  }

  private async logCall(
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
        ? computeCallCost({ tier: 'fast', modelId: model, usage })
        : 0;
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'CHAPTER_BUILD',
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

  async view(ownerId: string, documentId: string, buildId: string): Promise<BuildView> {
    const document = await this.owned(ownerId, documentId);
    const build = await this.prisma.chapterBuild.findFirst({ where: { id: buildId, documentId } });
    if (!build) throw new NotFoundError('That build');
    const title =
      document.chapters.find((c) => c.id === build.chapterId)?.title ?? 'A deleted chapter';
    const profile = chapterProfileSchema.safeParse(build.profile);
    return {
      ...summarise(build, title),
      profile: profile.success ? profile.data : this.profileFor(document).profile,
      plan: (build.plan as ChapterBuildPlan | null) ?? null,
      report: (build.report as ChapterBuildReport | null) ?? null,
      rating:
        build.status === 'DONE'
          ? await this.ratings.forRun(ownerId, 'CHAPTER_BUILD', build.id)
          : null,
    };
  }

  /**
   * The student's decision on an issue (spec §2.5 `accepted_by_user`): kept on the report with the
   * reason, so the QA report says what was dismissed and why. Never changes the chapter.
   */
  async decideIssue(
    ownerId: string,
    documentId: string,
    buildId: string,
    issueId: string,
    action: 'accept' | 'reopen',
    note?: string,
  ): Promise<{ status: string }> {
    await this.owned(ownerId, documentId);
    const build = await this.prisma.chapterBuild.findFirst({
      where: { id: buildId, documentId },
      select: { report: true },
    });
    if (!build) throw new NotFoundError('That build');
    const parsed = chapterBuildReportSchema.safeParse(build.report);
    if (!parsed.success) throw new ConflictError('This build has no report yet.');
    const report = parsed.data;
    const issue = report.issues.find((i) => i.id === issueId);
    if (!issue) throw new NotFoundError('That issue');
    if (issue.status === 'fixed')
      throw new ConflictError('That issue was already fixed by the build.');
    issue.status = action === 'accept' ? 'accepted_by_user' : 'open';
    if (action === 'accept') issue.userNote = note ?? '';
    else delete issue.userNote;
    const open = report.issues.filter((i) => i.status === 'open');
    report.totals.blockingOpen = open.filter((i) => i.severity === 'blocking').length;
    report.totals.warningsOpen = open.filter((i) => i.severity === 'warning').length;
    for (const check of report.checks) {
      const here = open.filter((i) => i.checkId === check.checkId);
      check.open = here.length;
      if (check.status !== 'skipped') {
        check.status = here.some((i) => i.severity === 'blocking')
          ? 'fail'
          : here.length > 0
            ? 'warn'
            : 'pass';
      }
    }
    await this.prisma.chapterBuild.update({
      where: { id: buildId },
      data: { report: report as Prisma.InputJsonValue },
    });
    return { status: issue.status };
  }
}

function summarise(
  b: {
    id: string;
    kind: string;
    chapterId: string;
    status: string;
    progress: unknown;
    createdAt: Date;
    finishedAt: Date | null;
    report: unknown;
    error: string | null;
  },
  chapterTitle: string,
): BuildSummary {
  const report = b.report as ChapterBuildReport | null;
  return {
    id: b.id,
    kind: b.kind,
    chapterId: b.chapterId,
    chapterTitle,
    status: b.status,
    progress: (b.progress as BuildProgress | null) ?? null,
    createdAt: b.createdAt.toISOString(),
    finishedAt: b.finishedAt?.toISOString() ?? null,
    blockingOpen: report?.totals.blockingOpen ?? null,
    sections: report?.sections.length ?? null,
    error: b.error,
  };
}

/**
 * ADR-0124: the chapters a literature review build may write — the ones the chapter build itself
 * would plan as LITERATURE (`chapterRoleFor`, the worker's rule).
 */
export function literatureChapters<
  C extends { id: string; title: string; order: number; outlineNodeId: string },
>(document: {
  chapters: readonly C[];
  template: Template | null;
  memory: { outline: unknown } | null;
}): C[] {
  const outline = readOutline(document.memory?.outline);
  return document.chapters.filter(
    (c) => chapterRoleFor(c, outline, document.template) === 'LITERATURE',
  );
}

/** A chapter with a `draftBlock` still `pending` from a build: the student has not decided yet. */
export function hasPendingBuildBlocks(content: unknown): boolean {
  const doc = content as { content?: unknown[] } | null;
  if (!doc || !Array.isArray(doc.content)) return false;
  return doc.content.some((node) => {
    const n = node as { type?: string; attrs?: { status?: string } };
    return n.type === 'draftBlock' && n.attrs?.status === 'pending';
  });
}
