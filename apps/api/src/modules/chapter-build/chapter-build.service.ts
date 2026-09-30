/**
 * Chapter build — ADR-0039. Starts a build (one `CHAPTER_BUILD` unit, taken before the job is
 * queued), serves its state and QA report, keeps the student's profile choice, and records the
 * student's decision on an issue. The worker does the work and owns the build's status.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  capFor,
  DISCIPLINE_PROFILES,
  disciplineProfile,
  PARADIGM_LABELS,
  PARADIGMS,
  type Plan,
  suggestDiscipline,
  UNIVERSITY_PROFILES,
  universityProfile,
} from '@tc/config';
import type { Prisma } from '@tc/db';
import {
  type BuildProgress,
  type ChapterBuildPlan,
  type ChapterBuildReport,
  type ChapterProfile,
  chapterBuildReportSchema,
  chapterProfileSchema,
  jobId,
  readOutline,
} from '@tc/types';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { refusal, UsageService } from '../usage/usage.service.js';

export type BuildSummary = {
  id: string;
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
};

export type ProfilesView = {
  disciplines: Array<{
    id: string;
    displayName: string;
    departments: string[];
    defaultParadigms: string[];
    entityTypes: Array<{ code: string; label: string }>;
    specialChecks: string[];
    sensitiveNote: string | null;
  }>;
  paradigms: Array<{ id: string; label: string }>;
  universities: Array<{ id: string; displayName: string; spelling: string; confirmed: boolean }>;
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
};

@Injectable()
export class ChapterBuildService {
  private readonly logger = new Logger(ChapterBuildService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly queue: QueueService,
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
        sensitiveNote: d.sensitiveNote ?? null,
      })),
      paradigms: PARADIGMS.map((p) => ({ id: p, label: PARADIGM_LABELS[p] })),
      universities: UNIVERSITY_PROFILES.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        spelling: u.spelling,
        confirmed: u.confirmed,
      })),
    };
  }

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        title: true,
        field: true,
        language: true,
        meta: true,
        chapters: {
          select: { id: true, title: true, order: true, wordCount: true, content: true },
          orderBy: { order: 'asc' },
        },
        shares: { where: { canEdit: true }, select: { id: true }, take: 1 },
        memory: { select: { outline: true } },
      },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /** The saved profile, or one suggested from the thesis's field. */
  profileFor(document: { field: string | null; language: string; meta: unknown }): {
    profile: ChapterProfile;
    suggested: boolean;
  } {
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    const saved = chapterProfileSchema.safeParse(meta.chapterProfile);
    if (saved.success) return { profile: saved.data, suggested: false };
    const discipline = suggestDiscipline(document.field) ?? disciplineProfile(null);
    return {
      profile: {
        disciplineId: discipline.id,
        paradigm: discipline.defaultParadigms[0] ?? 'experimental',
        universityId: universityProfile(null).id,
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
    const row = usage.find((a) => a.action === 'CHAPTER_BUILD');
    const line = {
      used: row?.count ?? 0,
      cap: capFor(user.plan as Plan, 'CHAPTER_BUILD') + (row?.bonus ?? 0),
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
      remaining: line,
      hasCoAuthor: document.shares.length > 0,
    };
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
   * Starts a build: refuses (before any unit is taken) a chapter that already has a build running
   * or pending draft blocks, and a thesis with a live co-author; then one `CHAPTER_BUILD` unit;
   * then the row and the job. The worker takes it from here.
   */
  async start(
    user: { id: string; plan: string },
    documentId: string,
    chapterId: string,
    profileBody?: unknown,
  ): Promise<{ buildId: string }> {
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
      select: { id: true, chapterId: true },
    });
    if (running)
      throw new ConflictError('A chapter build is already running on this thesis. One at a time.');
    const outline = readOutline(document.memory?.outline);
    if (outline.length === 0) {
      throw new ValidationError(
        'Generate the outline first: the build plans the chapter from it and from your objectives.',
      );
    }

    const profile = profileBody
      ? await this.saveProfile(user.id, documentId, profileBody)
      : this.profileFor(document).profile;

    const cap = await this.usage.consume(user.id, user.plan as Plan, 'CHAPTER_BUILD');
    if (!cap.ok) throw refusal('CHAPTER_BUILD', cap);

    const build = await this.prisma.chapterBuild.create({
      data: {
        documentId,
        chapterId,
        userId: user.id,
        status: 'QUEUED',
        profile: profile as Prisma.InputJsonValue,
        progress: { stage: 'loading', sectionsTotal: 0, sectionsDone: 0 } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await this.queue.enqueue(
      'chapter-build',
      { buildId: build.id, documentId, chapterId, userId: user.id, profile },
      { jobId: jobId('chapter-build', build.id) },
    );
    this.logger.log(
      { documentId, chapterId, buildId: build.id, discipline: profile.disciplineId },
      'chapter build queued',
    );
    return { buildId: build.id };
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

/** A chapter with a `draftBlock` still `pending` from a build: the student has not decided yet. */
export function hasPendingBuildBlocks(content: unknown): boolean {
  const doc = content as { content?: unknown[] } | null;
  if (!doc || !Array.isArray(doc.content)) return false;
  return doc.content.some((node) => {
    const n = node as { type?: string; attrs?: { status?: string } };
    return n.type === 'draftBlock' && n.attrs?.status === 'pending';
  });
}
