/**
 * `extract-paper` — PHASES 1-W2 task 2.3.
 *
 * Drives the job with a fake Prisma, a scripted provider and an in-memory object store, so the
 * whole path is exercised without containers: read bytes, extract text, run A.5, store the result,
 * seed the glossary, create sources, enqueue resolution.
 */

import { type ExtractPaperJob, emptyExtraction, type PaperExtraction } from '@tc/types';
import { describe, expect, it, vi } from 'vitest';
import {
  type ExtractPaperDeps,
  readableReason,
  runExtractPaper,
} from '../src/jobs/extract-paper.js';
import { buildPdf, singleColumnPage } from './_pdf-fixture.js';

const extraction: PaperExtraction = {
  ...emptyExtraction(),
  title: 'Solar adoption in rural Karnataka',
  abstract: 'We survey 312 households.',
  terminology: [
    { term: 'Adoption', definition: 'Installing a rooftop unit.' },
    {
      term: 'Barrier',
      definition: 'A reason a household did not install.',
      usageNote: 'Cost, not awareness.',
    },
  ],
  references: [
    { raw: '[1] Kumar, A. (2021). Solar adoption. Energy Policy.', doi: '10.1/aaa' },
    { raw: '[2] Rao, B. (2019). Wind siting. Renewable Energy.' },
  ],
};

const paperPdf = () =>
  buildPdf([
    singleColumnPage([
      'Solar adoption in rural Karnataka',
      'Abstract',
      'We survey 312 households across three districts and report the leading barrier.',
      'References',
      '[1] Kumar, A. (2021). Solar adoption. Energy Policy.',
    ]),
  ]);

type SeedPaperRow = {
  id: string;
  documentId: string;
  fileKey: string;
  filename: string;
  status: string;
  error: string | null;
  extraction: unknown;
};

function fakeDeps(over: Partial<ExtractPaperDeps> = {}) {
  const seedPaper: SeedPaperRow = {
    id: 'sp-1',
    documentId: 'doc-1',
    fileKey: 'seed-papers/doc-1/sp-1.pdf',
    filename: 'p01.pdf',
    status: 'PENDING',
    error: null,
    extraction: null,
  };
  const sources: Array<{ documentId: string; rawReference: string | null; doi?: string }> = [];
  let glossary: Record<string, unknown> = {};
  const resolves: Array<{ rawReference: string; printedDoi?: string }> = [];

  const prisma = {
    seedPaper: {
      findUnique: vi.fn(async () => ({ ...seedPaper })),
      update: vi.fn(async ({ data }: { data: Partial<SeedPaperRow> }) => {
        Object.assign(seedPaper, data);
        return { ...seedPaper };
      }),
    },
    documentMemory: {
      findUnique: vi.fn(async () => ({ glossary })),
      update: vi.fn(async ({ data }: { data: { glossary: Record<string, unknown> } }) => {
        glossary = data.glossary;
        return { glossary };
      }),
    },
    source: {
      findMany: vi.fn(async () => sources.map((s) => ({ rawReference: s.rawReference }))),
      create: vi.fn(
        async ({ data }: { data: { documentId: string; rawReference: string; doi?: string } }) => {
          sources.push(data);
          return data;
        },
      ),
    },
  };

  const deps: ExtractPaperDeps = {
    prisma: prisma as never,
    llm: {
      modelIdFor: () => 'mock-strong',
      stream: () => {
        throw new Error('not used');
      },
      complete: async (request) => ({
        value: request.schema.parse(extraction),
        usage: { inputTokens: 100, outputTokens: 50 },
        modelId: 'mock-strong',
      }),
    },
    getObject: async () => Buffer.from(paperPdf()),
    enqueueResolve: async (input) => {
      resolves.push({
        rawReference: input.rawReference,
        ...(input.printedDoi ? { printedDoi: input.printedDoi } : {}),
      });
    },
    ...over,
  };

  return { deps, prisma, seedPaper, sources, resolves, glossary: () => glossary };
}

const job: ExtractPaperJob = { seedPaperId: 'sp-1', documentId: 'doc-1', userId: 'u-1' };

