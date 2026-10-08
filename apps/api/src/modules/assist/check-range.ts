/**
 * A check on one paragraph (Jenni build plan R26, ADR-0126). Proofreading and the tone review read
 * a whole chapter; given a `range` — positions in the saved chapter, the block the student picked
 * from the block handle — they read only the sentences inside it, the rule the examiner's
 * selection review already keeps (ADR-0067): a sentence is in when it overlaps the range.
 *
 * The chapter is still the saved one (the editor saves first), so the positions and the text are
 * the same document. A range holding no sentence of the student's own is refused before any unit.
 */

import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';

export type CheckRange = { from: number; to: number };

export const checkRangeSchema = z
  .object({ from: z.number().int().min(0), to: z.number().int().min(1) })
  .refine((r) => r.to > r.from, { message: 'The range must end after it starts' });

/** The sentences a check reads: all of them, or those overlapping `range`. */
export function sentencesInRange<T extends { from: number; to: number }>(
  sentences: T[],
  range: CheckRange | undefined,
): T[] {
  if (!range) return sentences;
  const inside = sentences.filter((s) => s.from < range.to && s.to > range.from);
  if (inside.length === 0) {
    throw new ValidationError(
      'That paragraph has no saved sentence of your own to check. AI drafts waiting for your decision are not read.',
    );
  }
  return inside;
}
