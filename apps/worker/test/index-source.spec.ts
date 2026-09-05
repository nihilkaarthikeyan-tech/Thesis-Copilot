/**
 * `index-source` — PRD FR-2.2, FR-2.4 and PHASES 1-W2 tasks 2.6 and 2.7.
 *
 * The assertions concentrate on the grounding level, because that badge is a promise to the
 * student about what the AI is allowed to quote from a source. It must be earned by a fetch that
 * actually succeeded, never assumed from the fact that a source resolved.
 */

import { EMBEDDING_DIMENSIONS, type UnpaywallClient } from '@tc/retrieval';
import type { IndexSourceJob } from '@tc/types';
import { describe, expect, it, vi } from 'vitest';
import {
  EMBED_BATCH,
  type IndexSourceDeps,
  openAccessKey,
  runIndexSource,
} from '../src/jobs/index-source.js';

const PDF = Buffer.from('%PDF-1.4 pretend');

type SourceRow = {
  id: string;
  documentId: string;
  doi: string | null;
  title: string | null;
  fileKey: string | null;
  cslJson: Record<string, unknown> | null;
  groundingLevel: string;
};

const embedding = () => new Array(EMBEDDING_DIMENSIONS).fill(0.01);

function fakeDeps(
  over: {
    source?: Partial<SourceRow> | null;
    oaPdfUrl?: string | null;
    unpaywallThrows?: boolean;
    fetchedPdf?: Buffer | 'fail';
    extractedText?: string;
  } = {},
) {
  const source: SourceRow = {
    id: 'src-1',
    documentId: 'doc-1',
    doi: '10.1/aaa',
    title: 'Solar adoption in rural Karnataka',
    fileKey: null,
    cslJson: null,
    groundingLevel: 'NONE',
    ...(over.source ?? {}),
  };

  const inserted: Array<{ sql: string; values: unknown[] }> = [];
  const stored = new Map<string, Buffer>();
  const logs: Array<Record<string, unknown>> = [];
  const embedCalls: string[][] = [];

  const prisma = {
    source: {
      findFirst: vi.fn(async () => (over.source === null ? null : { ...source })),
      update: vi.fn(async ({ data }: { data: Partial<SourceRow> }) => {
        Object.assign(source, data);
        return { ...source };
      }),
    },
    $executeRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
      inserted.push({ sql, values });
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async () => [] as never),
  } as unknown as IndexSourceDeps['prisma'];

  const unpaywall = {
    bestOpenAccess: vi.fn(async () => {
      if (over.unpaywallThrows) throw new Error('unpaywall: HTTP 422');
      return over.oaPdfUrl === undefined
        ? null
        : { pdfUrl: over.oaPdfUrl, landingUrl: null, oaStatus: 'green', isOa: true };
    }),
  } as unknown as UnpaywallClient;

  // The global fetch the full-text fetcher reaches for.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (over.fetchedPdf === 'fail') return new Response('nope', { status: 404 });
      return new Response(new Uint8Array(over.fetchedPdf ?? PDF), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }),
  );

  const deps: IndexSourceDeps = {
    prisma,
    embeddings: {
      dims: EMBEDDING_DIMENSIONS,
      modelId: 'mock-embed',
      embed: vi.fn(async (texts: readonly string[]) => {
        embedCalls.push([...texts]);
        return texts.map(() => embedding());
      }),
    },
    unpaywall,
    getObject: vi.fn(async (key: string) => stored.get(key) ?? PDF),
    putObject: vi.fn(async (key: string, body: Buffer) => {
      stored.set(key, body);
      return undefined;
    }),
    extract: vi.fn(async () => ({
      kind: 'pdf' as const,
      text: over.extractedText ?? 'A long passage from the paper. '.repeat(60),
      pages: [{ page: 1, start: 0, end: 1800 }],
      sections: [{ section: 'Introduction', start: 0, end: 1800 }],
      twoColumnPages: [],
      totalPages: 1,
      usedFallback: false,
    })),
    log: (event) => logs.push(event),
  };

  return { deps, source, inserted, stored, logs, embedCalls };
}

const job = (over: Partial<IndexSourceJob> = {}): IndexSourceJob => ({
  sourceId: 'src-1',
  documentId: 'doc-1',
  userId: 'user-1',
  ...over,
});

