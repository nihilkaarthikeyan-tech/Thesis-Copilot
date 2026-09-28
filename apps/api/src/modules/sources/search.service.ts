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
import { FlagsService } from '../flags/flags.service.js';
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
  /** Set when the `livingGapMap` flag is on: when the stored map was last recomputed. */
  refreshedAt?: string;
  themes: Array<{
    name: string;
    thin: boolean;
    /**
     * How many of this theme's papers the student actually kept. Only present when the
     * `livingGapMap` flag is on — without it `thin` is the run's own result count and nothing
     * moves as the library is curated (FR-2.6).
     */
    libraryCount?: number;
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
/** Searches shown in the run switcher, newest first. Older runs stay stored. */
const SEARCH_RUNS_LISTED = 20;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly sources: SourcesService,
    private readonly flags: FlagsService,
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
    // Every run stays in the document's history; the switcher shows the recent ones (2026-09-28).
    return Object.values(this.runs(document.meta))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, SEARCH_RUNS_LISTED);
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

    // FR-2.6, "living" half: `refreshGapMap` recomputes `thin` from what is in the library rather
    // than from what the run returned. That record is in `DocumentMemory.gapMap`, and this is the
    // only screen that shows it — without this merge the flag changes nothing anyone can see.
    const living = await this.livingThemes(documentId, runId);

    return {
      ...(living?.refreshedAt ? { refreshedAt: living.refreshedAt } : {}),
      runId: record.runId,
      mode: record.mode,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? null,
      error: record.error ?? null,
      counts: record.counts ?? {},
      queries: record.queries ?? [],
      themes: living
        ? themes.map((theme) => {
            const stored = living.byName.get(theme.name);
            return stored
              ? { ...theme, libraryCount: stored.libraryCount, thin: stored.thin }
              : theme;
          })
        : themes,
    };
  }

  /** The stored gap map for this run, when the flag is on and it was written by this run. */
  private async livingThemes(
    documentId: string,
    runId: string,
  ): Promise<{
    refreshedAt?: string;
    byName: Map<string, { libraryCount: number; thin: boolean }>;
  } | null> {
    if (!(await this.flags.isEnabled('livingGapMap'))) return null;
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { gapMap: true },
    });
    const gapMap = memory?.gapMap as {
      runId?: string;
      refreshedAt?: string;
      themes?: Array<{ name?: unknown; libraryCount?: unknown; thin?: unknown }>;
    } | null;
    if (!gapMap?.themes || gapMap.runId !== runId) return null;
    const byName = new Map<string, { libraryCount: number; thin: boolean }>();
    for (const theme of gapMap.themes) {
      if (typeof theme.name !== 'string' || typeof theme.libraryCount !== 'number') continue;
      byName.set(theme.name, { libraryCount: theme.libraryCount, thin: Boolean(theme.thin) });
    }
    if (byName.size === 0) return null;
    return { ...(gapMap.refreshedAt ? { refreshedAt: gapMap.refreshedAt } : {}), byName };
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
    await this.refreshGapMap(documentId);
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

  /**
   * FR-9.7's `livingGapMap`: recompute the gap map against the library as it stands.
   *
   * Not a new search — that would be a Strong call every time a source is added. The themes came
   * from the run; what changes as the student curates is how many of each theme they actually
   * kept, and that is the number worth watching: a theme that looked well covered in the results
   * is thin in the library if only one paper was selected from it.
   */
  async refreshGapMap(documentId: string): Promise<void> {
    if (!(await this.flags.isEnabled('livingGapMap'))) return;
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { gapMap: true },
    });
    const gapMap = memory?.gapMap as {
      runId?: string;
      themes?: Array<Record<string, unknown>>;
    } | null;
    if (!gapMap?.themes) return;

    const sources = await this.prisma.source.findMany({
      where: { documentId },
      select: { id: true, subTheme: true },
    });
    const byTheme = new Map<string, string[]>();
    for (const source of sources) {
      const theme = source.subTheme ?? 'Other';
      byTheme.set(theme, [...(byTheme.get(theme) ?? []), source.id]);
    }

    const themes = gapMap.themes.map((theme) => {
      const name = String(theme.name ?? '');
      const inLibrary = byTheme.get(name) ?? [];
      return {
        ...theme,
        sourceIds: inLibrary,
        /** Candidates found by the run — unchanged. */
        count: theme.count,
        /** What the student actually has, which is what "thin" should mean once curating starts. */
        libraryCount: inLibrary.length,
        thin: inLibrary.length > 0 ? inLibrary.length < THIN_BELOW : Boolean(theme.thin),
      };
    });

    await this.prisma.documentMemory.update({
      where: { documentId },
      data: { gapMap: { ...gapMap, themes, refreshedAt: new Date().toISOString() } as never },
    });
  }

  /** FR-2.9: a `.bib` or `.ris` file → the resolve pipeline, one job per entry. */
  async importBibliography(
    ownerId: string,
    documentId: string,
    filename: string,
    bytes: Buffer,
  ): Promise<{
    format: string;
    entries: number;
    /** Records in the file that had neither a title nor a DOI, so nothing could resolve them. */
    skipped: number;
    queued: number;
    alreadyPresent: number;
  }> {
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
    return {
      format: parsed.format,
      entries: parsed.entries.length,
      skipped: parsed.skipped,
      ...result,
    };
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
