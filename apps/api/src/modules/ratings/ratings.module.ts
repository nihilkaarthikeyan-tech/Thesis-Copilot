/**
 * "How was this?" — Jenni build plan R36 (ADR-0115).
 *
 *   PUT /documents/:id/ratings/:kind/:runId    { rating: 1 | -1 | 0, note? }  kind: chapter-build | viva
 *
 * The run's own view (the chapter build, the viva set) returns the rating through
 * `RatingsService.forRun`; the superadmin's list is `GET /admin/feedback/ratings`.
 */

import { Body, Controller, Module, Param, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { oneLine, RATED_KINDS, RATING_NOTE_MAX, RatingsService } from './ratings.service.js';

const rateBody = z.object({
  rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  note: z
    .string()
    .max(RATING_NOTE_MAX * 2)
    .optional()
    .transform((note) => oneLine(note))
    .refine((note) => note === null || note.length <= RATING_NOTE_MAX, {
      message: `Keep it to one line of at most ${RATING_NOTE_MAX} characters.`,
    }),
});

@Controller('documents/:id/ratings')
@UseGuards(SessionGuard)
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Put(':kind/:runId')
  rate(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('kind') kindSlug: string,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    const kind = Object.hasOwn(RATED_KINDS, kindSlug)
      ? RATED_KINDS[kindSlug as keyof typeof RATED_KINDS]
      : null;
    // An unknown kind or a run id that is not an id names nothing of this thesis's.
    if (!kind || !z.string().uuid().safeParse(runId).success) throw new NotFoundError('That run');
    const parsed = rateBody.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Thumbs up, thumbs down, or take it back', parsed.error.issues);
    }
    return this.ratings.rate(
      user.id,
      documentId,
      kind,
      runId,
      parsed.data.rating,
      parsed.data.rating === 0 ? null : parsed.data.note,
    );
  }
}

@Module({
  controllers: [RatingsController],
  providers: [RatingsService, SessionGuard],
  exports: [RatingsService],
})
export class RatingsModule {}
