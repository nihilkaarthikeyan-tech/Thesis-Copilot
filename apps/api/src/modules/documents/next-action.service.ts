/**
 * "What should I do next?" — one recommendation for a document.
 *
 * A student opening a half-written thesis sees a chapter list and a blank page, and the hardest
 * part of the next hour is deciding where to start. This answers that in one sentence.
 *
 * Two properties matter more than the wording:
 *
 *   1. **It costs nothing.** No model call. Every input is already in the database — word counts,
 *      pinned sources, unanswered comments, open flags, grounding levels — so this is arithmetic,
 *      and it stays free however PRD §11's ceiling is finally set.
 *   2. **It is a ladder, not a list.** The rungs are ordered by what is most expensive to leave
 *      undone, and the first one that matches wins. Showing a student five things they could do is
 *      the problem restated, not solved.
 *
 * The ordering is the design. Work someone else is blocked on comes before work only the student
 * is blocked on; a chapter whose reading is already done comes before one that still needs
 * reading, because that is the cheapest writing available.
 */

import { Injectable } from '@nestjs/common';
import { readOutline, walkOutline } from '@tc/types';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { type SetupProgress, setupSteps } from './setup-steps.js';

export type NextActionKind =
  | 'outline'
  | 'sources'
  | 'unresolved'
  | 'comments'
  | 'flags'
  | 'write-ready'
  | 'grounding'
  | 'thinnest'
  | 'clear';

export type NextAction = {
  kind: NextActionKind;
  /** What is true, in one line. Carries the number, because the number is the argument. */
  headline: string;
  /** Why it is worth doing now. */
  detail: string;
  /** The button. */
  cta: string;
  /** Relative to the document, e.g. `/sources`. The web app prefixes `/app/d/:id`. */
  href: string;
};

/** The counts the ladder is decided from — returned too, so the UI can show its working. */
export type NextActionCounts = {
  chapters: number;
  words: number;
  sources: number;
  unresolvedSources: number;
  abstractOnlySources: number;
  openComments: number;
  openFlags: number;
};

type ChapterRow = {
  id: string;
  title: string;
  order: number;
  wordCount: number;
  _count: { pins: number };
};

type DocumentRow = {
  chapters: ChapterRow[];
  comments: Array<{ class: string | null }>;
  flags: Array<{ severity: string }>;
};

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

@Injectable()
export class NextActionService {
  constructor(private readonly prisma: PrismaService) {}

  async forDocument(
    documentId: string,
    ownerId: string,
  ): Promise<NextAction & { counts: NextActionCounts }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        chapters: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            order: true,
            wordCount: true,
            _count: { select: { pins: true } },
          },
        },
        sources: { select: { status: true, groundingLevel: true } },
        comments: { where: { status: 'OPEN' }, select: { class: true } },
        flags: { where: { status: 'OPEN' }, select: { severity: true } },
      },
    });
    if (!document) throw new NotFoundError('That thesis');

    const counts: NextActionCounts = {
      chapters: document.chapters.length,
      words: document.chapters.reduce((sum, c) => sum + c.wordCount, 0),
      sources: document.sources.length,
      unresolvedSources: document.sources.filter((s) => s.status === 'UNRESOLVED').length,
      abstractOnlySources: document.sources.filter(
        (s) => s.status === 'RESOLVED' && s.groundingLevel !== 'FULL_TEXT',
      ).length,
      openComments: document.comments.length,
      openFlags: document.flags.length,
    };

    return { ...decide(document, counts), counts };
  }
}

/**
 * The ladder. First match wins, so the order of these branches is the whole feature.
 *
 * Exported and free of Prisma so it can be tested as the pure function it is — every rung, and
 * every boundary between two rungs, without a database.
 */
