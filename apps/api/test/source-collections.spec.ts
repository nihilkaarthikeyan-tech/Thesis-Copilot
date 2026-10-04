/**
 * Collections (folders) in the library, 2026-10-04.
 *
 * Pinned: a collection is created, renamed, reordered and deleted by the thesis owner only (404
 * for anyone else); names are trimmed, 1–60 characters and unique per thesis whatever their case
 * (409); papers are added and taken out in bulk, and only papers of the same thesis; the library
 * lists each paper's collections; deleting a collection keeps its papers; a merge carries the
 * removed duplicate's memberships to the kept record; a copy of the thesis has its own
 * collections with its own ids; and erasing a thesis removes its collections.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ValidationError } from '../src/common/errors.js';
import { normaliseCollectionName } from '../src/modules/sources/collections.service.js';
import { type Harness, startHarness } from './_harness.js';

describe('collection names, pure', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseCollectionName('  Chapter   2 ')).toBe('Chapter 2');
  });
  const detailOf = (raw: string): string => {
    try {
      normaliseCollectionName(raw);
      return '';
    } catch (error) {
      return ((error as ValidationError).getResponse() as { detail: string }).detail;
    }
  };

  it('refuses an empty or over-long name', () => {
    expect(detailOf('   ')).toBe('Give the collection a name.');
    expect(detailOf('x'.repeat(61))).toContain('60');
    expect(normaliseCollectionName('x'.repeat(60))).toHaveLength(60);
  });
});

describe('collections through the API', () => {
  let h: Harness;
  let otherCookie: string;
  let documentId: string;
  let otherDocumentId: string;
  let sourceIds: string[];
  let foreignSourceId: string;
  let methodsId: string;
  let policyId: string;

  const call = (cookie: string | null, path: string, init: RequestInit = {}) =>
    fetch(`${h.baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        origin: 'http://localhost:3000',
        ...(cookie ? { cookie } : {}),
      },
    });
  const owner = (path: string, init?: RequestInit) => call(h.cookie, path, init);
  const post = (path: string, body: unknown, cookie: string | null = h.cookie) =>
    call(cookie, path, { method: 'POST', body: JSON.stringify(body) });

  beforeAll(async () => {
    h = await startHarness('collections-owner@example.com');
    const created = await owner('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Groundwater governance in Tamil Nadu', entryPath: 'A_TOPIC' }),
    });
    documentId = ((await created.json()) as { id: string }).id;

    sourceIds = [];
    for (const title of ['Aquifer recharge', 'Water user associations', 'Pump subsidies']) {
      const source = await h.prisma.source.create({
        data: { documentId, status: 'RESOLVED', title, year: 2020 },
      });
      sourceIds.push(source.id);
    }

    // A second thesis of the same student, for "papers of another thesis are refused".
    const other = await h.prisma.document.create({
      data: { ownerId: h.userId, title: 'Another thesis', entryPath: 'A_TOPIC' },
    });
    otherDocumentId = other.id;
    foreignSourceId = (
      await h.prisma.source.create({
        data: { documentId: otherDocumentId, status: 'RESOLVED', title: 'Elsewhere' },
      })
    ).id;

    const email = 'collections-other@example.com';
    await call(null, '/auth/email-otp/send-verification-otp', {
      method: 'POST',
      body: JSON.stringify({ email, type: 'sign-in' }),
    });
    const { otp } = (await (
      await call(null, `/auth/dev/last-otp?email=${encodeURIComponent(email)}`)
    ).json()) as { otp: string };
    const signedIn = await post('/auth/sign-in/email-otp', { email, otp }, null);
    otherCookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(otherCookie).toContain('session_token');
  }, 180_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('creates collections with trimmed names, in order', async () => {
    const methods = await post(`/documents/${documentId}/collections`, { name: '  Methods ' });
    expect(methods.status).toBe(201);
    const body = (await methods.json()) as { id: string; name: string; order: number };
    expect(body).toMatchObject({ name: 'Methods', order: 0, count: 0 });
    methodsId = body.id;

    const policy = await post(`/documents/${documentId}/collections`, { name: 'Policy' });
    expect(policy.status).toBe(201);
    policyId = ((await policy.json()) as { id: string }).id;

    const list = (await (await owner(`/documents/${documentId}/collections`)).json()) as Array<{
      name: string;
    }>;
    expect(list.map((c) => c.name)).toEqual(['Methods', 'Policy']);
  });

  it('refuses a duplicate name whatever its case, and an empty or long one', async () => {
    const clash = await post(`/documents/${documentId}/collections`, { name: 'METHODS' });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { detail: string }).detail).toContain('Methods');

    expect((await post(`/documents/${documentId}/collections`, { name: '   ' })).status).toBe(400);
    expect(
      (await post(`/documents/${documentId}/collections`, { name: 'x'.repeat(61) })).status,
    ).toBe(400);

    // The same name in another thesis is fine.
    expect(
      (await post(`/documents/${otherDocumentId}/collections`, { name: 'Methods' })).status,
    ).toBe(201);

    const rename = await call(h.cookie, `/collections/${policyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'methods' }),
    });
    expect(rename.status).toBe(409);
  });

  it('renames, and a rename to its own name in another case is allowed', async () => {
    const res = await call(h.cookie, `/collections/${policyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Policy and law' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe('Policy and law');
    const recase = await call(h.cookie, `/collections/${policyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'POLICY AND LAW' }),
    });
    expect(recase.status).toBe(200);
  });

  it('adds and removes papers in bulk, and the library lists their collections', async () => {
    const added = await post(`/collections/${methodsId}/sources`, {
      sourceIds: [sourceIds[0], sourceIds[1], sourceIds[0]],
    });
    expect(added.status).toBe(201);
    expect(await added.json()).toEqual({ added: 2, count: 2 });
    // Adding again is not an error and adds nothing.
    expect(
      await (await post(`/collections/${methodsId}/sources`, { sourceIds: [sourceIds[1]] })).json(),
    ).toEqual({ added: 0, count: 2 });
    await post(`/collections/${policyId}/sources`, { sourceIds: [sourceIds[1]] });

    const library = (await (await owner(`/documents/${documentId}/sources`)).json()) as Array<{
      id: string;
      collectionIds: string[];
    }>;
    const of = (id: string | undefined) => library.find((s) => s.id === id)?.collectionIds;
    expect(of(sourceIds[0])).toEqual([methodsId]);
    expect(new Set(of(sourceIds[1]))).toEqual(new Set([methodsId, policyId]));
    expect(of(sourceIds[2])).toEqual([]);

    const removed = await post(`/collections/${methodsId}/sources/remove`, {
      sourceIds: [sourceIds[0]],
    });
    expect(await removed.json()).toEqual({ removed: 1, count: 1 });
    // The paper itself is still in the library.
    expect(await h.prisma.source.count({ where: { id: sourceIds[0] } })).toBe(1);
  });

  it('refuses a paper from another thesis, adding nothing', async () => {
    const res = await post(`/collections/${methodsId}/sources`, {
      sourceIds: [sourceIds[2], foreignSourceId],
    });
    expect(res.status).toBe(404);
    expect(
      await h.prisma.sourceCollectionItem.count({
        where: { collectionId: methodsId, sourceId: sourceIds[2] },
      }),
    ).toBe(0);
  });

  it('reorders, and refuses a stale or partial order', async () => {
    const res = await call(h.cookie, `/documents/${documentId}/collections/order`, {
      method: 'PUT',
      body: JSON.stringify({ ids: [policyId, methodsId] }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ id: string }>).map((c) => c.id)).toEqual([
      policyId,
      methodsId,
    ]);
    const partial = await call(h.cookie, `/documents/${documentId}/collections/order`, {
      method: 'PUT',
      body: JSON.stringify({ ids: [policyId] }),
    });
    expect(partial.status).toBe(409);
  });

  it('is the owner’s alone: anyone else gets 404, signed out gets 401', async () => {
    expect((await call(otherCookie, `/documents/${documentId}/collections`)).status).toBe(404);
    expect(
      (await post(`/documents/${documentId}/collections`, { name: 'Mine' }, otherCookie)).status,
    ).toBe(404);
    expect(
      (
        await call(otherCookie, `/collections/${methodsId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Taken over' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(otherCookie, `/collections/${methodsId}`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect(
      (await post(`/collections/${methodsId}/sources`, { sourceIds: [sourceIds[2]] }, otherCookie))
        .status,
    ).toBe(404);
    expect(
      (
        await post(
          `/collections/${methodsId}/sources/remove`,
          { sourceIds: [sourceIds[1]] },
          otherCookie,
        )
      ).status,
    ).toBe(404);
    expect((await call(null, `/documents/${documentId}/collections`)).status).toBe(401);
    const still = await h.prisma.sourceCollection.findUniqueOrThrow({ where: { id: methodsId } });
    expect(still.name).toBe('Methods');
  });

  it('a merge carries the removed duplicate’s collections to the kept paper', async () => {
    const dup = await h.prisma.source.create({
      data: { documentId, status: 'RESOLVED', title: 'Pump subsidies (copy)', year: 2020 },
    });
    await post(`/collections/${policyId}/sources`, { sourceIds: [dup.id] });
    const merged = await post(`/sources/${sourceIds[2]}/merge`, { duplicateId: dup.id });
    expect(merged.status).toBe(201);
    expect(
      await h.prisma.sourceCollectionItem.count({
        where: { collectionId: policyId, sourceId: sourceIds[2] },
      }),
    ).toBe(1);
  });

  it('a copy of the thesis has its own collections, with its own ids', async () => {
    const res = await owner(`/documents/${documentId}/copy`, { method: 'POST' });
    expect(res.status).toBe(200);
    const copyId = ((await res.json()) as { id: string }).id;

    const copied = await h.prisma.sourceCollection.findMany({
      where: { documentId: copyId },
      orderBy: { order: 'asc' },
      include: { items: { include: { source: { select: { documentId: true, title: true } } } } },
    });
    expect(copied.map((c) => c.name)).toEqual(['POLICY AND LAW', 'Methods']);
    expect(copied.map((c) => c.id)).not.toContain(policyId);
    expect(copied.map((c) => c.id)).not.toContain(methodsId);
    for (const collection of copied) {
      for (const item of collection.items) expect(item.source.documentId).toBe(copyId);
    }
    const policyTitles = copied[0]?.items.map((i) => i.source.title).sort();
    expect(policyTitles).toEqual(['Pump subsidies', 'Water user associations']);

    // Changing the copy's collections leaves the original's alone.
    const copyPolicy = copied[0]?.id as string;
    await call(h.cookie, `/collections/${copyPolicy}`, { method: 'DELETE' });
    expect(await h.prisma.sourceCollection.count({ where: { id: policyId } })).toBe(1);

    // And erasing the copy takes its collections with it.
    expect((await owner(`/documents/${copyId}`, { method: 'DELETE' })).status).toBe(200);
    expect(await h.prisma.sourceCollection.count({ where: { documentId: copyId } })).toBe(0);
  });

  it('deleting a collection keeps its papers', async () => {
    const before = await h.prisma.source.count({ where: { documentId } });
    const res = await call(h.cookie, `/collections/${policyId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await h.prisma.sourceCollection.count({ where: { id: policyId } })).toBe(0);
    expect(await h.prisma.sourceCollectionItem.count({ where: { collectionId: policyId } })).toBe(
      0,
    );
    expect(await h.prisma.source.count({ where: { documentId } })).toBe(before);
  });

  it('removing a paper takes it out of its collections', async () => {
    await post(`/collections/${methodsId}/sources`, { sourceIds: [sourceIds[0]] });
    expect((await owner(`/sources/${sourceIds[0]}`, { method: 'DELETE' })).status).toBe(200);
    expect(await h.prisma.sourceCollectionItem.count({ where: { sourceId: sourceIds[0] } })).toBe(
      0,
    );
  });

  it('erasing the thesis erases its collections', async () => {
    expect((await owner(`/documents/${documentId}`, { method: 'DELETE' })).status).toBe(200);
    expect(await h.prisma.sourceCollection.count({ where: { documentId } })).toBe(0);
    expect(await h.prisma.sourceCollectionItem.count({ where: { collectionId: methodsId } })).toBe(
      0,
    );
    // The other thesis's collection is untouched.
    expect(await h.prisma.sourceCollection.count({ where: { documentId: otherDocumentId } })).toBe(
      1,
    );
  });
});
