/**
 * `index-abstract` — ADR-0136. The abstract becomes citable on its own queue, and the full text
 * follows as a second job. Pinned here: the job ids (each keys on what the job reads), the order
 * (abstract stored, then the full text queued), that a paper is citable while its full text is
 * still downloading, and that the full-text job neither embeds the abstract twice nor removes it
 * when there is no full text to replace it with.
 */

import { EMBEDDING_DIMENSIONS, type UnpaywallClient } from '@tc/retrieval';
import { type IndexSourceJob, indexJobId, jobId, jobKeyDigest } from '@tc/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type IndexAbstractDeps, runIndexAbstract } from '../src/jobs/index-abstract.js';
import { type IndexSourceDeps, runIndexSource } from '../src/jobs/index-source.js';
import { INDEX_ABSTRACT_CONCURRENCY, INDEX_SOURCE_CONCURRENCY } from '../src/queues.js';

const ABSTRACT = 'Cost, not awareness, drives non-adoption of rooftop solar in the two districts.';
const DOI = '10.1/aaa';

type Row = {
  id: string;
  documentId: string;
  doi: string | null;
  title: string | null;
  fileKey: string | null;
  cslJson: Record<string, unknown> | null;
  groundingLevel: string;
  status: string;
  rawReference: string | null;
  authors: unknown;
};

/**
 * One in-memory paper both jobs read and write, so a test can run them in the order the queues
 * would and look at what a suggestion could cite in between. Chunks are what `SourceChunk` holds:
 * the raw SQL `replaceSourceChunks` sends is read back as DELETE and INSERT.
 */
function world(over: Partial<Row> = {}) {
  const row: Row = {
    id: 'src-1',
    documentId: 'doc-1',
    doi: DOI,
    title: 'Solar adoption in rural Karnataka',
    fileKey: null,
    cslJson: { abstract: ABSTRACT },
    groundingLevel: 'ABSTRACT',
    status: 'RESOLVED',
    rawReference: '(2021). Solar adoption in rural Karnataka.',
    authors: [],
    ...over,
  };
  const chunks: Array<{ section: unknown; text: unknown }> = [];
  const sql: string[] = [];
  const embedCalls: string[][] = [];
  const logs: Array<Record<string, unknown>> = [];
  let gone = false;

  const prisma = {
    source: {
      findFirst: vi.fn(async () => (gone ? null : { ...row })),
      update: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        Object.assign(row, data);
        return { ...row };
      }),
    },
    sourceChunk: { count: vi.fn(async () => chunks.length) },
    $executeRawUnsafe: vi.fn(async (statement: string, ...values: unknown[]) => {
      sql.push(statement.trim().split(/\s+/)[0] ?? '');
      if (statement.startsWith('DELETE')) chunks.length = 0;
      else chunks.push({ section: values[5], text: values[6] });
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async () => [] as never),
  } as unknown as IndexSourceDeps['prisma'];

  const embeddings = {
    dims: EMBEDDING_DIMENSIONS,
    modelId: 'mock-embed',
    embed: vi.fn(async (texts: readonly string[]) =>
      texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0.01)),
    ),
    async embedWithUsage(texts: readonly string[]) {
      embedCalls.push([...texts]);
      return { vectors: await this.embed(texts), tokens: texts.length * 80 };
    },
  };

  const queued: IndexSourceJob[] = [];
  const abstractDeps: IndexAbstractDeps = {
    prisma,
    embeddings,
    logEmbed: vi.fn(async () => undefined),
    enqueueFullText: vi.fn(async (input: IndexSourceJob) => {
      queued.push(input);
    }),
    log: (event) => logs.push(event),
  };

  return {
    row,
    chunks,
    sql,
    embedCalls,
    logs,
    queued,
    abstractDeps,
    prisma,
    embeddings,
    remove: () => {
      gone = true;
    },
  };
}

const job = (over: Partial<IndexSourceJob> = {}): IndexSourceJob => ({
  sourceId: 'src-1',
  documentId: 'doc-1',
  userId: 'user-1',
  contentKey: DOI,
  ...over,
});