export function decide(document: DocumentRow, counts: NextActionCounts): NextAction {
  // 1. Nothing to write in yet.
  if (counts.chapters === 0) {
    return {
      kind: 'outline',
      headline: 'This thesis has no chapters yet',
      detail:
        'Generate an outline and you get a chapter tree you can edit — it is easier to argue with a draft structure than to invent one from nothing.',
      cta: 'Build the outline',
      href: '/outline',
    };
  }

  // 2. Someone else is waiting. A guide who commented and heard nothing back is the one cost here
  //    that grows while it is ignored.
  if (counts.openComments > 0) {
    const substantive = document.comments.filter((c) => c.class === 'SUBSTANTIVE').length;
    return {
      kind: 'comments',
      headline: `${counts.openComments} ${plural(counts.openComments, 'comment')} from your guide ${plural(counts.openComments, 'is', 'are')} unanswered`,
      detail: substantive
        ? `${substantive} of them ${plural(substantive, 'is', 'are')} substantive — the kind that changes an argument rather than a word.`
        : 'Answering them is what keeps the next review short.',
      cta: 'Open the review queue',
      href: '/review',
    };
  }

  // 3. A source that never resolved cannot be cited at all, and the student is the only one who
  //    can supply what the lookup could not find.
  if (counts.unresolvedSources > 0) {
    return {
      kind: 'unresolved',
      headline: `${counts.unresolvedSources} ${plural(counts.unresolvedSources, 'source')} could not be identified`,
      detail:
        'Until they resolve they cannot be cited and nothing can quote them. Most need a DOI or a corrected title.',
      cta: 'Fix them in the library',
      href: '/sources',
    };
  }

  // 4. A contradiction between chapters is cheap to fix now and expensive at the viva.
  if (counts.openFlags > 0) {
    const serious = document.flags.filter((f) => f.severity === 'ERROR').length;
    return {
      kind: 'flags',
      headline: `${counts.openFlags} open ${plural(counts.openFlags, 'coherence flag')}`,
      detail: serious
        ? `${serious} ${plural(serious, 'is', 'are')} serious — a contradiction between chapters is far cheaper to fix now than at the viva.`
        : 'Each one points at a place where two chapters disagree with each other.',
      cta: 'Review the flags',
      href: '/review',
    };
  }

  // 5. Nothing to write from.
  if (counts.sources === 0) {
    return {
      kind: 'sources',
      headline: 'Your library is empty',
      detail:
        'Suggestions can only cite passages you have given them, so with no sources the editor can help with prose but not with evidence.',
      cta: 'Add sources',
      href: '/sources',
    };
  }

  // 6. The best writing available: a chapter whose reading is already done. This is the rung the
  //    whole ladder exists for.
  const ready = document.chapters.find((c) => c._count.pins > 0 && c.wordCount === 0);
  if (ready) {
    return {
      kind: 'write-ready',
      headline: `${ready.title} has ${ready._count.pins} ${plural(ready._count.pins, 'source')} pinned and nothing written`,
      detail: 'The reading for it is done. This is the cheapest chapter in the thesis to start.',
      cta: `Write ${ready.title}`,
      href: `/write/${ready.id}`,
    };
  }

  // 7. Abstract-only sources limit what can be quoted, but they are still usable, so this sits
  //    below anything that blocks writing outright.
  if (counts.abstractOnlySources > 0) {
    return {
      kind: 'grounding',
      headline: `${counts.abstractOnlySources} ${plural(counts.abstractOnlySources, 'source')} ${plural(counts.abstractOnlySources, 'has', 'have')} only an abstract`,
      detail:
        'Suggestions can cite them but cannot quote inside them. Uploading the PDF turns each into a full-text source.',
      cta: 'Open the library',
      href: '/sources',
    };
  }

  // 8. Everything is in order: point at the thinnest chapter, which is the most likely place a
  //    reader will notice the thesis is unfinished.
  const thinnest = [...document.chapters].sort((a, b) => a.wordCount - b.wordCount)[0];
  if (thinnest && counts.words > 0) {
    return {
      kind: 'thinnest',
      headline: `${thinnest.title} is the thinnest chapter at ${thinnest.wordCount.toLocaleString()} words`,
      detail: 'Nothing is blocked. This is where the thesis is most obviously unfinished.',
      cta: `Write ${thinnest.title}`,
      href: `/write/${thinnest.id}`,
    };
  }

  const first = document.chapters[0];
  return {
    kind: 'clear',
    headline: 'Everything is set up. Nothing is written yet',
    // No claim about the outline: `decide` is never told whether there is one, and a thesis can
    // reach this rung with nothing but the single node saving the proposal leaves behind.
    detail: 'Sources are in and no one is waiting on you. Start anywhere.',
    cta: first ? `Write ${first.title}` : 'Open the editor',
    href: first ? `/write/${first.id}` : '/outline',
  };
}

/**
 * The five-step setup arc for one thesis — `setup-steps.ts`.
 *
 * Lives beside `NextAction` because they read almost the same document and answer adjacent
 * questions: that one says what to do next, this one says how far through the whole thing you are.
 * Keeping them in one service means one query rather than two nearly identical ones.
 */
@Injectable()
export class SetupProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async forDocument(documentId: string, ownerId: string): Promise<SetupProgress> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        meta: true,
        chapters: { select: { wordCount: true } },
        sources: { select: { id: true } },
        memory: { select: { scope: true, outline: true } },
      },
    });
    if (!document) throw new NotFoundError('That thesis');

    const scope = (document.memory?.scope ?? null) as { workingTitle?: string } | null;
    const details = (document.meta as Record<string, unknown> | null)?.thesisDetails as
      | Record<string, unknown>
      | undefined;

    return setupSteps(
      {
        hasProposal: Boolean(scope?.workingTitle?.trim()),
        sources: document.sources.length,
        outlineNodes: walkOutline(readOutline(document.memory?.outline)).length,
        words: document.chapters.reduce((sum, c) => sum + c.wordCount, 0),
        // "Filled in" means the fields a title page cannot be built without, not every optional
        // one — an abstract and acknowledgements come much later than this checklist is about.
        hasThesisDetails: Boolean(
          typeof details?.institution === 'string' &&
            details.institution.trim() &&
            typeof details?.degree === 'string' &&
            details.degree.trim(),
        ),
      },
      document.id,
    );
  }
}
