/**
 * Thesis lifecycle — ADR-0043. Persists the state and builds the context the pure machine in
 * `@tc/types` reads; the machine decides what is allowed. The guards read real signals: a guide
 * share, review comments and the same compliance gate `exportThesis` enforces, so "ready to
 * submit" means the same thing here as on the Submit screen.
 */

import { Injectable } from '@nestjs/common';
import {
  applyEvent,
  availableEvents,
  type DocumentLifecycle,
  EVENT_LABEL,
  LIFECYCLE_EVENTS,
  LIFECYCLE_LABEL,
  type LifecycleContext,
  type LifecycleEvent,
} from '@tc/types';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { ThesisExportService } from '../export/thesis-export.service.js';

export type LifecycleView = {
  state: DocumentLifecycle;
  label: string;
  submittedAt: string | null;
  context: LifecycleContext;
  actions: Array<{
    event: LifecycleEvent;
    to: DocumentLifecycle;
    toLabel: string;
    label: string;
    allowed: boolean;
    reason: string | null;
  }>;
};

@Injectable()
export class LifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly thesisExport: ThesisExportService,
  ) {}

  async view(ownerId: string, documentId: string): Promise<LifecycleView> {
    const document = await this.owned(ownerId, documentId);
    const context = await this.context(ownerId, documentId);
    return this.toView(document.lifecycle, document.submittedAt, context);
  }

  async fire(ownerId: string, documentId: string, event: LifecycleEvent): Promise<LifecycleView> {
    if (!LIFECYCLE_EVENTS.includes(event)) throw new ValidationError('Unknown lifecycle action.');
    const document = await this.owned(ownerId, documentId);
    const context = await this.context(ownerId, documentId);
    const result = applyEvent(document.lifecycle, event, context);
    if (!result.ok) throw new ValidationError(result.reason);

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        lifecycle: result.to,
        ...(result.to === 'SUBMITTED' ? { submittedAt: new Date() } : {}),
        // Reopening clears the submission mark.
        ...(result.to === 'DRAFTING' && document.lifecycle === 'SUBMITTED'
          ? { submittedAt: null }
          : {}),
      },
      select: { lifecycle: true, submittedAt: true },
    });
    return this.toView(updated.lifecycle, updated.submittedAt, context);
  }

  private toView(
    state: DocumentLifecycle,
    submittedAt: Date | null,
    context: LifecycleContext,
  ): LifecycleView {
    return {
      state,
      label: LIFECYCLE_LABEL[state],
      submittedAt: submittedAt?.toISOString() ?? null,
      context,
      actions: availableEvents(state, context).map((a) => ({
        ...a,
        toLabel: LIFECYCLE_LABEL[a.to],
      })),
    };
  }

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, lifecycle: true, submittedAt: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /** The signals the guards read, from the database and the compliance checks. */
  private async context(ownerId: string, documentId: string): Promise<LifecycleContext> {
    const [shareCount, commentCount, openCount, compliance] = await Promise.all([
      this.prisma.guideShare.count({ where: { documentId } }),
      this.prisma.comment.count({ where: { documentId } }),
      this.prisma.comment.count({ where: { documentId, status: 'OPEN' } }),
      // Same gate as the Submit screen; if it cannot run (e.g. no chapters yet) treat as failing.
      this.thesisExport.check(ownerId, documentId).then(
        (r) => r.passed,
        () => false,
      ),
    ]);
    return {
      hasShare: shareCount > 0,
      hasComments: commentCount > 0,
      hasOpenComments: openCount > 0,
      compliancePasses: compliance,
    };
  }

  /** For callers that only need the human label of an event. */
  labelFor(event: LifecycleEvent): string {
    return EVENT_LABEL[event];
  }
}
