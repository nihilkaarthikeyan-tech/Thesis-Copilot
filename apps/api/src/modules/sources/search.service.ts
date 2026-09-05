/**
 * Literature search and curation — PRD FR-2.5–2.9, §9.2, PHASES v2 W7.
 *
 * The API starts a run and reads it; the worker does the searching (`search-literature`). The
 * only thing this service writes into the library is what the student selected (FR-2.7:
 * "nothing enters the library automatically"), and it does so through the same resolve → index
 * pipeline every other source takes, so a selected candidate ends up with the same grounding
 * badge, full text and chunks as an uploaded reference.
 */

import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type BibEntry, parseBibliography } from '@tc/retrieval';
import { jobId, jobKeyDigest } from '@tc/types';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { SourcesService } from './sources.service.js';

export type SearchRunView = {
  runId: string;
  mode: 'discover' | 'expand';
  status: 'RUNNING' | 'DONE' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  counts: Record<string, number>;
  queries: Array<{ angle: string; q: string }>;
  themes: Array<{
    name: string;
    thin: boolean;
    candidates: Array<{
      id: string;
      title: string;
      abstract: string | null;
      year: number | null;
      venue: string | null;
      doi: string | null;
      citationCount: number | null;
      isPreprint: boolean;
      oaStatus: string | null;
      score: number | null;
      selected: boolean;
    }>;
  }>;
};

type RunRecord = {
  runId: string;
  mode: 'discover' | 'expand';
  status: 'RUNNING' | 'DONE' | 'FAILED';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  counts?: Record<string, number>;
  queries?: Array<{ angle: string; q: string }>;
};

