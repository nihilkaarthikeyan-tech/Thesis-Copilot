/**
 * The review queue's actions — PRD Appendix D.2.2–D.2.4, PHASES v2 B2.2, B2.4, B2.5.
 *
 * Accepting a revision is the only place in the product where AI text enters a chapter without
 * the student having typed a key in the editor, so it is also the most carefully bounded:
 *
 *   - a snapshot is written first, so the previous text is one click away;
 *   - the replacement covers exactly the anchored range and nothing around it;
 *   - the new text carries `COMMAND` provenance, so the AI-usage log and the style profile both
 *     know it was not the student's own writing;
 *   - and it happens only after the student has read the diff (D.2.4).
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { COMMENT, findAnchor, NEEDS_INPUT_RE } from '@tc/ai';
import type { Env } from '@tc/config';
import { type ChapterSentence, sentencesOf } from '@tc/retrieval';
import { jobId } from '@tc/types';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { MAILER, type Mailer } from '../../common/mailer.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { SnapshotsService } from '../chapters/snapshots.service.js';
import { CommentsService, type CommentView } from './comments.service.js';

/** D.2.2's splitter: blank lines, and numbered or bulleted prefixes. */
export function splitFeedback(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .flatMap((block) => {
      // A single block that is itself a numbered or bulleted list becomes one comment per item.
      if (/^\s*(?:[-*•]|\d+[.)])\s+/m.test(block) && block.split('\n').length > 1) {
        return block
          .split(/\n(?=\s*(?:[-*•]|\d+[.)])\s+)/)
          .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
      }
      return [block];
    })
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter((block) => block.length >= 4);
  return blocks;
}

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comments: CommentsService,
    private readonly snapshots: SnapshotsService,
    private readonly queue: QueueService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, title: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /** D.2.2: pasted feedback → one comment per item, unanchored until the student assigns it. */
  async splitPasted(
    user: SessionUser,
    documentId: string,
    text: string,
    chapterId: string | null,
  ): Promise<{ created: number; comments: CommentView[] }> {
    await this.owned(user.id, documentId);
    const items = splitFeedback(text);
    if (items.length === 0) {
      throw new ValidationError('Nothing in that paste looked like a comment.');
    }
    for (const body of items) {
      await this.comments.create(user, documentId, { body, chapterId });
    }
    const comments = await this.comments.list(user, documentId);
    return { created: items.length, comments };
  }

  /**
   * D.2.3: "the student may click 'Suggest for all mechanical' (each still counts against the cap;
   * the UI shows the count before proceeding)". `SUBSTANTIVE` comments are never included — those
   * ask the student to change an argument, and a button that rewrites arguments in bulk is the
   * feature this product exists not to have.
   */
  async suggestAllMechanical(
    user: SessionUser,
    documentId: string,
  ): Promise<{ attempted: number; suggested: number; failures: string[] }> {
    await this.owned(user.id, documentId);
    const mechanical = await this.prisma.comment.findMany({
      where: { documentId, status: 'OPEN', class: 'MECHANICAL', suggestedRevision: null },
      select: { id: true },
    });

    const failures: string[] = [];
    let suggested = 0;
    for (const comment of mechanical) {
      try {
        await this.comments.suggest(user, documentId, comment.id);
        suggested += 1;
      } catch (error) {
        // A cap refusal stops the batch; anything else is one comment's problem.
        const message = error instanceof Error ? error.message : String(error);
        failures.push(message);
        if (message.toLowerCase().includes('cap')) break;
      }
    }
    return { attempted: mechanical.length, suggested, failures };
  }

  /**
   * D.2.4's Accept: snapshot, replace exactly the anchored range, mark the comment, and enqueue a
   * coherence re-run for the chapter (not cap-counted, `triggeredBy: FEEDBACK`).
   */
  async accept(
    user: SessionUser,
    documentId: string,
    commentId: string,
    revisionOverride?: string,
  ): Promise<{ comment: CommentView; chapterId: string; version: number }> {
    await this.owned(user.id, documentId);
    const comment = await this.prisma.comment.findFirst({ where: { id: commentId, documentId } });
    if (!comment) throw new NotFoundError('That comment');
    const revision = (revisionOverride ?? comment.suggestedRevision ?? '').trim();
    if (!revision) throw new ValidationError('There is no revision to apply.');
    // A.14 appends `[[NEEDS INPUT: …]]` when the comment asks for something the thesis does not
    // contain. That is a question for the student, not prose — applying it would write a
    // placeholder into the chapter and call the comment answered.
    NEEDS_INPUT_RE.lastIndex = 0;
    const missing = NEEDS_INPUT_RE.exec(revision);
    if (missing) {
      throw new ValidationError(
        `The suggested revision needs something only you have: ${missing[1]?.trim()}. Write the passage yourself and mark the comment as revised.`,
      );
    }
    if (!comment.chapterId || !comment.quotedText) {
      throw new ValidationError('That comment is not attached to a passage.');
    }

    const chapter = await this.prisma.chapter.findUniqueOrThrow({
      where: { id: comment.chapterId },
      select: { id: true, documentId: true, content: true, version: true },
    });
    const sentences = sentencesOf(chapter.id, chapter.content);
    const match = findAnchor(comment.quotedText, sentences, COMMENT.reanchorSimilarity);
    if (!match) {
      throw new ValidationError(
        'That passage has changed since the comment was written. Edit it yourself and mark the comment as edited.',
      );
    }

    // The previous text, one click away, before anything is replaced.
    await this.snapshots.write({
      documentId: chapter.documentId,
      chapterId: chapter.id,
      content: chapter.content,
      reason: 'PRE_REVISION',
    });

    const content = replaceRange(chapter.content, match.from, match.to, revision);
    const updated = await this.prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: content as never, version: { increment: 1 } },
      select: { version: true },
    });

    const view = await this.comments.resolve(
      user,
      documentId,
      commentId,
      'ACCEPTED',
      'Accepted as suggested',
    );

    // D.2.4: a coherence run after a batch of accepted changes, at no cap cost.
    await this.enqueueCoherence(user.id, documentId);

    return { comment: view, chapterId: chapter.id, version: updated.version };
  }

  /** D.2.4: "Mark review round complete" — a summary to the guide, and a coherence re-run. */
  async completeRound(
    user: SessionUser,
    documentId: string,
  ): Promise<{ counts: Record<string, number>; emailed: string[] }> {
    const document = await this.owned(user.id, documentId);
    const comments = await this.prisma.comment.findMany({
      where: { documentId },
      select: { status: true, authorEmail: true },
    });
    const counts: Record<string, number> = {};
    for (const comment of comments) {
      counts[comment.status] = (counts[comment.status] ?? 0) + 1;
    }

    const shares = await this.prisma.guideShare.findMany({
      where: { documentId },
      select: { guideEmail: true, token: true },
    });
    const emailed: string[] = [];
    for (const share of shares) {
      await this.mailer.send({
        to: [share.guideEmail],
        subject: `Review round complete — “${document.title}”`,
        text: [
          `The student has been through your comments on “${document.title}”.`,
          '',
          `Accepted as suggested: ${counts.ACCEPTED ?? 0}`,
          `Revised in their own words: ${counts.EDITED ?? 0}`,
          `Not changed (with a reason): ${counts.REJECTED ?? 0}`,
          `Still open: ${counts.OPEN ?? 0}`,
          '',
          `${this.env.APP_URL.replace(/\/$/, '')}/guide/${share.token}`,
        ].join('\n'),
      });
      emailed.push(share.guideEmail);
    }

    await this.enqueueCoherence(user.id, documentId);
    return { counts, emailed };
  }

  private async enqueueCoherence(userId: string, documentId: string): Promise<void> {
    const runId = randomUUID();
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { meta: true },
    });
    const meta = (document?.meta as Record<string, unknown> | null) ?? {};
    const runs = (meta.coherenceRuns as Record<string, unknown> | undefined) ?? {};
    // Prisma's JSON input type does not accept `unknown` values; the shape is ours either way.
    const nextRuns = runs as Record<string, never>;
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        meta: {
          ...meta,
          coherenceRuns: {
            ...nextRuns,
            [runId]: {
              runId,
              status: 'RUNNING',
              startedAt: new Date().toISOString(),
              triggeredBy: 'FEEDBACK',
            },
          },
        },
      },
    });
    await this.queue
      .enqueue(
        'coherence',
        { documentId, userId, runId, triggeredBy: 'FEEDBACK' },
        { jobId: jobId('coherence', documentId, runId) },
      )
      .catch((error: unknown) =>
        this.logger.warn({ err: error, documentId }, 'could not enqueue the coherence re-run'),
      );
  }
}

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

