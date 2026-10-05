/**
 * ADR-0069: `POST /documents/:id/sources/resolve` names the library row each reference now has,
 * so the Chrome add-on can open the paper it just saved (`/app/d/:id/sources/:sourceId`) and file
 * it into a collection.
 *
 * Pinned: one id per reference, in the order sent; a reference already in the library under the
 * same text answers with the existing row's id (and counts as already present); the same text
 * twice in one request is one row; the counts are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

describe('resolve answers with the source ids', () => {
  let h: Harness;
  let documentId: string;

  beforeAll(async () => {
    h = await startHarness('resolve-ids@example.com');
    const created = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Extension resolve ids', entryPath: 'A_TOPIC' }),
    });
    documentId = ((await created.json()) as { id: string }).id;
  }, 180_000);

  afterAll(async () => {
    await h?.stop();
  });

  const resolve = async (references: Array<{ raw: string; doi?: string }>) => {
    const response = await h.api(`/documents/${documentId}/sources/resolve`, {
      method: 'POST',
      body: JSON.stringify({ references }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as {
      queued: number;
      alreadyPresent: number;
      sourceIds: Array<string | null>;
    };
  };

  it('gives one id per reference, in order, and the existing row for a repeat', async () => {
    const first = await resolve([
      { raw: 'LeCun, Y. (2015). Deep learning. Nature.', doi: '10.1038/nature14539' },
      { raw: 'Vaswani, A. (2017). Attention is all you need.' },
      { raw: 'Vaswani, A. (2017). Attention is all you need.' },
    ]);
    expect(first.queued).toBe(2);
    expect(first.alreadyPresent).toBe(1);
    expect(first.sourceIds).toHaveLength(3);
    const [deep, attention, again] = first.sourceIds;
    expect(deep).toMatch(/^[0-9a-f-]{36}$/);
    expect(attention).toMatch(/^[0-9a-f-]{36}$/);
    expect(again).toBe(attention);

    const rows = await h.prisma.source.findMany({
      where: { documentId },
      select: { id: true, doi: true },
    });
    expect(rows.map((r) => r.id).sort()).toEqual([deep, attention].sort());
    expect(rows.find((r) => r.id === deep)?.doi).toBe('10.1038/nature14539');

    const second = await resolve([
      { raw: 'Vaswani, A. (2017). Attention is all you need.' },
      { raw: 'Hinton, G. (2006). A fast learning algorithm for deep belief nets.' },
    ]);
    expect(second.queued).toBe(1);
    expect(second.alreadyPresent).toBe(1);
    expect(second.sourceIds[0]).toBe(attention);
    expect(second.sourceIds[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.sourceIds[1]).not.toBe(attention);
  });
});
