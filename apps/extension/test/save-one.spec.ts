/**
 * One paper from an in-page button (ADR-0125), against a fake Thesis Copilot. Pinned: with an
 * identifier it goes in through `import-id`, which sends the identifier and nothing else; "already
 * there" is what the server says; only a 404 (no record for it) sends it the popup's way, through
 * resolve, by its details; 401 is signed out; any other refusal is reported with its reason, not
 * retried another way; the collection gets it. And a content script's message is checked before
 * any of that: ids are UUIDs, the identifier is exactly one, the paper is text of bounded length.
 */

import { describe, expect, it } from 'vitest';
import type { Reply, SaveOneJob } from '../src/messages.js';
import { checkPaper, type Paper } from '../src/paper.js';
import { checkSaveOneJob, type SaveOneDeps, saveOne } from '../src/save.js';

const DOC = '0190a3c4-0000-7000-8000-000000000001';
const COLLECTION = '0190a3c4-0000-7000-8000-0000000000c1';
const SOURCE = '0190a3c4-0000-7000-8000-000000000101';

const PAPER: Paper = {
  title: 'Groundwater Recharge',
  doi: '10.5555/ojgs14121570',
  reference: 'Raman, Iyer (2017). Groundwater Recharge. OJGS. https://doi.org/10.5555/ojgs14121570',
  byline: 'Raman, Iyer',
  year: '2017',
  venue: 'OJGS',
};

function fake(importReply: Reply<{ sourceId: string; alreadyPresent: boolean }>) {
  const calls = { imported: [] as string[], resolved: 0, collection: [] as string[][] };
  const deps: SaveOneDeps = {
    api: {
      importId: async (_doc, query) => {
        calls.imported.push(query);
        return importReply;
      },
      library: async () => ({ ok: true, value: [] }),
      resolve: async (_doc, refs) => {
        calls.resolved += refs.length;
        return { ok: true, value: { sourceIds: refs.map(() => SOURCE) } };
      },
      addToCollection: async (_c, ids) => {
        calls.collection.push(ids);
        return { ok: true, value: {} };
      },
      uploadPdf: async () => ({ ok: false, status: 500, message: 'not used' }),
      attachPdf: async () => ({ ok: false, status: 500, message: 'not used' }),
    },
  };
  return { deps, calls };
}

const job = (over: Partial<SaveOneJob> = {}): SaveOneJob => ({
  documentId: DOC,
  collectionId: null,
  ref: { kind: 'doi', id: '10.5555/ojgs14121570' },
  paper: PAPER,
  ...over,
});

describe('saving one paper from the page', () => {
  it('imports it by its identifier alone, and files it in the collection', async () => {
    const { deps, calls } = fake({ ok: true, value: { sourceId: SOURCE, alreadyPresent: false } });
    const result = await saveOne(job({ collectionId: COLLECTION }), deps);
    expect(calls.imported).toEqual(['10.5555/ojgs14121570']);
    expect(calls.resolved).toBe(0);
    expect(calls.collection).toEqual([[SOURCE]]);
    expect(result).toEqual({
      key: 'one',
      status: 'saved',
      sourceId: SOURCE,
      collection: 'added',
      signedOut: false,
      via: 'id',
    });
  });

  it('says "already in the library" when the server found it there', async () => {
    const { deps } = fake({ ok: true, value: { sourceId: SOURCE, alreadyPresent: true } });
    const result = await saveOne(job({ ref: { kind: 'pmid', id: '33333333' } }), deps);
    expect(result).toMatchObject({ status: 'present', sourceId: SOURCE, via: 'id' });
  });

  it('only when there is no record for the identifier, saves it by its details instead', async () => {
    const { deps, calls } = fake({ ok: false, status: 404, message: 'No paper with that DOI' });
    const result = await saveOne(job(), deps);
    expect(calls.imported).toHaveLength(1);
    expect(calls.resolved).toBe(1);
    expect(result).toMatchObject({ status: 'saved', sourceId: SOURCE, via: 'details' });
  });

  it('reports any other refusal with its reason, and does not go round it', async () => {
    const { deps, calls } = fake({
      ok: false,
      status: 429,
      message: 'Too many requests. Wait a minute and try again.',
    });
    const result = await saveOne(job(), deps);
    expect(calls.resolved).toBe(0);
    expect(result).toMatchObject({
      status: 'failed',
      message: 'Too many requests. Wait a minute and try again.',
      signedOut: false,
    });
    const out = await saveOne(
      job(),
      fake({ ok: false, status: 401, message: 'You are signed out of Thesis Copilot.' }).deps,
    );
    expect(out).toMatchObject({ status: 'failed', signedOut: true });
  });

  it('a result with no identifier goes the popup’s way, by its details', async () => {
    const { deps, calls } = fake({ ok: true, value: { sourceId: SOURCE, alreadyPresent: false } });
    const result = await saveOne(job({ ref: null, paper: { ...PAPER, doi: null } }), deps);
    expect(calls.imported).toEqual([]);
    expect(calls.resolved).toBe(1);
    expect(result).toMatchObject({ status: 'saved', via: 'details' });
  });
});

describe('a content script’s save, as the service worker accepts it', () => {
  it('takes a well-formed job', () => {
    expect(checkSaveOneJob(job({ collectionId: COLLECTION }))).toEqual(
      job({ collectionId: COLLECTION }),
    );
    expect(checkSaveOneJob({ ...job(), ref: null, collectionId: undefined })).toMatchObject({
      ref: null,
      collectionId: null,
    });
  });

  it('refuses ids that are not UUIDs, a tampered identifier, and a paper that is not one', () => {
    for (const bad of [
      null,
      'save',
      { ...job(), documentId: '../../admin' },
      { ...job(), collectionId: 'everything' },
      { ...job(), ref: { kind: 'doi', id: '10.5555/x"><img>' } },
      { ...job(), ref: { kind: 'url', id: 'https://evil.example' } },
      { ...job(), paper: { ...PAPER, doi: 'javascript:alert(1)' } },
      { ...job(), paper: { title: 'No DOI, no reference' } },
      { ...job(), paper: 'Groundwater Recharge' },
    ]) {
      expect(checkSaveOneJob(bad)).toBeNull();
    }
  });

  it('keeps a paper’s text as text, on one line and cut to length', () => {
    const paper = checkPaper({
      title: `A\u0000title\nwith\tcontrol characters ${'x'.repeat(900)}`,
      doi: null,
      reference: 'Ref',
      year: '20255',
      byline: 42,
    });
    expect(paper?.title.startsWith('A title with control characters')).toBe(true);
    expect(paper?.title.length).toBe(500);
    expect(paper).toMatchObject({ doi: null, reference: 'Ref', year: null, byline: null });
  });
});
