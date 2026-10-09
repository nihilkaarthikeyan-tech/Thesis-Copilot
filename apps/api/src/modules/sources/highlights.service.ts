/**
 * Highlights and notes on a paper in the reader (2026-10-09, ADR-0130).
 *
 * A student selects a passage in the reader, marks it in one of four colours and may write a short
 * note on it. The highlight is theirs alone: every query is scoped by the paper's thesis owner (the
 * reader is owner-only, like the rest of the library) **and** by the student, and anything else is
 * reported as absent (404), never as forbidden.
 *
 * No model reads a highlight or a note and nothing is metered: the rows are stored and handed back
 * to the reader, and they reach the chat or the thesis only when the student presses "Put in chat"
 * or "Put in my chapter" (flag, don't fix).
 *
 * Erased with the paper (FK cascade), with the thesis (`DocumentEraser.deleteRows`) and with the
 * account (`DeletionService.erase`, by user, which also catches any on a thesis since moved).
 */

import { Injectable } from '@nestjs/common';
import {
  READER_HIGHLIGHTS_PER_SOURCE_MAX,
  type ReaderHighlight,
  type ReaderHighlightColour,
  type ReaderHighlightCreate,
  type ReaderHighlightUpdate,
} from '@tc/types';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

type Row = {
  id: string;
  sourceId: string;
  view: string;
  page: number | null;
  chunkId: string | null;
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
  quote: string;
  colour: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const SELECT = {
  id: true,
  sourceId: true,
  view: true,
  page: true,
  chunkId: true,
  start: true,
  end: true,
  exact: true,
  prefix: true,
  suffix: true,
  quote: true,
  colour: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** An empty or all-space note is no note. */
export function cleanNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toView(row: Row): ReaderHighlight {
  return {
    ...row,
    view: row.view === 'TEXT' ? 'TEXT' : 'PDF',
    colour: row.colour as ReaderHighlightColour,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class HighlightsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ownedSource(userId: string, sourceId: string): Promise<void> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, document: { ownerId: userId } },
      select: { id: true },
    });
    if (!source) throw new NotFoundError('That source');
  }

  private async owned(userId: string, highlightId: string): Promise<{ id: string }> {
    const row = await this.prisma.sourceHighlight.findFirst({
      where: { id: highlightId, userId, source: { document: { ownerId: userId } } },
      select: { id: true },
    });
    if (!row) throw new NotFoundError('That highlight');
    return row;
  }

  /** The student's highlights on this paper, in reading order. */
  async list(userId: string, sourceId: string): Promise<ReaderHighlight[]> {
    await this.ownedSource(userId, sourceId);
    const rows = await this.prisma.sourceHighlight.findMany({
      where: { sourceId, userId },
      select: SELECT,
      orderBy: [{ page: { sort: 'asc', nulls: 'last' } }, { start: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toView);
  }

  async create(
    userId: string,
    sourceId: string,
    input: ReaderHighlightCreate,
  ): Promise<ReaderHighlight> {
    await this.ownedSource(userId, sourceId);
    const count = await this.prisma.sourceHighlight.count({ where: { sourceId, userId } });
    if (count >= READER_HIGHLIGHTS_PER_SOURCE_MAX) {
      throw new ConflictError(
        `This paper already has ${READER_HIGHLIGHTS_PER_SOURCE_MAX} highlights. Delete some before adding more.`,
        { reason: 'HIGHLIGHTS_FULL' },
      );
    }
    const row = await this.prisma.sourceHighlight.create({
      data: {
        sourceId,
        userId,
        view: input.view,
        page: input.page,
        chunkId: input.chunkId,
        start: input.start,
        end: input.end,
        exact: input.exact,
        prefix: input.prefix,
        suffix: input.suffix,
        quote: input.quote,
        colour: input.colour,
        note: cleanNote(input.note),
      },
      select: SELECT,
    });
    return toView(row);
  }

  async update(
    userId: string,
    highlightId: string,
    input: ReaderHighlightUpdate,
  ): Promise<ReaderHighlight> {
    await this.owned(userId, highlightId);
    const row = await this.prisma.sourceHighlight.update({
      where: { id: highlightId },
      data: {
        ...(input.colour !== undefined ? { colour: input.colour } : {}),
        ...(input.note !== undefined ? { note: cleanNote(input.note) } : {}),
      },
      select: SELECT,
    });
    return toView(row);
  }

  async remove(userId: string, highlightId: string): Promise<{ removed: true }> {
    await this.owned(userId, highlightId);
    await this.prisma.sourceHighlight.delete({ where: { id: highlightId } });
    return { removed: true };
  }
}
