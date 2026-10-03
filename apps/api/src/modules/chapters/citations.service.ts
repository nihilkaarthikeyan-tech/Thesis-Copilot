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
  notesIn,
  type ReferenceHealthFinding,
  referenceHealthHeadline,
  renderCitations,
  resolveStyle,
  runCitationChecks,
  runReferenceHealth,
  STYLES,
  type StyleEntry,
} from '@tc/citations';
import { withoutPendingDrafts } from '@tc/export';
import { shortReference } from '@tc/retrieval';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { type ReadingDepth, readingDepth } from './reading-depth.js';
import { StyleStoreService } from './style-store.service.js';

/** The most sources the `@` citation picker offers at once. */
const PICKER_MAX = 50;

export type RenderedCitations = {
  style: string;
  styleLabel: string;
  styleFamily: StyleEntry['family'];
  styles: ReadonlyArray<{ id: string; label: string; family: string; note?: string }>;
  /** `nodeKey` → the label the editor renders; in a note style, the note's text. */
  labels: Record<string, string>;
  /** ADR-0029: citations are footnotes — the editor shows a note number, exports write notes. */
  noteStyle: boolean;
  bibliography: BibliographyEntry[];
  /** Sources a citation points at that are no longer in the library: the editor draws them red. */
  missingSourceIds: string[];
  findings: CitationFinding[];
  counts: { citations: number; sources: number; orphans: number; unused: number; untagged: number };
};

export type RenderOptions = {
  /**
   * Render in this style instead of the document's, without writing it to the document — the
   * whole-thesis export renders in the template's style, and before ADR-0045 it did so by
   * switching the thesis to that style for good.
   */
  style?: string;
  /**
   * Leave out citations inside pending draft blocks. The export strips those blocks, so counting
   * their citations gave the exported bibliography sources the thesis does not cite and left gaps
   * in a numeric style's numbers.
   */
  excludePendingDrafts?: boolean;
};

