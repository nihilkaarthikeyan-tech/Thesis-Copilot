/**
 * Saving (ADR-0069), against a fake Thesis Copilot. Pinned: a DOI already in the library is
 * "already there" and not sent; the rest go ten at a time through resolve, and the ids it answers
 * become "Open in Thesis Copilot"; a failed batch fails only its own papers; 401 stops the save;
 * the collection gets everything saved or already there; the tab's PDF is attached to the saved
 * paper, uploaded as the entry when nothing else names the paper, and a PDF that cannot be
 * fetched still leaves the paper saved by its DOI.
 */

import { describe, expect, it } from 'vitest';
import type { LibraryRow } from '../src/api.js';
import type { Failure, Reply, SaveJob } from '../src/messages.js';
import type { Paper } from '../src/paper.js';
import { RESOLVE_BATCH, runSave, type SaveDeps } from '../src/save.js';

const DOC = '0190a3c4-0000-7000-8000-000000000001';
const COLLECTION = '0190a3c4-0000-7000-8000-0000000000c1';
const id = (n: number) => `0190a3c4-0000-7000-8000-${String(n).padStart(12, '0')}`;

const paper = (n: number, doi: string | null = `10.1000/p${n}`): Paper => ({
  title: `Paper ${n}`,
  doi,
  reference: `Author (2020). Paper ${n}.`,
});

function fake(options: {
  library?: LibraryRow[];
  resolve?: (
    refs: Array<{ raw: string; doi?: string }>,
    call: number,
  ) => Reply<{ sourceIds: Array<string | null> }>;
  pdf?: { ok: true; file: Blob } | { ok: false; message: string };
  upload?: Reply<{ id: string }>;
  attach?: Reply<{ id: string }>;
  collection?: Reply<unknown>;
  libraryReply?: Failure;
}) {
  const calls = {
    resolve: [] as Array<Array<{ raw: string; doi?: string }>>,
    collection: [] as string[][],
    upload: 0,
    attach: [] as string[],
    fetched: 0,
  };
  let next = 100;
  const deps: SaveDeps = {
    api: {
      library: async () => options.libraryReply ?? { ok: true, value: options.library ?? [] },
      resolve: async (_doc, refs) => {
        calls.resolve.push(refs);
        return (
          options.resolve?.(refs, calls.resolve.length) ?? {
            ok: true,
            value: { sourceIds: refs.map(() => id(next++)) },
          }
        );
      },
      addToCollection: async (_c, ids) => {
        calls.collection.push(ids);
        return options.collection ?? { ok: true, value: {} };
      },
      uploadPdf: async () => {
        calls.upload++;
        return options.upload ?? { ok: true, value: { id: id(900) } };
      },
      attachPdf: async (sourceId) => {
        calls.attach.push(sourceId);
        return options.attach ?? { ok: true, value: { id: sourceId } };
      },
    },
    fetchPdf: async () => {
      calls.fetched++;
      return options.pdf ?? { ok: true, file: new Blob(['%PDF-1.7']) };
    },
  };
  return { deps, calls };
}

const job = (items: Paper[], extra: Partial<SaveJob> = {}): SaveJob => ({
  runId: 'r',
  documentId: DOC,
  collectionId: null,
  items: items.map((p, i) => ({ key: p.doi ?? `k${i}`, paper: p })),
  pdf: null,
  ...extra,
});

describe('saving papers', () => {
  it('skips what the library already has, by DOI whatever its case', async () => {
    const { deps, calls } = fake({ library: [{ id: id(1), doi: '10.1000/P1', hasFile: false }] });
    const result = await runSave(job([paper(1), paper(2)]), deps);
    expect(result.results).toEqual([
      { key: '10.1000/p1', status: 'present', sourceId: id(1) },
      { key: '10.1000/p2', status: 'saved', sourceId: id(100) },
    ]);
    expect(calls.resolve).toEqual([[{ raw: 'Author (2020). Paper 2.', doi: '10.1000/p2' }]]);
  });

  it('sends ten at a time and reports progress after each batch', async () => {
    const { deps, calls } = fake({});
    const seen: number[] = [];
    const items = Array.from({ length: 23 }, (_, i) => paper(i));
    const result = await runSave(job(items), deps, (r) => seen.push(r.length));
    expect(calls.resolve.map((b) => b.length)).toEqual([RESOLVE_BATCH, RESOLVE_BATCH, 3]);
    expect(seen).toEqual([0, 10, 20, 23, 23]);
    expect(result.results.every((r) => r.status === 'saved')).toBe(true);
  });

  it('a failed batch fails only its own papers', async () => {
    const { deps } = fake({
      resolve: (refs, call) =>
        call === 1
          ? { ok: false, status: 429, message: 'Too many requests' }
          : { ok: true, value: { sourceIds: refs.map((_, i) => id(i + 1)) } },
    });
    const result = await runSave(job(Array.from({ length: 12 }, (_, i) => paper(i))), deps);
    expect(
      result.results
        .slice(0, 10)
        .every((r) => r.status === 'failed' && r.message === 'Too many requests'),
    ).toBe(true);
    expect(result.results.slice(10).every((r) => r.status === 'saved')).toBe(true);
    expect(result.signedOut).toBe(false);
  });

  it('stops at 401 and says the student is signed out', async () => {
    const { deps, calls } = fake({
      resolve: () => ({ ok: false, status: 401, message: 'signed out' }),
    });
    const result = await runSave(job(Array.from({ length: 25 }, (_, i) => paper(i))), deps);
    expect(calls.resolve).toHaveLength(1);
    expect(result.signedOut).toBe(true);
    expect(result.results.every((r) => r.status === 'failed')).toBe(true);

    const early = fake({ libraryReply: { ok: false, status: 401, message: 'signed out' } });
    expect((await runSave(job([paper(1)]), early.deps)).signedOut).toBe(true);
  });

  it('the same paper twice on a page is sent once and both rows get its result', async () => {
    const { deps, calls } = fake({});
    const twice = job([paper(1)]);
    twice.items.push({ key: 'again', paper: paper(1) });
    const result = await runSave(twice, deps);
    expect(calls.resolve.flat()).toHaveLength(1);
    expect(result.results.map((r) => [r.key, r.status, r.sourceId])).toEqual([
      ['10.1000/p1', 'saved', id(100)],
      ['again', 'saved', id(100)],
    ]);
  });

  it('files everything saved or already there into the chosen collection', async () => {
    const { deps, calls } = fake({ library: [{ id: id(1), doi: '10.1000/p1', hasFile: false }] });
    const result = await runSave(job([paper(1), paper(2)], { collectionId: COLLECTION }), deps);
    expect(calls.collection).toEqual([[id(1), id(100)]]);
    expect(result.collection).toBe('added');
    const failing = fake({ collection: { ok: false, status: 404, message: 'gone' } });
    expect(
      (await runSave(job([paper(3)], { collectionId: COLLECTION }), failing.deps)).collection,
    ).toBe('failed');
  });
});

