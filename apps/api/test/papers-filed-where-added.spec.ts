/**
 * R18 (ADR-0129): a paper is filed where it is added.
 *
 * Pinned: the thesis keeps its "Add into" (`GET/PUT /documents/:id/add-into`), and forgets it
 * when that collection is deleted; a collection of another thesis is refused (404) both as the
 * choice and on an add, and such an add adds nothing; and each way a paper enters the library
 * outside the library screen files it into the collection the request names —
 *   - `POST /documents/:id/sources/resolve` (chat's Add, the editor's Papers tab),
 *   - `POST /documents/:id/search/:runId/select` (Discover),
 *   - `POST /documents/:id/citations/accept` (a pasted reference on the Citations tab) —
 * a paper already in the library included, and none of them files anything without one.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addIntoOf } from '../src/common/library-filing.js';
import { type Harness, startHarness } from './_harness.js';

describe('the stored choice, pure', () => {
  it('reads addInto out of meta, and nothing else', () => {
    expect(addIntoOf({ addInto: 'abc' })).toBe('abc');
    expect(addIntoOf({ addInto: null })).toBeNull();
    expect(addIntoOf({ addInto: 3 })).toBeNull();
    expect(addIntoOf(null)).toBeNull();
    expect(addIntoOf([])).toBeNull();
  });
});

describe('papers filed where they are added', () => {
  let h: Harness;
  let documentId: string;
  let otherDocumentId: string;
  let methodsId: string;
  let foreignCollectionId: string;

  const post = (path: string, body: unknown) =>
    h.api(path, { method: 'POST', body: JSON.stringify(body) });
  const put = (path: string, body: unknown) =>
    h.api(path, { method: 'PUT', body: JSON.stringify(body) });
  const membersOf = async (collectionId: string) =>
    (
      await h.prisma.sourceCollectionItem.findMany({
        where: { collectionId },
        select: { sourceId: true },
      })
    ).map((r) => r.sourceId);

  beforeAll(async () => {
    h = await startHarness('filed-where-added@example.com');
    const created = await post('/documents', {
      title: 'Groundwater governance in Tamil Nadu',
      entryPath: 'A_TOPIC',
    });
    documentId = ((await created.json()) as { id: string }).id;
    const methods = await post(`/documents/${documentId}/collections`, { name: 'Methods' });
    methodsId = ((await methods.json()) as { id: string }).id;

    const other = await h.prisma.document.create({
      data: { ownerId: h.userId, title: 'Another thesis', entryPath: 'A_TOPIC' },
    });
    otherDocumentId = other.id;
    foreignCollectionId = (
      await h.prisma.sourceCollection.create({
        data: { documentId: otherDocumentId, name: 'Elsewhere', order: 0 },
      })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('keeps the thesis’s "Add into", and refuses another thesis’s collection', async () => {
    const start = await h.api(`/documents/${documentId}/add-into`);
    expect(await start.json()).toEqual({ collectionId: null });

    const chosen = await put(`/documents/${documentId}/add-into`, { collectionId: methodsId });
    expect(chosen.status).toBe(200);
    expect(await chosen.json()).toEqual({ collectionId: methodsId });
    const again = await h.api(`/documents/${documentId}/add-into`);
    expect(await again.json()).toEqual({ collectionId: methodsId });

    const foreign = await put(`/documents/${documentId}/add-into`, {
      collectionId: foreignCollectionId,
    });
    expect(foreign.status).toBe(404);
    expect(await (await h.api(`/documents/${documentId}/add-into`)).json()).toEqual({
      collectionId: methodsId,
    });

    expect((await put(`/documents/${documentId}/add-into`, { collectionId: 'x' })).status).toBe(
      400,
    );
  });

  it('forgets the choice once that collection is deleted', async () => {
    const temp = await post(`/documents/${documentId}/collections`, { name: 'Temporary' });
    const tempId = ((await temp.json()) as { id: string }).id;
    await put(`/documents/${documentId}/add-into`, { collectionId: tempId });
    // Deleted underneath (another tab): the stored id is now stale.
    await h.prisma.sourceCollection.delete({ where: { id: tempId } });
    expect(await (await h.api(`/documents/${documentId}/add-into`)).json()).toEqual({
      collectionId: null,
    });
    const cleared = await put(`/documents/${documentId}/add-into`, { collectionId: null });
    expect(await cleared.json()).toEqual({ collectionId: null });
  });

  it('files a paper added through resolve (chat, Papers tab), including one already there', async () => {
    const raw = 'Shah, T. (2009). Taming the anarchy: groundwater governance in South Asia.';
    const first = await post(`/documents/${documentId}/sources/resolve`, {
      references: [{ raw }],
      collectionId: methodsId,
    });
    expect(first.status).toBe(201);
    const body = (await first.json()) as {
      sourceIds: string[];
      filedIn: { id: string; name: string } | null;
    };
    expect(body.filedIn).toEqual({ id: methodsId, name: 'Methods' });
    const [sourceId] = body.sourceIds;
    expect(await membersOf(methodsId)).toContain(sourceId);

    // Added again into a second collection: the existing row is filed there too.
    const policy = await post(`/documents/${documentId}/collections`, { name: 'Policy' });
    const policyId = ((await policy.json()) as { id: string }).id;
    const second = await post(`/documents/${documentId}/sources/resolve`, {
      references: [{ raw }],
      collectionId: policyId,
    });
    expect(((await second.json()) as { alreadyPresent: number }).alreadyPresent).toBe(1);
    expect(await membersOf(policyId)).toEqual([sourceId]);
  });

  it('files nothing without a collection, and adds nothing with another thesis’s', async () => {
    const plain = await post(`/documents/${documentId}/sources/resolve`, {
      references: [{ raw: 'Kulkarni, H. (2015). Indian groundwater: a public good.' }],
    });
    const plainBody = (await plain.json()) as { sourceIds: string[]; filedIn: unknown };
    expect(plainBody.filedIn).toBeNull();
    const filed = await h.prisma.sourceCollectionItem.count({
      where: { sourceId: plainBody.sourceIds[0] },
    });
    expect(filed).toBe(0);

    const before = await h.prisma.source.count({ where: { documentId } });
    const refused = await post(`/documents/${documentId}/sources/resolve`, {
      references: [{ raw: 'Never added (2020). A paper that must not appear.' }],
      collectionId: foreignCollectionId,
    });
    expect(refused.status).toBe(404);
    expect(await h.prisma.source.count({ where: { documentId } })).toBe(before);
  });

  it('files the papers picked on Discover', async () => {
    const runId = randomUUID();
    const candidate = await h.prisma.searchCandidate.create({
      data: {
        runId,
        documentId,
        title: 'Electricity subsidies and groundwater depletion',
        year: 2018,
        doi: '10.5555/r18-discover',
        theme: 'Energy',
      },
    });
    const response = await post(`/documents/${documentId}/search/${runId}/select`, {
      candidateIds: [candidate.id],
      collectionId: methodsId,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      added: number;
      sourceIds: string[];
      filedIn: { id: string } | null;
    };
    expect(body.added).toBe(1);
    expect(body.filedIn?.id).toBe(methodsId);
    expect(await membersOf(methodsId)).toContain(body.sourceIds[0]);
  });

  it('files a pasted reference accepted on the Citations tab', async () => {
    const response = await post(`/documents/${documentId}/citations/accept`, {
      reference: 'Mukherji, A. (2016). Evolution of irrigation in South Asia.',
      doi: null,
      collectionId: methodsId,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sourceId: string; filedIn: { id: string } | null };
    expect(body.filedIn?.id).toBe(methodsId);
    expect(await membersOf(methodsId)).toContain(body.sourceId);
  });
});
