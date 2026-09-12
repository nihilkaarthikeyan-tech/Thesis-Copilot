/**
 * How the thesis is going — as distinct from how much AI is left.
 *
 * The editor already shows a usage meter, but it counts the student's *allowance*, not their work.
 * Nothing in the product answers "how far along am I", which is the question a supervisor opens
 * with and the one a student cannot answer from a chapter list.
 *
 * Free, like the next-action ladder: `Chapter.wordCount` and `Chapter.wordCounts` are written on
 * every save, pins and citations are rows, so this is a read and some arithmetic. No model call.
 *
 * Two of the numbers here exist nowhere else in the product:
 *
 *   - **Words by provenance.** `wordCounts` records which ranges came from a suggestion, a draft or
 *     a command (§12.3, FR-4.11). Summed across chapters it is the disclosure figure a student will
 *     be asked for, and seeing it while writing is better than discovering it at submission.
 *   - **Pinned but never cited.** A source attached to a chapter and never used is reading that has
 *     not yet earned its place. No other screen can show it, because it is a join.
 */

import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVENANCE_KINDS, type WordCounts } from '../chapters/word-counts.js';

export type ChapterProgress = {
  id: string;
  title: string;
  order: number;
  words: number;
  /** Words by how they got there. Absent on chapters saved before provenance was recorded. */
  byProvenance: WordCounts | null;
  /** Sources pinned to this chapter. */
  pinned: number;
  /** Distinct sources actually cited in it. */
  cited: number;
  /** Pinned and never cited — reading done, not yet used. */
  unused: number;
  updatedAt: Date;
  /** Whole days since the chapter was last saved. */
  daysSinceEdit: number;
};

export type DocumentProgress = {
  words: number;
  chapters: ChapterProgress[];
  /** Document-wide provenance, summed from the chapters that record it. */
  byProvenance: WordCounts;
  /**
   * Share of words the student typed themselves, 0-100, or null when no chapter records
   * provenance — which is not the same as "0% human" and must not be shown as though it were.
   */
  humanPercent: number | null;
  sources: number;
  /** Sources in the library cited nowhere in the thesis. */
  neverCited: number;
  /** The chapter last worked on, or null for a thesis with no writing yet. */
  lastWorked: { id: string; title: string; daysAgo: number } | null;
};

const EMPTY: WordCounts = { HUMAN: 0, ASSIST: 0, DRAFT: 0, COMMAND: 0, HUMAN_EDITED: 0 };

/**
 * `wordCounts` is a JSON column, so its shape is a claim rather than a guarantee — a row written by
 * an older build has no such key at all. Anything that is not a complete set of finite numbers is
 * treated as absent, because a partial one would quietly understate the AI share.
 */
export function readWordCounts(value: unknown): WordCounts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const out = { ...EMPTY };
  for (const kind of PROVENANCE_KINDS) {
    const n = record[kind];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
    out[kind] = n;
  }
  return out;
}

/** Whole days between two instants, floored, never negative. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async forDocument(
    documentId: string,
    ownerId: string,
    now: Date = new Date(),
  ): Promise<DocumentProgress> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        chapters: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            order: true,
            wordCount: true,
            wordCounts: true,
            updatedAt: true,
            pins: { select: { sourceId: true } },
            citations: { select: { sourceId: true } },
          },
        },
        sources: { select: { id: true } },
      },
    });
    if (!document) throw new NotFoundError('That thesis');

    const citedAnywhere = new Set<string>();
    const byProvenance = { ...EMPTY };
    let recordsProvenance = false;

    const chapters: ChapterProgress[] = document.chapters.map((c) => {
      const counts = readWordCounts(c.wordCounts);
      if (counts) {
        recordsProvenance = true;
        for (const kind of PROVENANCE_KINDS) byProvenance[kind] += counts[kind];
      }

      const cited = new Set(c.citations.map((x) => x.sourceId));
      for (const id of cited) citedAnywhere.add(id);
      const pinned = new Set(c.pins.map((x) => x.sourceId));
      const unused = [...pinned].filter((id) => !cited.has(id)).length;

      return {
        id: c.id,
        title: c.title,
        order: c.order,
        words: c.wordCount,
        byProvenance: counts,
        pinned: pinned.size,
        cited: cited.size,
        unused,
        updatedAt: c.updatedAt,
        daysSinceEdit: daysBetween(c.updatedAt, now),
      };
    });

    // Only chapters with words can have been "worked on": an untouched chapter still carries the
    // `updatedAt` of the day the outline created it, which would otherwise read as recent work.
    const worked = chapters
      .filter((c) => c.words > 0)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    const totalProvenance = PROVENANCE_KINDS.reduce((sum, k) => sum + byProvenance[k], 0);
    // HUMAN_EDITED counts as the student's: a suggestion they rewrote is their sentence now.
    const human = byProvenance.HUMAN + byProvenance.HUMAN_EDITED;

    return {
      words: chapters.reduce((sum, c) => sum + c.words, 0),
      chapters,
      byProvenance,
      humanPercent:
        recordsProvenance && totalProvenance > 0
          ? Math.round((human / totalProvenance) * 100)
          : null,
      sources: document.sources.length,
      neverCited: document.sources.filter((s) => !citedAnywhere.has(s.id)).length,
      lastWorked: worked
        ? { id: worked.id, title: worked.title, daysAgo: worked.daysSinceEdit }
        : null,
    };
  }
}
