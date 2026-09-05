/**
 * `cross-paper` — PHASES 6.2 (FR-1.6, A.16).
 *
 * A fake Prisma holding two extracted seed papers with a planted overlap and a planted
 * terminology difference; the scripted provider is the same data-derived mock the worker runs
 * with `AI_PROVIDER=mock`. Proves: the pass waits for two papers, stores its flags on the
 * document with the paper map, logs the call, and does not invent a contradiction.
 */

import { mockCrossPaperResponse } from '@tc/ai';
import { emptyExtraction, type PaperExtraction } from '@tc/types';
import { describe, expect, it, vi } from 'vitest';
import { type CrossPaperDeps, runCrossPaper } from '../src/jobs/cross-paper.js';

const p1: PaperExtraction = {
  ...emptyExtraction(),
  title: 'Solar adoption in rural Karnataka',
  findings: [{ claim: 'Upfront cost was the main barrier reported.' }],
  terminology: [{ term: 'Adoption', definition: 'Installing a rooftop unit.' }],
};
const p2: PaperExtraction = {
  ...emptyExtraction(),
  title: 'Rooftop PV uptake in Tamil Nadu',
  findings: [{ claim: 'Upfront cost was the main barrier reported.' }],
  terminology: [{ term: 'adoption', definition: 'Signing a net-metering contract.' }],
};

function fakeDeps(papers: Array<{ id: string; extraction: PaperExtraction | null }>) {
  let meta: Record<string, unknown> | null = { proposalChat: { messages: [] } };
  const calls: Array<Record<string, unknown>> = [];
  const prisma = {
    seedPaper: {
      findMany: vi.fn(async () =>
        papers.map((p) => ({ id: p.id, filename: `${p.id}.pdf`, extraction: p.extraction })),
      ),
    },
    document: {
      findUnique: vi.fn(async () => ({ meta })),
      update: vi.fn(async ({ data }: { data: { meta: Record<string, unknown> } }) => {
        meta = data.meta;
        return { meta };
      }),
    },
    aiCallLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => calls.push(data)),
    },
  };
  const deps: CrossPaperDeps = {
    prisma: prisma as never,
    llm: {
      modelIdFor: () => 'mock-strong',
      stream: () => {
        throw new Error('not used');
      },
      complete: async (request) => ({
        value: request.schema.parse(mockCrossPaperResponse.respond(request)),
        usage: { inputTokens: 900, outputTokens: 120 },
        modelId: 'mock-strong',
      }),
    },
    aiProvider: 'mock',
  };
  return { deps, prisma, calls, meta: () => meta };
}

describe('runCrossPaper', () => {
  it('does nothing with one paper', async () => {
    const { deps, prisma } = fakeDeps([{ id: 'sp-1', extraction: p1 }]);
    const outcome = await runCrossPaper({ documentId: 'doc-1', userId: 'u-1' }, deps);
    expect(outcome).toEqual({ ran: false, reason: 'too-few-papers', papers: 1 });
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('with two papers stores the flags on the document, mapped to the papers, and logs the call', async () => {
    const { deps, calls, meta } = fakeDeps([
      { id: 'sp-1', extraction: p1 },
      { id: 'sp-2', extraction: p2 },
    ]);
    const outcome = await runCrossPaper({ documentId: 'doc-1', userId: 'u-1' }, deps);
    expect(outcome).toEqual({ ran: true, overlaps: 1, contradictions: 0, terminology: 1 });

    const stored = (meta() as { crossPaper: Record<string, unknown> }).crossPaper;
    expect(stored.overlaps).toEqual([
      { claim: 'Upfront cost was the main barrier reported.', papers: ['p1', 'p2'] },
    ]);
    expect(stored.contradictions).toEqual([]);
    expect(stored.papers).toEqual([
      { id: 'p1', seedPaperId: 'sp-1', title: 'Solar adoption in rural Karnataka' },
      { id: 'p2', seedPaperId: 'sp-2', title: 'Rooftop PV uptake in Tamil Nadu' },
    ]);
    // The rest of meta survives the write.
    expect(meta()).toHaveProperty('proposalChat');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      action: 'CROSS_PAPER',
      model: 'mock-strong',
      inputTokens: 900,
      outputTokens: 120,
      costMicroInr: 0n,
      ok: true,
    });
  });

  it('skips a paper whose stored extraction does not validate', async () => {
    const { deps } = fakeDeps([
      { id: 'sp-1', extraction: p1 },
      { id: 'sp-2', extraction: { garbage: true } as never },
    ]);
    expect(await runCrossPaper({ documentId: 'doc-1', userId: 'u-1' }, deps)).toMatchObject({
      ran: false,
      papers: 1,
    });
  });

  it('logs a failed call and rethrows', async () => {
    const { deps, calls } = fakeDeps([
      { id: 'sp-1', extraction: p1 },
      { id: 'sp-2', extraction: p2 },
    ]);
    deps.llm = {
      ...deps.llm,
      complete: async () => {
        throw new Error('provider down');
      },
    };
    await expect(runCrossPaper({ documentId: 'doc-1', userId: 'u-1' }, deps)).rejects.toThrow(
      'provider down',
    );
    expect(calls[0]).toMatchObject({ action: 'CROSS_PAPER', ok: false, error: 'provider down' });
  });
});
