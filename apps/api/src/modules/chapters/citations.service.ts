/**
 * Rendered citations, the bibliography and the mechanical checks — PRD FR-5.2–5.4, §9.3,
 * PHASES v2 W10.1–W10.3.
 *
 * One place computes labels for the whole document, because a numeric style numbers across
 * chapters: `[7]` is the seventh distinct source as read, so a chapter cannot know its own labels.
 * The order comes from the documents themselves — chapter order, then ProseMirror position — not
 * from the `Citation` rows, which have no position and no order between chapters.
 *
 * The document is never rewritten by any of this. Body text holds keys and ids (FR-5.1); the
 * labels live in the editor's storage and in the export, and a style switch changes only them.
 */

import { Injectable } from '@nestjs/common';
import {
  type BibliographyEntry,
  type CitationFinding,
  citationNodesIn,
  isKnownStyle,
  renderCitations,
  resolveStyle,
  runCitationChecks,
  STYLES,
  type StyleEntry,
} from '@tc/citations';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

export type RenderedCitations = {
  style: string;
  styleLabel: string;
  styleFamily: StyleEntry['family'];
  styles: ReadonlyArray<{ id: string; label: string; family: string; note?: string }>;
  /** `nodeKey` → the label the editor renders. */
  labels: Record<string, string>;
  bibliography: BibliographyEntry[];
  findings: CitationFinding[];
  counts: { citations: number; sources: number; orphans: number; unused: number; untagged: number };
};

@Injectable()
export class CitationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, citationStyle: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /** FR-5.2 + FR-5.4 in one read: the editor needs the labels, the panel needs the rest. */
  async render(ownerId: string, documentId: string): Promise<RenderedCitations> {
    const document = await this.owned(ownerId, documentId);
    const [chapters, sources] = await Promise.all([
      this.prisma.chapter.findMany({
        where: { documentId },
        orderBy: { order: 'asc' },
        select: { id: true, title: true, content: true },
      }),
      this.prisma.source.findMany({
        where: { documentId },
        select: {
          id: true,
          title: true,
          authors: true,
          year: true,
          venue: true,
          doi: true,
          cslJson: true,
          isPreprint: true,
          rawReference: true,
        },
      }),
    ]);

    // Document order: chapters in outline order, citations in ProseMirror position order.
    const ordered = chapters.flatMap((chapter) =>
      citationNodesIn(chapter).map((node) => ({
        key: node.nodeKey,
        sourceId: node.sourceId,
      })),
    );

    // Locators live on the `Citation` rows, not on the node attrs the walker reads.
    const rows = await this.prisma.citation.findMany({
      where: { chapter: { documentId } },
      select: { nodeKey: true, locator: true },
    });
    const locators = new Map(rows.map((r) => [r.nodeKey, r.locator]));

    const rendered = renderCitations({
      style: document.citationStyle,
      sources,
      citations: ordered.map((c) => ({ ...c, locator: locators.get(c.key) ?? null })),
    });

    const findings = runCitationChecks({ chapters, sources });
    const style = resolveStyle(document.citationStyle);

    return {
      style: style.id,
      styleLabel: style.label,
      styleFamily: style.family,
      styles: STYLES.map((s) => ({
        id: s.id,
        label: s.label,
        family: s.family,
        ...(s.note ? { note: s.note } : {}),
      })),
      labels: rendered.labels,
      bibliography: rendered.bibliography,
      findings,
      counts: {
        citations: ordered.length,
        sources: sources.length,
        orphans: findings.filter((f) => f.kind === 'ORPHAN').length,
        unused: findings.filter((f) => f.kind === 'UNUSED').length,
        untagged: findings.filter((f) => f.kind === 'UNTAGGED').length,
      },
    };
  }

  /**
   * FR-5.2: "Style switch is global and instant." Instant because it changes one column and the
   * labels are recomputed from it — no chapter is written, so no autosave, no version bump, and
   * no chance of a switch losing a student's unsaved sentence.
   */
  async setStyle(ownerId: string, documentId: string, style: string): Promise<RenderedCitations> {
    await this.owned(ownerId, documentId);
    if (!isKnownStyle(style)) {
      throw new ValidationError(`Unknown citation style: ${style}`);
    }
    await this.prisma.document.update({
      where: { id: documentId },
      data: { citationStyle: style },
    });
    return this.render(ownerId, documentId);
  }
}