describe('the tab’s PDF', () => {
  const pdf = {
    url: 'https://arxiv.org/pdf/1706.03762',
    filename: '1706.03762.pdf',
    onlyThePdf: false,
  };

  it('is attached to the paper just saved by its DOI', async () => {
    const { deps, calls } = fake({});
    const result = await runSave(job([paper(1)], { pdf }), deps);
    expect(result.results[0]).toMatchObject({ status: 'saved', sourceId: id(100) });
    expect(calls.attach).toEqual([id(100)]);
    expect(result.pdf).toEqual({ kind: 'attached' });
  });

  it('is attached to a paper already in the library without one, and not fetched when it has one', async () => {
    const without = fake({ library: [{ id: id(1), doi: '10.1000/p1', hasFile: false }] });
    expect((await runSave(job([paper(1)], { pdf }), without.deps)).pdf).toEqual({
      kind: 'attached',
    });
    expect(without.calls.attach).toEqual([id(1)]);

    const withFile = fake({ library: [{ id: id(1), doi: '10.1000/p1', hasFile: true }] });
    expect((await runSave(job([paper(1)], { pdf }), withFile.deps)).pdf).toEqual({
      kind: 'already-has-file',
    });
    expect(withFile.calls.fetched).toBe(0);
  });

  it('that cannot be fetched still leaves the paper saved by its DOI', async () => {
    const { deps, calls } = fake({
      pdf: { ok: false, message: 'This site would not let the add-on download the PDF.' },
    });
    const result = await runSave(job([paper(1)], { pdf }), deps);
    expect(result.results[0]?.status).toBe('saved');
    expect(result.pdf).toEqual({
      kind: 'not-fetched',
      message: 'This site would not let the add-on download the PDF.',
    });
    expect(calls.attach).toEqual([]);
  });

  it('is the entry itself when nothing else names the paper', async () => {
    const { deps, calls } = fake({});
    const only = { ...pdf, url: 'https://example.org/a.pdf', filename: 'a.pdf', onlyThePdf: true };
    const result = await runSave(
      job([{ title: 'a.pdf', doi: null, reference: 'a.pdf' }], { pdf: only }),
      deps,
    );
    expect(calls.upload).toBe(1);
    expect(calls.resolve).toEqual([]);
    expect(result.results[0]).toMatchObject({ status: 'saved', sourceId: id(900) });
    expect(result.pdf).toEqual({ kind: 'attached' });

    const blocked = fake({ pdf: { ok: false, message: 'blocked' } });
    const failed = await runSave(
      job([{ title: 'a.pdf', doi: null, reference: 'a.pdf' }], { pdf: only }),
      blocked.deps,
    );
    expect(failed.results[0]).toMatchObject({ status: 'failed', message: 'blocked' });
    expect(blocked.calls.resolve).toEqual([]);
  });

  it('without a DOI but with a title, falls back to the title when the file is refused', async () => {
    const { deps, calls } = fake({
      upload: { ok: false, status: 422, message: 'Your plan allows 10 library PDFs.' },
    });
    const titled = { ...pdf, url: 'https://example.org/a.pdf', filename: 'a.pdf' };
    const result = await runSave(job([paper(5, null)], { pdf: titled }), deps);
    expect(calls.resolve).toHaveLength(1);
    expect(result.results[0]?.status).toBe('saved');
    expect(result.pdf).toEqual({ kind: 'rejected', message: 'Your plan allows 10 library PDFs.' });
  });
});
