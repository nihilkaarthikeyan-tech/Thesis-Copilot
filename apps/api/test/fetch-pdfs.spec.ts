/**
 * Jenni build plan R14 (ADR-0101) — "Fetch PDF": look again for open-access copies.
 *
 * Pinned: papers with a DOI and no file are queued for indexing again (which tries arXiv, every
 * copy Unpaywall lists, and CORE); a paper with a file, or still being resolved, is left alone; one
 * without a DOI is counted, not queued; a second press in the same minute makes the same job id
 * (so it adds nothing); one paper can be asked for alone; another student's thesis is not found.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { QueueService } from '../src/common/queue.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
const ids: Record<string, string> = {};

async function fetchPdfs(body: unknown = {}, id = documentId): Promise<Response> {
  return h.api(`/documents/${id}/sources/fetch-pdfs`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  h = await startHarness('fetch-pdfs@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  const make = async (
    name: string,
    data: { doi?: string; fileKey?: string; status?: 'RESOLVED' | 'PENDING' },
  ) => {
    const row = await h.prisma.source.create({
      data: { documentId, title: name, status: data.status ?? 'RESOLVED', ...data },
      select: { id: true },
    });
    ids[name] = row.id;
  };
  await make('doi-no-file', { doi: '10.1000/abc' });
  await make('doi-no-file-2', { doi: '10.1000/def' });
  await make('has-file', { doi: '10.1000/ghi', fileKey: 'sources/x.pdf' });
  await make('no-doi', {});
  await make('pending', { doi: '10.1000/jkl', status: 'PENDING' });
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('fetching missing PDFs', () => {
  it('queues the papers with a DOI and no file, and counts the ones without a DOI', async () => {
    // On the prototype: the sources module's own instance is the one that enqueues.
    const enqueue = vi
      .spyOn(QueueService.prototype, 'enqueue')
      .mockResolvedValue(undefined as never);
    const res = await fetchPdfs();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: 2, noDoi: 1 });
    const queuedFor = enqueue.mock.calls.map((c) => (c[1] as { sourceId: string }).sourceId);
    expect(queuedFor.sort()).toEqual([ids['doi-no-file'], ids['doi-no-file-2']].sort());
    expect(enqueue.mock.calls.every((c) => c[0] === 'index-source')).toBe(true);

    // The same minute, the same job ids: BullMQ adds nothing for a double press.
    const first = enqueue.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
    enqueue.mockClear();
    await fetchPdfs();
    const second = enqueue.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
    expect(second).toEqual(first);
    expect(first.every((id) => !id.includes(':'))).toBe(true);
    enqueue.mockRestore();
  });

  it('can be asked for one paper, and finds no other thesis', async () => {
    // On the prototype: the sources module's own instance is the one that enqueues.
    const enqueue = vi
      .spyOn(QueueService.prototype, 'enqueue')
      .mockResolvedValue(undefined as never);
    const res = await fetchPdfs({ sourceIds: [ids['doi-no-file']] });
    expect(await res.json()).toEqual({ queued: 1, noDoi: 0 });
    enqueue.mockRestore();

    const stranger = await h.prisma.user.create({
      data: { email: 'stranger-fetch@example.com', name: 'Stranger' },
    });
    const theirs = await h.prisma.document.create({
      data: { ownerId: stranger.id, title: 'Theirs', entryPath: 'A_TOPIC' },
    });
    expect((await fetchPdfs({}, theirs.id)).status).toBe(404);
  });
});
