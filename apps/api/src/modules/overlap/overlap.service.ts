/**
 * Overlap check — ADR-0042. A read-only report of where a draft passage runs near-verbatim to the
 * text of a source the thesis holds, so the student quotes it or rewrites it in their own words.
 *
 * It is the opposite of detector evasion (PRD §12.3): it points at copied text and never touches
 * it. No model, no provider call, no metered unit — the comparison is word-shingling over source
 * passages already in the library. Owner-scoped like everything else.
 */

import { Injectable } from '@nestjs/common';
import { type OverlapReport, overlapReport, shortReference } from '@tc/retrieval';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

/** How much source text to compare against; a thesis's library of passages is bounded but large. */
const MAX_CHUNKS = 4_000;
const MAX_PASSAGE_CHARS = 20_000;

@Injectable()
export class OverlapService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reports overlap between `passage` and the document's own source passages. When `sourceIds` is
   * given, only those sources are compared (e.g. the ones a sentence cites); otherwise the whole
   * library is.
   */
  async check(
    ownerId: string,
    documentId: string,
    passage: string,
    sourceIds?: readonly string[],
  ): Promise<OverlapReport & { comparedSources: number; comparedPassages: number }> {
    const text = passage.trim();
    if (!text) throw new ValidationError('Nothing to check: the passage is empty.');
    if (text.length > MAX_PASSAGE_CHARS) {
      throw new ValidationError('That passage is too long to check in one request.');
    }

    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');

    const sources = await this.prisma.source.findMany({
      where: {
        documentId,
        ...(sourceIds && sourceIds.length > 0 ? { id: { in: [...sourceIds] } } : {}),
      },
      select: { id: true, authors: true, year: true, title: true },
    });
    const labelOf = new Map(
      sources.map((s) => [s.id, shortReference(s.authors, s.year, s.title) ?? 'a source']),
    );

    const chunks = await this.prisma.sourceChunk.findMany({
      where: {
        source: { documentId, ...(labelOf.size > 0 ? { id: { in: [...labelOf.keys()] } } : {}) },
      },
      select: { sourceId: true, text: true },
      take: MAX_CHUNKS,
    });

    const report = overlapReport(
      text,
      chunks.map((c) => ({
        sourceId: c.sourceId,
        label: labelOf.get(c.sourceId) ?? 'a source',
        text: c.text,
      })),
    );
    return {
      ...report,
      comparedSources: new Set(chunks.map((c) => c.sourceId)).size,
      comparedPassages: chunks.length,
    };
  }
}