@Injectable()
export class CitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly styleStore: StyleStoreService,
  ) {}

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, citationStyle: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /** FR-5.2 + FR-5.4 in one read: the editor needs the labels, the panel needs the rest. */
  async render(
    ownerId: string,
    documentId: string,
    options: RenderOptions = {},
  ): Promise<RenderedCitations> {
    const document = await this.owned(ownerId, documentId);
    const styleId =
      options.style && isKnownStyle(options.style) ? options.style : document.citationStyle;
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

    // Document order: chapters in outline order, citations in ProseMirror position order. Each
    // carries the footnote it would be in a note style, counted through the thesis with the
    // student's own footnotes (ADR-0029) — an in-text style ignores it.
    let notesBefore = 0;
    const walked = options.excludePendingDrafts
      ? chapters.map((chapter) => ({ ...chapter, content: withoutPendingDrafts(chapter.content) }))
      : chapters;
    const ordered = walked.flatMap((chapter) => {
      const nodes = citationNodesIn(chapter).map((node) => ({
        key: node.nodeKey,
        sourceId: node.sourceId,
        noteIndex: notesBefore + node.noteOrdinal,
        // The node's own attributes: the role the student chose (FR-5.6), the page, the affixes.
        role: node.role,
        locator: node.locator,
        prefix: node.prefix,
        suffix: node.suffix,
      }));
      notesBefore += notesIn(chapter);
      return nodes;
    });

    // A locator set through the Citations tab lives on the `Citation` row until the next save
    // copies it to the node; the row wins while the two differ.
    const rows = await this.prisma.citation.findMany({
      where: { chapter: { documentId } },
      select: { nodeKey: true, locator: true },
    });
    const locators = new Map(rows.map((r) => [r.nodeKey, r.locator]));

    // A catalogue style's XML must be in this process before citeproc can use it (style-store).
    await this.styleStore.ensure(resolveStyle(styleId).id);
    const rendered = renderCitations({
      style: styleId,
      sources,
      citations: ordered.map((c) => ({ ...c, locator: locators.get(c.key) ?? c.locator ?? null })),
    });

    const findings = runCitationChecks({ chapters, sources });
    const style = resolveStyle(styleId);

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
      noteStyle: rendered.noteStyle,
      bibliography: rendered.bibliography,
      missingSourceIds: rendered.missingSourceIds,
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
   * How much of what this thesis cites has actually been read — see `reading-depth.ts`.
   *
   * Separate from `render` rather than folded into it: `render` runs on every chapter open and on
   * every style switch, and this needs each source's grounding level and a document-wide citation
   * count that the label pass does not otherwise collect.
   */
  async readingDepth(ownerId: string, documentId: string): Promise<ReadingDepth> {
    await this.owned(ownerId, documentId);
    const [chapters, sources] = await Promise.all([
      this.prisma.chapter.findMany({
        where: { documentId },
        orderBy: { order: 'asc' },
        select: { id: true, title: true, content: true },
      }),
      this.prisma.source.findMany({
        where: { documentId },
        select: { id: true, title: true, authors: true, year: true, groundingLevel: true },
      }),
    ]);

    // Counted from the documents, not from the `Citation` rows: the nodes in the prose are what a
    // reader sees, and a row can outlive the node that made it.
    const counts = new Map<string, number>();
    for (const chapter of chapters) {
      for (const node of citationNodesIn(chapter)) {
        counts.set(node.sourceId, (counts.get(node.sourceId) ?? 0) + 1);
      }
    }

    return readingDepth(
      sources.map((source) => ({
        sourceId: source.id,
        shortRef: shortReference(source.authors, source.year, source.title) ?? 'Source',
        title: source.title,
        groundingLevel: source.groundingLevel,
        citeCount: counts.get(source.id) ?? 0,
      })),
    );
  }

  /**
   * Whether the references themselves are any good — retracted, stale, duplicated, unverified.
   *
   * A sibling to `runCitationChecks`, not a replacement: that one asks whether the text and the
   * library agree, this one asks whether the library is worth agreeing with. Pure logic over rows
   * the indexer already wrote, so it costs nothing and needs no cap.
   */
  async referenceHealth(
    ownerId: string,
    documentId: string,
  ): Promise<{ findings: ReferenceHealthFinding[]; headline: string | null; sources: number }> {
    await this.owned(ownerId, documentId);
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
          doi: true,
          year: true,
          status: true,
          isPreprint: true,
          isRetracted: true,
          authors: true,
          venue: true,
        },
      }),
    ]);

    const counts = new Map<string, number>();
    for (const chapter of chapters) {
      for (const node of citationNodesIn(chapter)) {
        counts.set(node.sourceId, (counts.get(node.sourceId) ?? 0) + 1);
      }
    }

    const findings = runReferenceHealth(
      sources.map((source) => ({
        id: source.id,
        title: source.title,
        doi: source.doi,
        year: source.year,
        status: source.status,
        isPreprint: source.isPreprint,
        isRetracted: source.isRetracted,
        shortRef: shortReference(source.authors, source.year, source.title) ?? 'Source',
        citeCount: counts.get(source.id) ?? 0,
        venue: source.venue,
      })),
    );

    return { findings, headline: referenceHealthHeadline(findings), sources: sources.length };
  }

  /**
   * The library as a citable list, each entry with the label it would render as.
   *
   * For the editor's `@` picker (2026-09-21). Until it existed, a citation could only be inserted
   * by accepting an automatic end-of-sentence suggestion — so a student who wanted to cite
   * something *deliberately*, mid-sentence, had no way to ask, and the only route into the
   * bibliography was one the model opened.
   *
   * The label has to be computed here rather than in the browser. In a numeric style
   * ("[1]", "[2]") a citation's label is its position in the document, so it is not a property of
   * the source at all — the browser has neither the other citations nor the CSL engine. The label
   * this returns is what the new citation would read as *if appended last*; every other label
   * settles when `render` next runs over the saved document, which the editor already does.
   */
  async pickable(
    ownerId: string,
    documentId: string,
    query?: string,
  ): Promise<{
    style: string;
    /** The style numbers its citations: `label` is the short reference, not a number. */
    numeric: boolean;
    sources: Array<{
      sourceId: string;
      shortRef: string;
      label: string;
      title: string | null;
      year: number | null;
    }>;
  }> {
    const document = await this.owned(ownerId, documentId);
    const sources = await this.prisma.source.findMany({
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
      orderBy: [{ year: 'desc' }, { title: 'asc' }],
    });

    const needle = query?.trim().toLowerCase() ?? '';
    // A picker shows a short list; rendering every source in a large library on each keystroke
    // (an empty query matched them all) cost one CSL pass per row (2026-09-28).
    const matched = needle
      ? sources.filter((source) => {
          const authors = Array.isArray(source.authors)
            ? source.authors
                .map((a) => {
                  const author = a as { family?: string; literal?: string } | null;
                  return `${author?.family ?? ''} ${author?.literal ?? ''}`;
                })
                .join(' ')
            : '';
          return `${source.title ?? ''} ${authors} ${source.year ?? ''}`
            .toLowerCase()
            .includes(needle);
        })
      : sources;
    const matches = matched.slice(0, PICKER_MAX);

    // One render per candidate would be one CSL engine run per keystroke. Instead every candidate
    // is rendered in a single pass, each as its own citation, and the labels are read off by key.
    // A numeric style is not rendered here at all: the label it would give is the candidate's
    // place in this list ("[1]", "[2]"…), not in the thesis, and the picker seeded that wrong
    // number into the editor (ADR-0045). The picker shows the short reference instead, and the
    // real number arrives with the first render after the node is saved.
    const style = resolveStyle(document.citationStyle);
    const numeric = style.family === 'numeric';
    await this.styleStore.ensure(style.id);
    const probes = matches.map((source, index) => ({ key: `pick-${index}`, sourceId: source.id }));
    const rendered = numeric
      ? null
      : renderCitations({
          style: document.citationStyle,
          sources: matches,
          citations: probes.map((p) => ({ ...p, locator: null })),
        });

    return {
      style: document.citationStyle,
      numeric,
      sources: matches.map((source, index) => {
        const shortRef = shortReference(source.authors, source.year, source.title) ?? 'Source';
        return {
          sourceId: source.id,
          shortRef,
          label: rendered?.labels[`pick-${index}`] ?? shortRef,
          title: source.title,
          year: source.year,
        };
      }),
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
    // Fetched and stored *before* the switch is saved: if the download fails, the thesis keeps
    // the style it had, and the student is told, rather than being left on a style that cannot
    // render.
    await this.styleStore.ensure(style);
    await this.prisma.document.update({
      where: { id: documentId },
      data: { citationStyle: style },
    });
    return this.render(ownerId, documentId);
  }
}
