/**
 * Jenni build plan R16 (ADR-0103) — add a paper by its DOI, arXiv id, PubMed id or ISBN.
 *
 * The outside services are stubbed at `fetch`. Pinned: something that is no identifier is refused
 * in words; a book by ISBN is created from the record (a book, its publisher, its ISBN) and a
 * second import finds it; a DOI goes into the reference pipeline with its DOI, and one already in
 * the library is found, not duplicated.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { QueueService } from '../src/common/queue.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
const realFetch = globalThis.fetch;

function stubOutside() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://openlibrary.org/api/books')) {
      return new Response(
        JSON.stringify({
          'ISBN:9780262033848': {
            title: 'Introduction to Algorithms',
            authors: [{ name: 'Thomas H. Cormen' }],
            publishers: [{ name: 'The MIT Press' }],
            publish_date: '2009',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.startsWith('https://api.crossref.org/works/')) {
      return new Response(
        JSON.stringify({
          message: {
            DOI: '10.1000/abc',
            title: ['Barriers to rooftop solar'],
            author: [{ family: 'Kumar', given: 'Asha' }],
            issued: { 'date-parts': [[2021]] },
            'container-title': ['Energy Policy'],
            type: 'journal-article',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(input, init);
  });
}

async function importId(q: string): Promise<Response> {
  return h.api(`/documents/${documentId}/sources/import-id`, {
    method: 'POST',
    body: JSON.stringify({ q }),
  });
}

beforeAll(async () => {
  h = await startHarness('paper-id@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
}, 300_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await h?.stop();
});

describe('adding a paper by its identifier', () => {
  it('refuses what is no identifier, in words', async () => {
    const res = await h.api(`/documents/${documentId}/sources/lookup-id?q=rooftop%20solar`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/not a DOI/);
  });

  it('creates a book from its ISBN, and finds it the second time', async () => {
    stubOutside();
    const first = await importId('978-0-262-03384-8');
    expect(first.status).toBe(201);
    const body = (await first.json()) as { sourceId: string; alreadyPresent: boolean };
    expect(body.alreadyPresent).toBe(false);
    const row = await h.prisma.source.findUnique({
      where: { id: body.sourceId },
      select: { status: true, type: true, cslJson: true, year: true },
    });
    expect(row).toMatchObject({ status: 'RESOLVED', type: 'book', year: 2009 });
    expect(row?.cslJson).toMatchObject({
      type: 'book',
      publisher: 'The MIT Press',
      ISBN: '9780262033848',
      author: [{ family: 'Cormen', given: 'Thomas H.' }],
    });
    const again = (await (await importId('ISBN 9780262033848')).json()) as {
      sourceId: string;
      alreadyPresent: boolean;
    };
    expect(again).toEqual(
      expect.objectContaining({ sourceId: body.sourceId, alreadyPresent: true }),
    );
  });

  it('sends a DOI down the reference pipeline, and finds one already there', async () => {
    stubOutside();
    const enqueue = vi
      .spyOn(QueueService.prototype, 'enqueue')
      .mockResolvedValue(undefined as never);
    const res = await importId('https://doi.org/10.1000/abc');
    expect(res.status).toBe(201);
    const { sourceId } = (await res.json()) as { sourceId: string };
    const row = await h.prisma.source.findUnique({
      where: { id: sourceId },
      select: { doi: true, rawReference: true },
    });
    expect(row?.rawReference).toBe('Kumar (2021). Barriers to rooftop solar. Energy Policy.');
    expect(enqueue.mock.calls.some((c) => c[0] === 'resolve-reference')).toBe(true);

    // The pipeline sets the DOI when it resolves; here it is set as it would be.
    await h.prisma.source.update({ where: { id: sourceId }, data: { doi: '10.1000/abc' } });
    const again = (await (await importId('doi:10.1000/ABC')).json()) as { alreadyPresent: boolean };
    expect(again.alreadyPresent).toBe(true);
  });
});
