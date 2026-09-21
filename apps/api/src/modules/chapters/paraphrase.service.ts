/**
 * The accidental-paraphrase check, over one chapter (2026-09-21).
 *
 * Reads the chapter's sentences and the document's indexed source chunks, and reports where the
 * student has reused somebody's phrasing without citing them. `@tc/retrieval`'s `findParaphrases`
 * does the judging; this supplies the two sides and the short references.
 *
 * ## Not metered, on purpose
 *
 * §11 requires every *AI* action to be capped, and this is not one: no model is called and no
 * embedding is computed. It is string comparison over rows the indexer has already written. That
 * is not an oversight to be corrected later — it is why the feature can run on every chapter
 * without a budget, and why the Voyage rate limit cannot throttle it.
 *
 * ## Not a gate
 *
 * Nothing here blocks an export or refuses anything, and it never edits the chapter. PRD §12.3
 * bans detector-evasion tooling; the distinction that keeps this on the right side of that line
 * is that its only possible advice is *add attribution* (`adviceFor`). It has no rewrite button
 * and will not be given one.
 */

import { Injectable, Logger } from '@nestjs/common';
import { citationNodesIn } from '@tc/citations';
import {
  type ChunkForMatch,
  findParaphrases,
  type ParaphraseMatch,
  sentencesOf,
  shortReference,
} from '@tc/retrieval';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

export type ParaphraseReport = {
  chapterId: string;
  checked: number;
  matches: ParaphraseMatch[];
  headline: string | null;
};

@Injectable()
export class ParaphraseService {
  private readonly logger = new Logger(ParaphraseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(ownerId: string, chapterId: string): Promise<ParaphraseReport> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: { id: true, title: true, content: true, documentId: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    // `sentencesOf` marks a sentence as cited when a citation node sits inside its range, which is
    // what stops a properly quoted passage being reported for ever.
    const citationPositions = citationNodesIn({
      id: chapter.id,
      title: chapter.title,
      content: chapter.content,
    }).map((node) => node.from);
    const sentences = sentencesOf(chapter.id, chapter.content, citationPositions);

    const chunks = await this.prisma.sourceChunk.findMany({
      where: { source: { documentId: chapter.documentId } },
      select: {
        id: true,
        sourceId: true,
        text: true,
        page: true,
        source: { select: { title: true, authors: true, year: true } },
      },
    });

    const forMatch: ChunkForMatch[] = chunks.map((chunk) => ({
      chunkId: chunk.id,
      sourceId: chunk.sourceId,
      shortRef:
        shortReference(chunk.source.authors, chunk.source.year, chunk.source.title) ?? 'a source',
      page: chunk.page,
      text: chunk.text,
    }));

    const matches = findParaphrases(sentences, forMatch);
    this.logger.log(
      { chapterId, sentences: sentences.length, chunks: forMatch.length, matches: matches.length },
      'paraphrase check',
    );

    return {
      chapterId,
      checked: sentences.length,
      matches,
      headline: headlineFor(matches),
    };
  }
}

/** Silent when there is nothing to report — the same restraint the reading-depth warning uses. */
function headlineFor(matches: readonly ParaphraseMatch[]): string | null {
  if (matches.length === 0) return null;
  const verbatim = matches.filter((m) => m.kind === 'verbatim').length;
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

  if (verbatim > 0) {
    return (
      `${plural(verbatim, 'sentence')} reuse${verbatim === 1 ? 's' : ''} a source's exact wording ` +
      'without quoting it. Put those words in quotation marks and cite the page, or write them ' +
      'in your own.'
    );
  }
  return (
    `${plural(matches.length, 'sentence')} closely follow${matches.length === 1 ? 's' : ''} a ` +
    'source you have not cited there. Add the citation.'
  );
}
