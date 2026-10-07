/**
 * `index-source` — PRD FR-2.2, FR-2.4 and PHASES 1-W2 tasks 2.6 and 2.7.
 *
 * The assertions concentrate on the grounding level, because that badge is a promise to the
 * student about what the AI is allowed to quote from a source. It must be earned by a fetch that
 * actually succeeded, never assumed from the fact that a source resolved.
 */

import { type CoreClient, EMBEDDING_DIMENSIONS, type UnpaywallClient } from '@tc/retrieval';
import type { IndexSourceJob } from '@tc/types';
import { describe, expect, it, vi } from 'vitest';
import {
  arxivPdfUrl,
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
    /** `undefined` means no CORE client at all — the shape of a worker without `CORE_API_KEY`. */
    coreUrl?: string | null;
    coreThrows?: boolean;
    fetchedPdf?: Buffer | 'fail';
    /** URLs the fake network answers 404 for, so one copy can fail while another works. */
    failUrls?: string[];
    extractedText?: string;
    /** Chunks the source already holds from an earlier run. */
    chunksAlready?: number;
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
    sourceChunk: {
      count: vi.fn(async () => (over.chunksAlready ?? 0) + inserted.length),
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

  const core =
    over.coreUrl === undefined && !over.coreThrows
      ? null
      : ({
          fullTextUrl: vi.fn(async () => {
            if (over.coreThrows) throw new Error('core: HTTP 401');
            return over.coreUrl
              ? { pdfUrl: over.coreUrl, coreId: 1, title: null, via: 'downloadUrl' as const }
              : null;
          }),
        } as unknown as CoreClient);

  // The global fetch the full-text fetcher reaches for.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (over.fetchedPdf === 'fail' || over.failUrls?.includes(url)) {
        return new Response('nope', { status: 404 });
      }
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
      // Through `embed`, so a test that overrides or counts `embed` still sees every call.
      async embedWithUsage(texts: readonly string[]) {
        return {
          vectors: await this.embed(texts),
          tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
        };
      },
    },
    logEmbed: vi.fn(async () => undefined),
    unpaywall,
    core,
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

  it('reads an arXiv paper from arXiv itself, which Unpaywall does not list (2026-10-05)', async () => {
    const { deps, source } = fakeDeps({
      oaPdfUrl: null,
      source: { doi: '10.48550/arXiv.1706.03762' },
    });
    const result = await runIndexSource(job(), deps);
    expect(result.groundingLevel).toBe('FULL_TEXT');
    expect(source.groundingLevel).toBe('FULL_TEXT');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('https://arxiv.org/pdf/1706.03762');
    expect(deps.unpaywall.bestOpenAccess).not.toHaveBeenCalled();
  });

  it('names the arXiv PDF only for an arXiv DOI', () => {
    expect(arxivPdfUrl('10.48550/arxiv.1706.03762')).toBe('https://arxiv.org/pdf/1706.03762');
    expect(arxivPdfUrl('10.48550/arXiv.hep-th/9901001')).toBe(
      'https://arxiv.org/pdf/hep-th/9901001',
    );
    expect(arxivPdfUrl('10.1038/nature14539')).toBeNull();
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

describe('the CORE fallback (FR-2.2)', () => {
  it('is asked when Unpaywall lists no PDF, and its copy earns FULL_TEXT', async () => {
    const { deps, logs, stored } = fakeDeps({
      oaPdfUrl: null,
      coreUrl: 'https://core.ac.uk/download/132289095.pdf',
    });

    const result = await runIndexSource(job(), deps);

    expect(result.groundingLevel).toBe('FULL_TEXT');
    expect(result.from).toBe('open-access-pdf');
    expect(result.via).toBe('core');
    expect(stored.size).toBe(1);
    expect(logs.some((entry) => entry.msg === 'full text fetched via core fallback')).toBe(true);
  });

  it('is asked when Unpaywall named a copy that could not be fetched', async () => {
    const { deps } = fakeDeps({
      oaPdfUrl: 'https://publisher.example.com/gone.pdf',
      failUrls: ['https://publisher.example.com/gone.pdf'],
      coreUrl: 'https://core.ac.uk/download/1.pdf',
    });

    const result = await runIndexSource(job(), deps);

    expect(result.groundingLevel).toBe('FULL_TEXT');
    expect(result.via).toBe('core');
  });

  it('is not asked when Unpaywall already delivered', async () => {
    const { deps } = fakeDeps({
      oaPdfUrl: 'https://repo.example.org/p.pdf',
      coreUrl: 'https://core.ac.uk/download/1.pdf',
    });

    const result = await runIndexSource(job(), deps);

    expect(result.via).toBe('unpaywall');
    expect(deps.core?.fullTextUrl).not.toHaveBeenCalled();
  });

  it('is not asked after Unpaywall itself failed to answer either', async () => {
    // Both services answer the same question; a network fault at one is not a reason to skip the
    // other. This is the one case where the fallback runs after a lookup error, not a miss.
    const { deps, logs } = fakeDeps({
      unpaywallThrows: true,
      coreUrl: 'https://core.ac.uk/download/1.pdf',
    });

    const result = await runIndexSource(job(), deps);

    expect(result.groundingLevel).toBe('FULL_TEXT');
    expect(result.via).toBe('core');
    expect(logs.some((entry) => entry.msg === 'unpaywall lookup failed')).toBe(true);
  });

  it('keeps the Unpaywall verdict when CORE has nothing', async () => {
    const { deps } = fakeDeps({
      oaPdfUrl: null,
      coreUrl: null,
      source: { cslJson: { abstract: 'Indexable from the abstract.' } },
    });

    const result = await runIndexSource(job(), deps);

    expect(result.groundingLevel).toBe('ABSTRACT');
    expect(result.fullTextFailure).toBe('no-location');
    expect(result.via).toBeUndefined();
  });

  it('survives CORE refusing the key', async () => {
    const { deps, logs } = fakeDeps({
      oaPdfUrl: null,
      coreThrows: true,
      source: { cslJson: { abstract: 'Indexable from the abstract.' } },
    });

    const result = await runIndexSource(job(), deps);

    expect(result.groundingLevel).toBe('ABSTRACT');
    expect(logs.some((entry) => entry.msg === 'core lookup failed')).toBe(true);
  });

  it("reports the CORE copy's failure when CORE named one and it was not a PDF", async () => {
    const { deps } = fakeDeps({
      oaPdfUrl: null,
      coreUrl: 'https://core.ac.uk/download/gone.pdf',
      failUrls: ['https://core.ac.uk/download/gone.pdf'],
      source: { cslJson: { abstract: 'Indexable from the abstract.' } },
    });

    const result = await runIndexSource(job(), deps);

    expect(result.groundingLevel).toBe('ABSTRACT');
    // A 404 from the named copy is more specific than Unpaywall's "no location".
    expect(result.fullTextFailure).not.toBe('no-location');
  });

  it('is simply absent without a key — nothing changes for a worker that has none', async () => {
    const { deps } = fakeDeps({
      oaPdfUrl: null,
      source: { cslJson: { abstract: 'Indexable from the abstract.' } },
    });
    expect(deps.core).toBe(null);

    const result = await runIndexSource(job(), deps);

    expect(result.groundingLevel).toBe('ABSTRACT');
    expect(result.fullTextFailure).toBe('no-location');
  });
});

describe('the embedding is logged as spend (2026-09-25)', () => {
  it('records one EMBED call for the source with the tokens the provider billed', async () => {
    const { deps } = fakeDeps({ oaPdfUrl: 'https://repo.example.org/p.pdf' });
    const data = job();
    await runIndexSource(data, deps);
    expect(deps.logEmbed).toHaveBeenCalledTimes(1);
    const call = (deps.logEmbed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      userId: string;
      documentId: string;
      tokens: number;
      ok: boolean;
    };
    expect(call.userId).toBe(data.userId);
    expect(call.documentId).toBe(data.documentId);
    expect(call.ok).toBe(true);
    expect(call.tokens).toBeGreaterThan(0);
  });
});

describe('the site-wide AI budget (2026-09-25)', () => {
  it('indexes nothing once the budget is reached, and says why', async () => {
    const { deps, embedCalls, inserted } = fakeDeps({ oaPdfUrl: 'https://repo.example.org/p.pdf' });
    deps.assertBudget = vi.fn(async () => {
      throw new Error("The site's AI budget for this month is reached");
    });
    await expect(runIndexSource(job(), deps)).rejects.toThrow(/budget for this month is reached/);
    expect(embedCalls).toHaveLength(0);
    expect(inserted).toHaveLength(0);
    expect(deps.logEmbed).not.toHaveBeenCalled();
  });
});

describe('Europe PMC full text (ADR-0054)', () => {
  const article = {
    pmcid: 'PMC1',
    text: `${'Moisture fell from 78 to 15 per cent in the dryer. '.repeat(40)}\nTable 1. Drying\nDryer | 52 C | 14 h`,
    sections: [{ section: 'Results', start: 0, end: 2100 }],
    url: 'https://europepmc.org/article/PMC/PMC1',
  };

  it('grounds on the JATS text when the open-access PDF turns out to be a page', async () => {
    const { deps, source, logs } = fakeDeps({
      oaPdfUrl: 'https://publisher.example/p.pdf',
      fetchedPdf: 'fail',
    });
    const fullText = vi.fn(async () => article);
    deps.europePmc = { fullText } as unknown as IndexSourceDeps['europePmc'];

    const result = await runIndexSource(job(), deps);

    expect(fullText).toHaveBeenCalledWith('10.1/aaa', expect.any(AbortSignal));
    expect(result).toMatchObject({
      from: 'open-access-xml',
      via: 'europepmc',
      groundingLevel: 'FULL_TEXT',
    });
    expect(result.fullTextFailure).toBeUndefined();
    expect(source.groundingLevel).toBe('FULL_TEXT');
    // Nothing was downloaded, so nothing is stored or claimed as a file.
    expect(source.fileKey).toBeNull();
    expect(
      logs.some((l) => l.msg === 'full text from europe pmc' && l.pdfFailure === 'not-ok'),
    ).toBe(true);
  });

  it('is not asked when the PDF was read', async () => {
    const { deps } = fakeDeps({ oaPdfUrl: 'https://repo.example.org/p.pdf' });
    const fullText = vi.fn(async () => article);
    deps.europePmc = { fullText } as unknown as IndexSourceDeps['europePmc'];
    expect((await runIndexSource(job(), deps)).from).toBe('open-access-pdf');
    expect(fullText).not.toHaveBeenCalled();
  });

  it('falls back to the abstract when Europe PMC fails, and the job survives', async () => {
    const { deps } = fakeDeps({
      oaPdfUrl: 'https://publisher.example/p.pdf',
      fetchedPdf: 'fail',
      source: { cslJson: { abstract: 'Solar dryers cut drying time by half in coastal trials.' } },
    });
    deps.europePmc = {
      fullText: vi.fn(async () => {
        throw new Error('europepmc: HTTP 503');
      }),
    } as unknown as IndexSourceDeps['europePmc'];
    const result = await runIndexSource(job(), deps);
    expect(result).toMatchObject({
      from: 'abstract',
      groundingLevel: 'ABSTRACT',
      fullTextFailure: 'not-ok',
    });
  });

  describe('abstract first (ADR-0070)', () => {
    const abstract = 'Cost, not awareness, drives non-adoption in the districts studied.';

    it('makes the paper citable from its abstract before looking for the full text', async () => {
      // Resolved with an abstract: the badge already says ABSTRACT, but nothing is stored yet.
      const { deps, source, logs } = fakeDeps({
        source: { cslJson: { abstract }, groundingLevel: 'ABSTRACT' },
        oaPdfUrl: 'https://repo.example.org/p.pdf',
      });
      const levelWhenUnpaywallAsked: string[] = [];
      (deps.unpaywall.bestOpenAccess as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        levelWhenUnpaywallAsked.push(source.groundingLevel);
        return {
          pdfUrl: 'https://repo.example.org/p.pdf',
          landingUrl: null,
          oaStatus: 'green',
          isOa: true,
        };
      });

      const result = await runIndexSource(job(), deps);

      // ABSTRACT was written before the full-text search began; FULL_TEXT replaced it after.
      expect(levelWhenUnpaywallAsked).toEqual(['ABSTRACT']);
      expect(logs.some((l) => l.msg === 'abstract indexed first')).toBe(true);
      expect(result.groundingLevel).toBe('FULL_TEXT');
      expect(source.groundingLevel).toBe('FULL_TEXT');
      // Two embedding rows, both logged: the abstract, then the full text.
      expect(deps.logEmbed).toHaveBeenCalledTimes(2);
    });

    it('does not embed the abstract twice when no full text is found', async () => {
      const { deps, source, embedCalls } = fakeDeps({ source: { cslJson: { abstract } } });

      const result = await runIndexSource(job(), deps);

      expect(result).toMatchObject({ from: 'abstract', groundingLevel: 'ABSTRACT' });
      expect(source.groundingLevel).toBe('ABSTRACT');
      expect(embedCalls).toHaveLength(1);
      expect(deps.logEmbed).toHaveBeenCalledTimes(1);
    });

    it('leaves a paper that was already read alone until the full text is in hand', async () => {
      const { deps, logs } = fakeDeps({
        source: { cslJson: { abstract }, groundingLevel: 'ABSTRACT' },
        chunksAlready: 3,
        oaPdfUrl: 'https://repo.example.org/p.pdf',
      });

      await runIndexSource(job(), deps);

      expect(logs.some((l) => l.msg === 'abstract indexed first')).toBe(false);
      expect(deps.logEmbed).toHaveBeenCalledTimes(1);
    });
  });
});

describe('an uploaded PDF names itself from its first page (Jenni build plan R20)', () => {
  const NOTE = `Night-time heat exposure of street vendors in
Chennai: a field note
A. Test Author, Department of Urban Studies (test document for software evaluation, 2026)
Abstract
This short field note is a synthetic test document. It describes a hypothetical survey of 40 street vendors in
two Chennai neighbourhoods and their sleep quality during hot nights in May. It is written only to test how
reference software reads an uploaded PDF and must not be cited.
1. Introduction
Night-time temperatures in coastal South Indian cities stay high during the pre-monsoon months. `.repeat(
    3,
  );

  const upload = {
    doi: null,
    title: 'upload-check',
    fileKey: 'sources/doc-1/src-1.pdf',
    status: 'PENDING',
    rawReference: null,
    authors: null,
  } as unknown as Partial<SourceRow>;

  it('takes the title, the byline with its initial, the year and the abstract', async () => {
    const { deps, source } = fakeDeps({ source: upload, extractedText: NOTE });
    await runIndexSource(job(), deps);
    const row = source as unknown as Record<string, unknown>;
    expect(row.status).toBe('RESOLVED');
    expect(row.title).toBe('Night-time heat exposure of street vendors in Chennai: a field note');
    expect(row.authors).toEqual([{ family: 'Author', given: 'A. Test' }]);
    expect(row.year).toBe(2026);
    expect((row.cslJson as { abstract?: string }).abstract).toMatch(/^This short field note/);
  });

  it('prefers the record of a DOI printed on the page', async () => {
    const { deps, source } = fakeDeps({
      source: upload,
      extractedText: `Journal of Things\nDOI: 10.1000/xyz\n${NOTE}`,
    });
    deps.resolveDoi = vi.fn(async () => ({
      doi: '10.1000/xyz',
      openalexId: null,
      title: 'The Real Title From Crossref',
      authors: [{ family: 'Kumar', given: 'Asha' }],
      year: 2024,
      venue: 'Energy Policy',
      type: 'journal-article',
      cslJson: { type: 'article-journal' },
      oaStatus: null,
      citationCount: 3,
      isPreprint: false,
      isRetracted: false,
      abstract: null,
      score: 1,
      via: 'crossref' as const,
    }));
    await runIndexSource(job(), deps);
    const row = source as unknown as Record<string, unknown>;
    expect(deps.resolveDoi).toHaveBeenCalledWith('10.1000/xyz', expect.anything());
    expect(row).toMatchObject({
      status: 'RESOLVED',
      doi: '10.1000/xyz',
      title: 'The Real Title From Crossref',
      venue: 'Energy Policy',
    });
    // The abstract the page carried is kept when the record has none.
    expect((row.cslJson as { abstract?: string }).abstract).toMatch(/^This short field note/);
  });

  it('a page with nothing readable needs a hand, not "still looking up" for ever', async () => {
    const { deps, source } = fakeDeps({
      source: upload,
      extractedText: 'lorem ipsum '.repeat(200),
    });
    await runIndexSource(job(), deps);
    expect((source as unknown as Record<string, unknown>).status).toBe('UNRESOLVED');
  });
});