const THIN_BELOW = 4;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly sources: SourcesService,
  ) {}

  private async ownedDocument(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, meta: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  private runs(meta: unknown): Record<string, RunRecord> {
    return ((meta as { searchRuns?: Record<string, RunRecord> } | null)?.searchRuns ??
      {}) as Record<string, RunRecord>;
  }

  /** `POST /documents/:id/search { mode }` → a run id; the worker fills it in. */
  async start(
    ownerId: string,
    documentId: string,
    mode: 'discover' | 'expand',
  ): Promise<{ runId: string; mode: 'discover' | 'expand' }> {
    const document = await this.ownedDocument(ownerId, documentId);
    if (mode === 'discover') {
      const memory = await this.prisma.documentMemory.findUnique({
        where: { documentId },
        select: { scope: true },
      });
      const scope = memory?.scope as { workingTitle?: string } | null;
      if (!scope?.workingTitle) {
        throw new ValidationError('Save the proposal first; the search starts from it.');
      }
    }
    const runId = randomUUID();
    const record: RunRecord = {
      runId,
      mode,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      counts: {},
    };
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: documentId },
      data: { meta: { ...meta, searchRuns: { ...this.runs(meta), [runId]: record } } },
    });
    await this.queue.enqueue(
      'search-literature',
      { documentId, userId: ownerId, runId, mode },
      { jobId: jobId('search-literature', documentId, runId) },
    );
    return { runId, mode };
  }

  /** The most recent runs, newest first, for the Discover tab's list. */
  async list(ownerId: string, documentId: string): Promise<RunRecord[]> {
    const document = await this.ownedDocument(ownerId, documentId);
    return Object.values(this.runs(document.meta)).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  /** `GET /documents/:id/search/:runId` — candidates grouped by theme, thin themes flagged. */
  async get(ownerId: string, documentId: string, runId: string): Promise<SearchRunView> {
    const document = await this.ownedDocument(ownerId, documentId);
    const record = this.runs(document.meta)[runId];
    if (!record) throw new NotFoundError('That search');

    const rows = await this.prisma.searchCandidate.findMany({
      where: { documentId, runId },
      orderBy: [{ theme: 'asc' }, { score: 'desc' }, { citationCount: 'desc' }],
    });
    const byTheme = new Map<string, SearchRunView['themes'][number]['candidates']>();
    for (const row of rows) {
      const name = row.theme ?? 'Other';
      const list = byTheme.get(name) ?? [];
      list.push({
        id: row.id,
        title: row.title,
        abstract: row.abstract,
        year: row.year,
        venue: row.venue,
        doi: row.doi,
        citationCount: row.citationCount,
        isPreprint: row.isPreprint,
        oaStatus: row.oaStatus,
        score: row.score,
        selected: row.selected,
      });
      byTheme.set(name, list);
    }
    const themes = [...byTheme.entries()]
      .map(([name, candidates]) => ({ name, thin: candidates.length < THIN_BELOW, candidates }))
      .sort((a, b) => b.candidates.length - a.candidates.length);

    return {
      runId: record.runId,
      mode: record.mode,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? null,
      error: record.error ?? null,
      counts: record.counts ?? {},
      queries: record.queries ?? [],
      themes,
    };
  }

  /**
   * `POST /documents/:id/search/:runId/select { candidateIds }` — FR-2.7. Each chosen candidate
   * becomes a `Source` (sub-theme from its theme) and goes through resolution, which fetches full
   * text where it is open and indexes it.
   */
  async select(
    ownerId: string,
    documentId: string,
    runId: string,
    candidateIds: readonly string[],
  ): Promise<{ added: number; alreadyPresent: number; sourceIds: string[] }> {
    await this.ownedDocument(ownerId, documentId);
    const candidates = await this.prisma.searchCandidate.findMany({
      where: { documentId, runId, id: { in: [...candidateIds] } },
    });
    if (candidates.length === 0) throw new NotFoundError('Those candidates');

    const existing = await this.prisma.source.findMany({
      where: { documentId },
      select: { id: true, doi: true, rawReference: true },
    });
    const byDoi = new Map(existing.filter((s) => s.doi).map((s) => [s.doi?.toLowerCase(), s.id]));
    const byRaw = new Map(
      existing.filter((s) => s.rawReference).map((s) => [s.rawReference, s.id]),
    );

    let added = 0;
    let alreadyPresent = 0;
    const sourceIds: string[] = [];
    for (const c of candidates) {
      const raw = referenceLine(c);
      const found = (c.doi && byDoi.get(c.doi.toLowerCase())) || byRaw.get(raw);
      if (found) {
        alreadyPresent++;
        sourceIds.push(found);
        continue;
      }
      const source = await this.prisma.source.create({
        data: {
          documentId,
          status: 'PENDING',
          rawReference: raw,
          doi: c.doi,
          openalexId: c.openalexId,
          title: c.title,
          year: c.year,
          venue: c.venue,
          citationCount: c.citationCount,
          isPreprint: c.isPreprint,
          oaStatus: c.oaStatus,
          subTheme: c.theme,
        },
        select: { id: true },
      });
      sourceIds.push(source.id);
      byRaw.set(raw, source.id);
      if (c.doi) byDoi.set(c.doi.toLowerCase(), source.id);
      await this.queue.enqueue(
        'resolve-reference',
        {
          documentId,
          userId: ownerId,
          rawReference: raw,
          ...(c.doi ? { printedDoi: c.doi } : {}),
        },
        { jobId: jobId('resolve-reference', documentId, jobKeyDigest(raw)) },
      );
      added++;
    }
    await this.prisma.searchCandidate.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { selected: true },
    });
    await this.recordSelection(
      documentId,
      runId,
      candidates.map((c) => c.id),
      sourceIds,
    );
    return { added, alreadyPresent, sourceIds };
  }

  /** Keeps the gap map's `sourceIds` in step with what was selected (FR-2.6 grid). */
  private async recordSelection(
    documentId: string,
    runId: string,
    candidateIds: string[],
    sourceIds: string[],
  ): Promise<void> {
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { gapMap: true },
    });
    const gapMap = memory?.gapMap as {
      runId?: string;
      themes?: Array<{ candidateIds: string[]; sourceIds: string[] }>;
    } | null;
    if (!gapMap || gapMap.runId !== runId || !gapMap.themes) return;
    const sourceByCandidate = new Map(candidateIds.map((c, i) => [c, sourceIds[i] ?? '']));
    for (const theme of gapMap.themes) {
      for (const c of theme.candidateIds) {
        const s = sourceByCandidate.get(c);
        if (s && !theme.sourceIds.includes(s)) theme.sourceIds.push(s);
      }
    }
    await this.prisma.documentMemory.update({
      where: { documentId },
      data: { gapMap: gapMap as never },
    });
  }

  /** FR-2.9: a `.bib` or `.ris` file → the resolve pipeline, one job per entry. */
  async importBibliography(
    ownerId: string,
    documentId: string,
    filename: string,
    bytes: Buffer,
  ): Promise<{ format: string; entries: number; queued: number; alreadyPresent: number }> {
    const parsed = parseBibliography(bytes.toString('utf8'), filename);
    if (!parsed) {
      throw new ValidationError(
        'That file is not BibTeX or RIS. Export from Zotero or Mendeley as .bib or .ris.',
      );
    }
    if (parsed.entries.length === 0) {
      throw new ValidationError('No entries with a title or DOI were found in that file.');
    }
    const result = await this.sources.resolveReferences(
      ownerId,
      documentId,
      parsed.entries.map((e: BibEntry) => ({ raw: e.raw, ...(e.doi ? { doi: e.doi } : {}) })),
    );
    return { format: parsed.format, entries: parsed.entries.length, ...result };
  }
}

/** The reference line a candidate is stored under, so the resolve job can find its row. */
function referenceLine(c: {
  title: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
}): string {
  return [
    c.year ? `(${c.year}).` : '',
    `${c.title}.`,
    c.venue ? `${c.venue}.` : '',
    c.doi ? `https://doi.org/${c.doi}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