describe('runExtractPaper', () => {
  it('reads the file, runs A.5 and stores the extraction', async () => {
    const { deps, seedPaper } = fakeDeps();
    const result = await runExtractPaper(job, deps);

    expect(result.title).toBe('Solar adoption in rural Karnataka');
    expect(result.references).toBe(2);
    expect(result.pages).toBe(1);
    expect(seedPaper.status).toBe('DONE');
    expect(seedPaper.error).toBeNull();
    expect((seedPaper.extraction as PaperExtraction).title).toBe(
      'Solar adoption in rural Karnataka',
    );
  });

  it('marks the row EXTRACTING before the model call', async () => {
    const { deps, prisma } = fakeDeps();
    await runExtractPaper(job, deps);
    const statuses = prisma.seedPaper.update.mock.calls.map(
      (c) => (c[0] as { data: { status?: string } }).data.status,
    );
    expect(statuses[0]).toBe('EXTRACTING');
    expect(statuses.at(-1)).toBe('DONE');
  });

  it('seeds the glossary from the paper terminology (FR-3.5)', async () => {
    const { deps, glossary } = fakeDeps();
    await runExtractPaper(job, deps);

    expect(Object.keys(glossary())).toEqual(['Adoption', 'Barrier']);
    expect(glossary().Barrier).toEqual({
      definition: 'A reason a household did not install.',
      usageNote: 'Cost, not awareness.',
    });
  });

  it('never overwrites a glossary entry the student already has', async () => {
    const { deps, prisma, glossary } = fakeDeps();
    prisma.documentMemory.findUnique.mockResolvedValueOnce({
      glossary: { Adoption: { definition: 'The student wrote this.' } },
    } as never);

    await runExtractPaper(job, deps);
    expect((glossary().Adoption as { definition: string }).definition).toBe(
      'The student wrote this.',
    );
    expect(glossary().Barrier).toBeDefined();
  });

  it('creates one source per reference and enqueues resolution (FR-2.1)', async () => {
    const { deps, sources, resolves } = fakeDeps();
    const result = await runExtractPaper(job, deps);

    expect(result.queuedResolutions).toBe(2);
    expect(sources.map((s) => s.rawReference)).toEqual([
      '[1] Kumar, A. (2021). Solar adoption. Energy Policy.',
      '[2] Rao, B. (2019). Wind siting. Renewable Energy.',
    ]);
    // A DOI printed in the entry is passed along so resolution can skip the search.
    expect(resolves[0]?.printedDoi).toBe('10.1/aaa');
    expect(resolves[1]?.printedDoi).toBeUndefined();
  });

  it('does not duplicate sources on a re-run', async () => {
    const { deps, prisma, sources } = fakeDeps();
    prisma.source.findMany.mockResolvedValueOnce([
      { rawReference: '[1] Kumar, A. (2021). Solar adoption. Energy Policy.' },
    ] as never);

    const result = await runExtractPaper(job, deps);
    expect(result.queuedResolutions).toBe(1);
    expect(sources).toHaveLength(1);
  });

  it('records a readable reason and marks FAILED when the file has no text', async () => {
    const { deps, seedPaper } = fakeDeps({
      getObject: async () => Buffer.from(buildPdf([{ items: [] }])),
    });

    await expect(runExtractPaper(job, deps)).rejects.toThrow(/no text could be read/i);
    expect(seedPaper.status).toBe('FAILED');
    expect(seedPaper.error).toMatch(/scan.*OCR/i);
  });

  it('records a readable reason when the model cannot be parsed', async () => {
    const { deps, seedPaper } = fakeDeps({
      llm: {
        modelIdFor: () => 'mock-strong',
        stream: () => {
          throw new Error('not used');
        },
        complete: async () => {
          throw new Error('AI_NoObjectGeneratedError');
        },
      },
    });

    await expect(runExtractPaper(job, deps)).rejects.toThrow();
    expect(seedPaper.status).toBe('FAILED');
    expect(seedPaper.error).toContain('could not be summarised');
  });

  it('fails loudly when the seed paper row has gone', async () => {
    const { deps, prisma } = fakeDeps();
    prisma.seedPaper.findUnique.mockResolvedValueOnce(null as never);
    await expect(runExtractPaper(job, deps)).rejects.toThrow(/no longer exists/);
  });
});

describe('readableReason', () => {
  it.each([
    ['PDF is password-protected', /password/i],
    ['Invalid PDF structure at xref', /re-exporting/i],
    ['Extraction failed for part 1 of 2', /could not be summarised/i],
  ])('turns %s into something actionable', (message, expected) => {
    expect(readableReason(new Error(message))).toMatch(expected);
  });

  it('truncates anything unrecognised rather than leaking a stack', () => {
    const reason = readableReason(new Error('x'.repeat(1000)));
    expect(reason.length).toBeLessThanOrEqual(300);
  });
});