/**
 * Replaces the text between two ProseMirror positions with plain text, leaving every node outside
 * the range untouched.
 *
 * This is deliberately narrow: it rewrites the text nodes the range covers and does not merge,
 * split or delete blocks. A revision that spans a paragraph boundary replaces the covered text in
 * each paragraph, which is what "applies the revision to exactly the anchored range" (D.2.4)
 * means when the range is inside one paragraph — the case the anchor search produces.
 */
export function replaceRange(doc: unknown, from: number, to: number, replacement: string): unknown {
  let inserted = false;

  const walk = (node: Node, pos: number): { node: Node; next: number } => {
    if (node.type === 'text') {
      const start = pos;
      const end = pos + (node.text?.length ?? 0);
      if (end <= from || start >= to) return { node, next: end };
      const text = node.text ?? '';
      const head = text.slice(0, Math.max(0, from - start));
      const tail = text.slice(Math.max(0, to - start));
      const body = inserted ? '' : replacement;
      inserted = true;
      return { node: { ...node, text: `${head}${body}${tail}` }, next: end };
    }
    if (node.type === 'citation') return { node, next: pos + 1 };

    let inner = pos + 1;
    const content: Node[] = [];
    for (const child of node.content ?? []) {
      const result = walk(child, inner);
      inner = result.next;
      // A text node emptied by the replacement is dropped: ProseMirror rejects empty text nodes.
      if (result.node.type === 'text' && !result.node.text) continue;
      content.push(result.node);
    }
    return {
      node: node.content ? { ...node, content } : node,
      next: inner + 1,
    };
  };

  const root = (doc ?? {}) as Node;
  let pos = 0;
  const content: Node[] = [];
  for (const child of root.content ?? []) {
    const result = walk(child, pos);
    pos = result.next;
    content.push(result.node);
  }
  return { ...root, content };
}

export type { ChapterSentence };
