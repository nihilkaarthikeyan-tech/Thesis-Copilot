/**
 * Literature review build — ADR-0124 (R37). The whole literature-review chapter from one press.
 *
 * Planned here in code — the literature chapter's outline subsections and the literature search's
 * themes — with no provider call and no unit. The student edits the themes, then starts it: one
 * `LIT_REVIEW_BUILD` unit, taken by `UsageService.consume` (the atomic statement) before the job is
 * queued and so before any provider call, and given back if the job cannot be queued. The worker
 * runs the chapter build's pipeline over every theme and owns the row's status from there.
 *
 * Behind the `literatureReviewBuild` flag (off by default) and on a cap of 0 on every plan until
 * the owner sets one: with the flag off every route here refuses and the screen does not offer it.
 * The state, the QA report (and its PDF/HTML), and the student's decisions on issues are the
 * chapter build's own routes, on the same `ChapterBuild` row.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Plan } from '@tc/config';
import { Prisma } from '@tc/db';
import {
  type ChapterBuildPlan,
  chapterProfileSchema,
  jobId,
  type LitReviewTheme,
  litReviewPlanEditSchema,
  readOutline,
} from '@tc/types';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import {
  type BuildView,
  ChapterBuildService,
  literatureChapters,
} from './chapter-build.service.js';
import { suggestReviewThemes } from './review-themes.js';

const NOT_A_LITERATURE_CHAPTER =
  'A literature review is written into the thesis’s literature review chapter. Pick that chapter, or give one a title such as “Literature review” on the Outline page.';

@Injectable()
export class LitReviewBuildService {
  private readonly logger = new Logger(LitReviewBuildService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly queue: QueueService,
    private readonly builds: ChapterBuildService,
  ) {}

  private async requireEnabled(): Promise<void> {
    if (!(await this.builds.literatureReviewEnabled())) {
      throw new ForbiddenError('The literature review build is not available yet.');
    }
  }

  /**
   * The plan: the themes the review would write, for the student to confirm. Code only — no
   * provider call, no unit — and an older unstarted review plan on the thesis is replaced.
   */
  async plan(
    user: { id: string; plan: string },
    documentId: string,
    chapterId: string,
    profileBody?: unknown,
  ): Promise<BuildView> {
    await this.requireEnabled();
    const document = await this.builds.guard(user, documentId, chapterId);
    const chapter = literatureChapters(document).find((c) => c.id === chapterId);
    if (!chapter) throw new ValidationError(NOT_A_LITERATURE_CHAPTER);
    const profile = profileBody
      ? await this.builds.saveProfile(user.id, documentId, profileBody)
      : this.builds.profileFor(document).profile;

    await this.prisma.chapterBuild.deleteMany({
      where: { documentId, status: 'PLANNED', kind: 'LIT_REVIEW' },
    });
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { outline: true, gapMap: true },
    });
    const node = readOutline(memory?.outline).find((n) => n.id === chapter.outlineNodeId);
    const themes = suggestReviewThemes(node?.children ?? [], memory?.gapMap ?? null);
    const plan: ChapterBuildPlan = {
      chapterRole: 'LITERATURE',
      entities: [],
      sections: [],
      coverage: {},
      uncovered: [],
      clarifications: [],
      confirmedAt: null,
      themes,
    };
    const build = await this.prisma.chapterBuild.create({
      data: {
        documentId,
        chapterId,
        userId: user.id,
        kind: 'LIT_REVIEW',
        status: 'PLANNED',
        profile: profile as Prisma.InputJsonValue,
        plan: plan as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return this.builds.view(user.id, documentId, build.id);
  }

  /** The student's themes, while the review is still PLANNED: renamed, reordered, added, removed. */
  async updatePlan(
    ownerId: string,
    documentId: string,
    buildId: string,
    body: unknown,
  ): Promise<BuildView> {
    await this.requireEnabled();
    const parsed = litReviewPlanEditSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Check the themes.', parsed.error.issues);
    await this.builds.owned(ownerId, documentId);
    const build = await this.prisma.chapterBuild.findFirst({
      where: { id: buildId, documentId, kind: 'LIT_REVIEW' },
    });
    if (!build) throw new NotFoundError('That review');
    if (build.status !== 'PLANNED') {
      throw new ConflictError('This review has already started; its themes are fixed.');
    }
    const current = (build.plan as ChapterBuildPlan | null) ?? {
      chapterRole: 'LITERATURE',
      entities: [],
      sections: [],
      coverage: {},
      uncovered: [],
    };
    const before = new Map((current.themes ?? []).map((t) => [t.id, t]));
    const seen = new Set<string>();
    const themes: LitReviewTheme[] = parsed.data.themes
      .filter((t) => {
        const k = t.title.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((t, i) => {
        // A planned theme keeps its place in the outline and its subheadings, even renamed.
        const was = t.id ? before.get(t.id) : undefined;
        return {
          id: `t${i + 1}`,
          title: t.title,
          note: t.note,
          outlineNodeId: was?.outlineNodeId ?? null,
          children: was?.children ?? [],
          from: was?.from ?? 'student',
        };
      });
    await this.prisma.chapterBuild.update({
      where: { id: buildId },
      data: { plan: { ...current, themes } as Prisma.InputJsonValue },
    });
    return this.builds.view(ownerId, documentId, buildId);
  }

  /**
   * Starts a PLANNED review: the refusals that cost nothing again, then one `LIT_REVIEW_BUILD`
   * unit, then the job. A job that cannot be queued gives the unit back and leaves it PLANNED.
   */
  async start(
    user: { id: string; plan: string },
    documentId: string,
    buildId: string,
  ): Promise<{ buildId: string }> {
    await this.requireEnabled();
    const build = await this.prisma.chapterBuild.findFirst({
      where: { id: buildId, documentId, userId: user.id, kind: 'LIT_REVIEW' },
    });
    if (!build) throw new NotFoundError('That review');
    if (build.status !== 'PLANNED') throw new ConflictError('This review has already started.');
    const document = await this.builds.guard(user, documentId, build.chapterId);
    if (!literatureChapters(document).some((c) => c.id === build.chapterId)) {
      throw new ValidationError(NOT_A_LITERATURE_CHAPTER);
    }
    const profile = chapterProfileSchema.safeParse(build.profile);
    if (!profile.success) throw new ValidationError('The review has no profile; plan it again.');

    const cap = await this.usage.consume(user.id, user.plan as Plan, 'LIT_REVIEW_BUILD');
    if (!cap.ok) throw refusal('LIT_REVIEW_BUILD', cap);

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
    try {
      // Keyed on the build row, which is what the job reads: its plan and profile are fixed once
      // it leaves PLANNED, and a re-plan is a new row.
      await this.queue.enqueue(
        'lit-review-build',
        {
          buildId,
          documentId,
          chapterId: build.chapterId,
          userId: user.id,
          profile: profile.data,
          kind: 'LIT_REVIEW',
        },
        { jobId: jobId('lit-review-build', buildId) },
      );
    } catch (error) {
      await this.usage.refund(user.id, 'LIT_REVIEW_BUILD');
      await this.prisma.chapterBuild.update({
        where: { id: buildId },
        data: {
          status: 'PLANNED',
          progress: Prisma.DbNull,
          ...(plan ? { plan: plan as Prisma.InputJsonValue } : {}),
        },
      });
      throw error;
    }
    this.logger.log(
      {
        documentId,
        chapterId: build.chapterId,
        buildId,
        themes: plan?.themes?.length ?? 0,
        discipline: profile.data.disciplineId,
      },
      'literature review build queued',
    );
    return { buildId };
  }
}
