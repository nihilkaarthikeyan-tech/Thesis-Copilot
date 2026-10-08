/**
 * "How was this?" — Jenni build plan R36 (ADR-0115).
 *
 * A student's thumbs on something the product generated for them, with an optional one-line note,
 * kept in `OutputRating` against the run: a chapter build by its id, a viva question set by its
 * `setId`. One row per person per run; answering again changes it, `0` takes it back. Free: no
 * model call and no allowance.
 *
 * The rating carries ids and the student's own words, never thesis text, so the superadmin can read
 * it in the feedback inbox without reading a thesis (§12.2).
 */

import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

/** The URL's kind, and what is stored for it. A new kind of generated output adds a line here. */
export const RATED_KINDS = {
  'chapter-build': 'CHAPTER_BUILD',
  viva: 'VIVA',
} as const;

export type RatedKindSlug = keyof typeof RATED_KINDS;
export type RatedKind = (typeof RATED_KINDS)[RatedKindSlug];

/** One line, so it stays a remark rather than a report. */
export const RATING_NOTE_MAX = 200;

export type RunRating = { value: 1 | -1; note: string | null } | null;

/** A note as kept: line breaks folded to spaces, trimmed, empty as null. */
export function oneLine(note: string | null | undefined): string | null {
  const line = (note ?? '').replace(/\s+/g, ' ').trim();
  return line.length > 0 ? line : null;
}

@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The student's rating of one run, as the run's own view returns it. */
  async forRun(userId: string, kind: RatedKind, runId: string): Promise<RunRating> {
    const row = await this.prisma.outputRating.findUnique({
      where: { kind_runId_userId: { kind, runId, userId } },
      select: { rating: true, note: true },
    });
    return row ? { value: row.rating === 1 ? 1 : -1, note: row.note } : null;
  }

  async rate(
    userId: string,
    documentId: string,
    kind: RatedKind,
    runId: string,
    rating: 1 | -1 | 0,
    note: string | null,
  ): Promise<{ rating: 1 | -1 | null; note: string | null }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: userId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    await this.assertRun(documentId, userId, kind, runId);

    const key = { kind_runId_userId: { kind, runId, userId } };
    if (rating === 0) {
      await this.prisma.outputRating.deleteMany({ where: { kind, runId, userId } });
      return { rating: null, note: null };
    }
    const saved = await this.prisma.outputRating.upsert({
      where: key,
      create: { documentId, userId, kind, runId, rating, note },
      update: { rating, note },
      select: { rating: true, note: true },
    });
    return { rating: saved.rating === 1 ? 1 : -1, note: saved.note };
  }

  /** The run must be this thesis's, and finished: there is nothing to rate before that. */
  private async assertRun(documentId: string, userId: string, kind: RatedKind, runId: string) {
    if (kind === 'CHAPTER_BUILD') {
      const build = await this.prisma.chapterBuild.findFirst({
        where: { id: runId, documentId, userId },
        select: { status: true },
      });
      if (!build) throw new NotFoundError('That build');
      if (build.status !== 'DONE') {
        throw new ConflictError('This build has not finished, so there is nothing to rate yet.');
      }
      return;
    }
    const question = await this.prisma.vivaQuestion.findFirst({
      where: { documentId, setId: runId },
      select: { id: true },
    });
    if (!question) throw new NotFoundError('Those questions');
  }
}