/** The full-text job's deps over the same paper, with the network under the test's control. */
function fullTextDeps(w: ReturnType<typeof world>, unpaywall: UnpaywallClient): IndexSourceDeps {
  return {
    prisma: w.prisma,
    embeddings: w.embeddings,
    unpaywall,
    getObject: vi.fn(async () => Buffer.from('')),
    putObject: vi.fn(async () => undefined),
    extract: vi.fn(async () => ({
      kind: 'pdf' as const,
      text: 'A long passage from the paper. '.repeat(60),
      pages: [{ page: 1, start: 0, end: 1800 }],
      sections: [{ section: 'Introduction', start: 0, end: 1800 }],
      twoColumnPages: [],
      totalPages: 1,
      usedFallback: false,
    })),
    log: (event) => w.logs.push(event),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('job ids (ADR-0136): each keys on what the job reads', () => {
  it('is the source and its content, the same for the same paper, never containing ":"', () => {
    const a = indexJobId('index-abstract', { sourceId: 'src-1', contentKey: '10.1/a:b' });
    expect(a).toBe(indexJobId('index-abstract', { sourceId: 'src-1', contentKey: '10.1/a:b' }));
    expect(a).not.toContain(':');
    // The content changed (a DOI fixed by hand): the paper is read again.
    expect(a).not.toBe(indexJobId('index-abstract', { sourceId: 'src-1', contentKey: '10.1/c' }));
    // Another paper with the same DOI is its own job.
    expect(a).not.toBe(indexJobId('index-abstract', { sourceId: 'src-2', contentKey: '10.1/a:b' }));
  });

  it('keeps the full-text id it always had, and gives the abstract job its own', () => {
    const input = { sourceId: 'src-1', contentKey: DOI };
    expect(indexJobId('index-source', input)).toBe(
      jobId('index-source', 'src-1', jobKeyDigest(DOI)),
    );
    expect(indexJobId('index-abstract', input)).not.toBe(indexJobId('index-source', input));
    expect(indexJobId('index-source', { sourceId: 'src-1' })).toBe(
      jobId('index-source', 'src-1', jobKeyDigest('none')),
    );
  });

  it('gives the light step more slots than the download step, and no more than four', () => {
    expect(INDEX_ABSTRACT_CONCURRENCY).toBeGreaterThan(INDEX_SOURCE_CONCURRENCY);
    expect(INDEX_ABSTRACT_CONCURRENCY).toBeLessThanOrEqual(4);
    expect(INDEX_SOURCE_CONCURRENCY).toBe(2);
  });
});

describe('runIndexAbstract', () => {
  it('stores the abstract in one embedding call, then queues the full text, and fetches nothing', async () => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const w = world();

    const result = await runIndexAbstract(job(), w.abstractDeps);

    expect(result).toMatchObject({ chunks: 1, fullTextQueued: true });
    expect(result.skipped).toBeUndefined();
    expect(w.embedCalls).toEqual([[ABSTRACT]]);
    expect(w.chunks).toEqual([{ section: 'Abstract', text: ABSTRACT }]);
    expect(w.row.groundingLevel).toBe('ABSTRACT');
    expect(network).not.toHaveBeenCalled();
    // The full text is queued once the passage is stored, for the same content, told so.
    expect(w.queued).toEqual([
      {
        sourceId: 'src-1',
        documentId: 'doc-1',
        userId: 'user-1',
        contentKey: DOI,
        abstractStored: true,
      },
    ]);
    expect(w.abstractDeps.logEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, tokens: 80, userId: 'user-1' }),
    );
  });

  it('with no abstract stores nothing and leaves everything to the full-text job', async () => {
    const w = world({ cslJson: null, groundingLevel: 'NONE' });
    const result = await runIndexAbstract(job(), w.abstractDeps);
    expect(result).toMatchObject({ chunks: 0, skipped: 'no-abstract', fullTextQueued: true });
    expect(w.embedCalls).toEqual([]);
    expect(w.queued[0]?.abstractStored).toBeUndefined();
    expect(w.row.groundingLevel).toBe('NONE');
  });

  it('leaves a paper read before to the full-text job, which replaces it as it always has', async () => {
    const w = world();
    w.chunks.push({ section: 'Abstract', text: 'the old record' });
    const result = await runIndexAbstract(job(), w.abstractDeps);
    expect(result.skipped).toBe('already-read');
    expect(w.embedCalls).toEqual([]);
    expect(w.queued[0]?.abstractStored).toBeUndefined();
  });

  it('leaves a paper with a stored PDF to the full-text job, which reads it without a download', async () => {
    const w = world({ fileKey: 'sources/doc-1/mine.pdf' });
    const result = await runIndexAbstract(job(), w.abstractDeps);
    expect(result.skipped).toBe('has-file');
    expect(w.embedCalls).toEqual([]);
    expect(w.queued).toHaveLength(1);
  });

  it('survives a failed embedding: the full text is still queued, without the flag', async () => {
    const w = world();
    w.embeddings.embed.mockRejectedValueOnce(new Error('Voyage embeddings failed: 503'));
    const result = await runIndexAbstract(job(), w.abstractDeps);
    expect(result).toMatchObject({ chunks: 0, skipped: 'failed', fullTextQueued: true });
    expect(w.queued[0]?.abstractStored).toBeUndefined();
    expect(w.abstractDeps.logEmbed).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('queues nothing more for a paper with no DOI and no file: the abstract is all there is', async () => {
    const w = world({ doi: null });
    const result = await runIndexAbstract(job({ contentKey: undefined }), w.abstractDeps);
    expect(result).toMatchObject({ chunks: 1, fullTextQueued: false });
    expect(w.queued).toEqual([]);
  });

  it('does nothing for a paper removed before the job ran', async () => {
    const w = world();
    w.remove();
    const result = await runIndexAbstract(job(), w.abstractDeps);
    expect(result).toMatchObject({ skipped: 'gone', fullTextQueued: false });
    expect(w.queued).toEqual([]);
  });
});

describe('the abstract is citable before the full text arrives', () => {
  it('holds a passage while the PDF is still downloading, which then replaces it', async () => {
    const w = world();
    await runIndexAbstract(job(), w.abstractDeps);
    const next = w.queued[0];
    if (!next) throw new Error('no full-text job was queued');

    // The open-access download hangs until the test lets it through.
    let release: (() => void) | undefined;
    const download = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await download;
        return new Response(new Uint8Array(Buffer.from('%PDF-1.4 pretend')), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        });
      }),
    );
    const unpaywall = {
      bestOpenAccess: vi.fn(async () => ({
        pdfUrl: 'https://repo.example.org/p.pdf',
        landingUrl: null,
        oaStatus: 'green',
        isOa: true,
      })),
    } as unknown as UnpaywallClient;

    const fullText = runIndexSource(next, fullTextDeps(w, unpaywall));
    await vi.waitFor(() => expect(unpaywall.bestOpenAccess).toHaveBeenCalled());

    // Mid-download: the abstract is stored and claimed, and was embedded once.
    expect(w.chunks).toEqual([{ section: 'Abstract', text: ABSTRACT }]);
    expect(w.row.groundingLevel).toBe('ABSTRACT');
    expect(w.embedCalls).toHaveLength(1);

    release?.();
    const result = await fullText;
    expect(result.groundingLevel).toBe('FULL_TEXT');
    expect(w.row.groundingLevel).toBe('FULL_TEXT');
    expect(w.chunks.every((c) => c.section !== 'Abstract')).toBe(true);
    expect(w.chunks.length).toBeGreaterThan(0);
  });

  it('keeps the abstract untouched, and unpaid for twice, when no full text is found', async () => {
    const w = world();
    await runIndexAbstract(job(), w.abstractDeps);
    const next = w.queued[0];
    if (!next) throw new Error('no full-text job was queued');
    const sqlBefore = w.sql.length;
    const unpaywall = {
      bestOpenAccess: vi.fn(async () => null),
    } as unknown as UnpaywallClient;

    const result = await runIndexSource(next, fullTextDeps(w, unpaywall));

    expect(result).toMatchObject({ groundingLevel: 'ABSTRACT', from: 'abstract', chunks: 1 });
    expect(result.fullTextFailure).toBe('no-location');
    expect(w.embedCalls).toHaveLength(1);
    // Not deleted and written again: a suggestion asked during the search still finds it.
    expect(w.sql.length).toBe(sqlBefore);
    expect(w.chunks).toEqual([{ section: 'Abstract', text: ABSTRACT }]);
    // Why there is no full text is still said, for the library's "Fetch PDF".
    expect(w.row).toHaveProperty('fullTextNote');
  });

  it('a full-text job queued another way still makes the abstract citable first (ADR-0070)', async () => {
    const w = world();
    const unpaywall = {
      bestOpenAccess: vi.fn(async () => null),
    } as unknown as UnpaywallClient;
    // Queued by the API (a DOI fixed by hand), with no abstract job before it.
    const result = await runIndexSource(job(), fullTextDeps(w, unpaywall));
    expect(result.groundingLevel).toBe('ABSTRACT');
    expect(w.embedCalls).toEqual([[ABSTRACT]]);
    expect(w.logs.some((e) => e.msg === 'abstract indexed first')).toBe(true);
  });
});
