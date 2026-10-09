/**
 * ADR-0145: the "Set up this thesis" card's one write route, `PUT /documents/:id/setup`.
 *
 * Each row of the card calls it with what that row settles, and it does only what it is given:
 *
 * - `title` renames the thesis and, for a title that names a topic, starts the same paper search
 *   that `POST /documents` starts for a titled thesis (ADR-0070). A thesis made by New is
 *   "Untitled thesis", so nothing searched at creation; this is where its search starts.
 * - `sourcePrefs` is the Sources line's Change, written before the search starts so it is
 *   searched with them.
 * - `field` is `Document.field` (which chapter build and the template suggestion already read);
 *   `universityId` is `meta.universityId`, one of the university profiles, read by chapter build.
 * - the rest is the card's own state on `meta.setup` (`setMetaKey`, so nothing else on `meta`
 *   is lost).
 *
 * No model is called and no allowance is spent here; the search is bounded as it always was
 * (the monthly count of automatic searches, the source settings, the flag).
 */

import { Injectable } from '@nestjs/common';
import { UNIVERSITY_PROFILES } from '@tc/config';
import {
  applySetupUpdate,
  namesATopic,
  readSetupCard,
  type SetupCard,
  setupUpdateSchema,
} from '@tc/types';
import { setMetaKey } from '../../common/document-meta.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { AutoSourcesService } from '../assist/auto-sources.service.js';

export type SetupView = {
  setup: SetupCard;
  title: string;
  field: string | null;
  universityId: string | null;
  /** A paper search was started by this call (or one for this title is already running). */
  searching: boolean;
};

@Injectable()
export class SetupCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autoSources: AutoSourcesService,
  ) {}

  async update(userId: string, documentId: string, body: unknown): Promise<SetupView> {
    const parsed = setupUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Check the setup answers', parsed.error.issues);
    }
    const update = parsed.data;
    if (
      update.universityId != null &&
      !UNIVERSITY_PROFILES.some((u) => u.id === update.universityId)
    ) {
      throw new ValidationError('That university is not one we have a profile for.');
    }
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: userId },
      select: {
        id: true,
        title: true,
        field: true,
        meta: true,
        chapters: { orderBy: { order: 'asc' }, take: 1, select: { id: true } },
      },
    });
    if (!document) throw new NotFoundError('That document');

    if (update.sourcePrefs) {
      await setMetaKey(this.prisma, documentId, 'sourcePrefs', update.sourcePrefs);
    }
    const title = update.title ?? document.title;
    const field = update.field === undefined ? document.field : update.field || null;
    if (update.title !== undefined || update.field !== undefined) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { title, field },
      });
    }
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    let universityId = typeof meta.universityId === 'string' ? meta.universityId : null;
    if (update.universityId !== undefined) {
      universityId = update.universityId || null;
      await setMetaKey(this.prisma, documentId, 'universityId', universityId);
    }

    // ADR-0070, from the card: the search starts the moment the thesis has a title to search on.
    let searching = false;
    const firstChapter = document.chapters[0];
    if (
      update.title !== undefined &&
      update.title !== document.title &&
      firstChapter &&
      namesATopic(update.title)
    ) {
      searching = await this.autoSources
        .start({
          documentId,
          userId,
          chapterId: firstChapter.id,
          query: update.title,
          initial: true,
          named: true,
        })
        .catch(() => false);
    }

    const setup = applySetupUpdate(readSetupCard(meta), update);
    await setMetaKey(this.prisma, documentId, 'setup', setup);
    return { setup, title, field, universityId, searching };
  }
}