describe('runIndexSource', () => {
  it('fetches the open-access PDF, stores it and claims FULL_TEXT', async () => {
    const { deps, source, stored } = fakeDeps({ oaPdfUrl: 'https://repo.example.org/p.pdf' });

    const result = await runIndexSource(job(), deps);

    expect(result.from).toBe('open-access-pdf');
    expect(result.groundingLevel).toBe('FULL_TEXT');
    expect(result.chunks).toBeGreaterThan(0);
    expect(source.groundingLevel).toBe('FULL_TEXT');
    // The PDF is kept, so the viewer can open it and a re-index needs no second download.
    expect(stored.has(openAccessKey('doc-1', 'src-1'))).toBe(true);
    expect(source.fileKey).toBe(openAccessKey('doc-1', 'src-1'));
  });

  it('reads a PDF the student uploaded without asking Unpaywall at all', async () => {
    const { deps, source } = fakeDeps({ source: { fileKey: 'sources/doc-1/mine.pdf' } });

    const result = await runIndexSource(job(), deps);

    expect(result.from).toBe('stored-pdf');
    expect(result.groundingLevel).toBe('FULL_TEXT');
    expect(deps.unpaywall.bestOpenAccess).not.toHaveBeenCalled();
    // A file the student supplied is not overwritten with one we found.
    expect(source.fileKey).toBe('sources/doc-1/mine.pdf');
  });

  it('falls back to the abstract when no open-access copy exists', async () => {
    const { deps, source } = fakeDeps({
      oaPdfUrl: null,
      source: {
        cslJson: { abstract: 'Cost, not awareness, drives non-adoption in the districts.' },
      },
    });

    const result = await runIndexSource(job(), deps);

    expect(result.from).toBe('abstract');
    expect(result.groundingLevel).toBe('ABSTRACT');
    expect(source.groundingLevel).toBe('ABSTRACT');
    expect(result.fullTextFailure).toBe('no-location');
  });

  it('claims nothing when there is neither full text nor an abstract', async () => {
    const { deps, source } = fakeDeps({ oaPdfUrl: null });

    const result = await runIndexSource(job(), deps);

    expect(result.groundingLevel).toBe('NONE');
    expect(result.chunks).toBe(0);
    expect(source.groundingLevel).toBe('NONE');
  });

  it('does not claim full text for a scanned PDF with no text layer', async () => {
    const { deps, stored } = fakeDeps({
      oaPdfUrl: 'https://repo.example.org/scan.pdf',
      extractedText: '   ',
      source: { cslJson: { abstract: 'A readable abstract at least.' } },
    });

    const result = await runIndexSource(job(), deps);

    // Nothing quotable came out of it, so it is neither stored nor counted as full text.
    expect(result.groundingLevel).toBe('ABSTRACT');
    expect(stored.size).toBe(0);
  });

  it('survives Unpaywall refusing the request', async () => {
    const { deps, logs } = fakeDeps({
      unpaywallThrows: true,
      source: { cslJson: { abstract: 'Still indexable from the abstract.' } },
    });

    const result = await runIndexSource(job(), deps);

    expect(result.groundingLevel).toBe('ABSTRACT');
    expect(logs.some((entry) => entry.msg === 'unpaywall lookup failed')).toBe(true);
  });

  it('clears the previous chunks before writing new ones', async () => {
    const { deps, inserted } = fakeDeps({ oaPdfUrl: 'https://repo.example.org/p.pdf' });
    await runIndexSource(job(), deps);
    expect(inserted[0]?.sql).toContain('DELETE FROM "SourceChunk"');
  });

  it('embeds in batches of 64', async () => {
    const { deps, embedCalls } = fakeDeps({
      oaPdfUrl: 'https://repo.example.org/p.pdf',
      // Long enough to produce more than one batch of chunks.
      extractedText: 'A sentence about rooftop solar adoption in the surveyed districts. '.repeat(
        1_400,
      ),
    });

    const result = await runIndexSource(job(), deps);

    expect(result.chunks).toBeGreaterThan(EMBED_BATCH);
    expect(embedCalls.length).toBeGreaterThan(1);
    for (const call of embedCalls) expect(call.length).toBeLessThanOrEqual(EMBED_BATCH);
  });

  it('does nothing when the source was removed before the job ran', async () => {
    const { deps, inserted } = fakeDeps({ source: null });
    const result = await runIndexSource(job(), deps);
    expect(result.chunks).toBe(0);
    expect(inserted).toEqual([]);
  });

  it('refuses to write when the provider returns the wrong number of vectors', async () => {
    const { deps } = fakeDeps({ oaPdfUrl: 'https://repo.example.org/p.pdf' });
    deps.embeddings.embed = vi.fn(async () => [embedding()]);
    // Silently writing fewer chunks than were embedded would corrupt every later retrieval.
    await expect(runIndexSource(job(), deps)).rejects.toThrow(/does not match/);
  });
});
