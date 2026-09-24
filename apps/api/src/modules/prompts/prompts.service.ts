/**
 * Saved prompts — ADR-0019.
 *
 * A question the student asks often, kept so that typing `/` in chat brings it back. The body is
 * the student's own words and reaches the model exactly as if typed: through `/chat`, metered,
 * grounded and refused the same way. Nothing here calls a provider, so nothing here is metered.
 *
 * Every query is scoped by `userId`, and a prompt that belongs to someone else is reported as
 * absent (PRD §12.1) — the same rule as every document route.
 */

import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

/** The same bound as a chat message: a saved prompt has to fit in the box it is sent from. */
export const PROMPT_LIMITS = { maxPrompts: 50, maxTitle: 80, maxBody: 2_000 } as const;

export type SavedPromptView = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
};

export class PromptLimitError extends AppError {
  constructor() {
    super(
      'PROMPT_LIMIT',
      'Too many saved prompts',
      HttpStatus.UNPROCESSABLE_ENTITY,
      `You can keep up to ${PROMPT_LIMITS.maxPrompts} saved prompts. Delete one you no longer use, then save this one.`,
      { max: PROMPT_LIMITS.maxPrompts },
    );
  }
}

const VIEW = { id: true, title: true, body: true, updatedAt: true } as const;

function toView(row: {
  id: string;
  title: string;
  body: string;
  updatedAt: Date;
}): SavedPromptView {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Alphabetical: the student finds a prompt by its name, and a name does not move around. */
  async list(userId: string): Promise<SavedPromptView[]> {
    const rows = await this.prisma.savedPrompt.findMany({
      where: { userId },
      select: VIEW,
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toView);
  }

  async create(userId: string, input: { title: string; body: string }): Promise<SavedPromptView> {
    // The count and the insert in one transaction. Two tabs saving at once can still both pass the
    // count — the limit is a tidiness bound, not a cost one, and one prompt over it harms nothing.
    const row = await this.prisma.$transaction(async (tx) => {
      const count = await tx.savedPrompt.count({ where: { userId } });
      if (count >= PROMPT_LIMITS.maxPrompts) throw new PromptLimitError();
      return tx.savedPrompt.create({
        data: { userId, title: input.title, body: input.body },
        select: VIEW,
      });
    });
    return toView(row);
  }

  async update(
    userId: string,
    id: string,
    input: { title?: string; body?: string },
  ): Promise<SavedPromptView> {
    const updated = await this.prisma.savedPrompt.updateMany({
      where: { id, userId },
      data: input,
    });
    if (updated.count === 0) throw new NotFoundError('Saved prompt');
    const row = await this.prisma.savedPrompt.findFirst({ where: { id, userId }, select: VIEW });
    if (!row) throw new NotFoundError('Saved prompt');
    return toView(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.prisma.savedPrompt.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw new NotFoundError('Saved prompt');
  }
}
