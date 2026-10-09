/**
 * Highlights and notes in the reader, 2026-10-09 (ADR-0130).
 *
 * Pinned: a highlight is saved, listed in reading order, recoloured, noted and deleted by the
 * thesis owner only (404 for anyone else, 401 signed out); a bad body is a 400 and an empty note
 * is no note; nothing is metered (no usage row, no AI call); removing the paper, merging it into
 * another, copying the thesis, erasing the thesis and erasing the account each leave no highlight
 * behind that should not be there.
 */

import type { ReaderHighlight } from '@tc/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanNote } from '../src/modules/sources/highlights.service.js';
import { type Harness, startHarness } from './_harness.js';

describe('notes, pure', () => {
  it('an empty or all-space note is no note', () => {
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
    expect(cleanNote('  Use in 2.3 ')).toBe('Use in 2.3');
  });
});

describe('reader highlights through the API', () => {
  let h: Harness;
  let otherCookie: string;
  let documentId: string;
  let sourceId: string;
  let secondSourceId: string;

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
  const send = (method: string, path: string, body: unknown, cookie: string | null = h.cookie) =>
    call(cookie, path, { method, body: JSON.stringify(body) });

  const body = (over: Partial<Record<string, unknown>> = {}) => ({
    view: 'PDF',
    page: 3,
    chunkId: null,
    start: 120,
    end: 160,
    exact: 'groundwater recharge fell by a third',
    prefix: 'in the decade after 2001, ',
    suffix: ' across the delta districts',
    quote: 'Groundwater recharge fell by a third',
    colour: 'yellow',
    ...over,
  });

  beforeAll(async () => {
    h = await startHarness('highlights-owner@example.com');
    const created = await owner('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Groundwater governance in Tamil Nadu', entryPath: 'A_TOPIC' }),
    });
    documentId = ((await created.json()) as { id: string }).id;
    sourceId = (
      await h.prisma.source.create({
        data: { documentId, status: 'RESOLVED', title: 'Aquifer recharge', year: 2020 },
      })
    ).id;
    secondSourceId = (
      await h.prisma.source.create({
        data: { documentId, status: 'RESOLVED', title: 'Pump subsidies', year: 2019 },
      })
    ).id;

    const email = 'highlights-other@example.com';
    await call(null, '/auth/email-otp/send-verification-otp', {
      method: 'POST',
      body: JSON.stringify({ email, type: 'sign-in' }),
    });
    const { otp } = (await (
      await call(null, `/auth/dev/last-otp?email=${encodeURIComponent(email)}`)
    ).json()) as { otp: string };
    const signedIn = await send('POST', '/auth/sign-in/email-otp', { email, otp }, null);
    otherCookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(otherCookie).toContain('session_token');
  }, 180_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('saves highlights and lists them in reading order, without metering anything', async () => {
    const later = await send(
      'POST',
      `/sources/${sourceId}/highlights`,
      body({ page: 5, colour: 'green' }),
    );
    expect(later.status).toBe(201);
    const first = await send(
      'POST',
      `/sources/${sourceId}/highlights`,
      body({ note: '  Use in 2.3, against Kumar.  ' }),
    );
    expect(first.status).toBe(201);
    const saved = (await first.json()) as ReaderHighlight;
    expect(saved).toMatchObject({ page: 3, colour: 'yellow', note: 'Use in 2.3, against Kumar.' });

    const textView = await send(
      'POST',
      `/sources/${sourceId}/highlights`,
      body({ view: 'TEXT', page: null, chunkId: null, start: 10, end: 20, colour: 'pink' }),
    );
    expect(textView.status).toBe(201);

    const list = (await (
      await owner(`/sources/${sourceId}/highlights`)
    ).json()) as ReaderHighlight[];
    expect(list.map((x) => [x.page, x.colour])).toEqual([
      [3, 'yellow'],
      [5, 'green'],
      [null, 'pink'],
    ]);

    expect(await h.prisma.usageLedger.count({ where: { userId: h.userId } })).toBe(0);
    expect(await h.prisma.aiCallLog.count({ where: { userId: h.userId } })).toBe(0);
  });

  it('refuses a body that is not a highlight', async () => {
    for (const bad of [
      body({ colour: 'purple' }),
      body({ start: 50, end: 40 }),
      body({ quote: '   ' }),
      body({ note: 'x'.repeat(2_001) }),
      body({ view: 'IMAGE' }),
    ]) {
      expect((await send('POST', `/sources/${sourceId}/highlights`, bad)).status).toBe(400);
    }
  });

  it('recolours a highlight, and changes or clears its note', async () => {
    const [first] = (await (
      await owner(`/sources/${sourceId}/highlights`)
    ).json()) as ReaderHighlight[];
    const id = first?.id as string;

    const recoloured = await send('PATCH', `/highlights/${id}`, { colour: 'blue' });
    expect(recoloured.status).toBe(200);
    expect(await recoloured.json()).toMatchObject({
      colour: 'blue',
      note: 'Use in 2.3, against Kumar.',
    });

    const noted = await send('PATCH', `/highlights/${id}`, { note: 'Contradicts chapter 1.' });
    expect(await noted.json()).toMatchObject({ colour: 'blue', note: 'Contradicts chapter 1.' });

    const cleared = await send('PATCH', `/highlights/${id}`, { note: '  ' });
    expect(((await cleared.json()) as ReaderHighlight).note).toBeNull();

    expect((await send('PATCH', `/highlights/${id}`, {})).status).toBe(400);
  });

  it('is the owner’s alone: another student and a signed-out caller get nothing', async () => {
    const [first] = (await (
      await owner(`/sources/${sourceId}/highlights`)
    ).json()) as ReaderHighlight[];
    const id = first?.id as string;

    expect((await call(otherCookie, `/sources/${sourceId}/highlights`)).status).toBe(404);
    expect(
      (await send('POST', `/sources/${sourceId}/highlights`, body(), otherCookie)).status,
    ).toBe(404);
    expect((await send('PATCH', `/highlights/${id}`, { note: 'mine' }, otherCookie)).status).toBe(
      404,
    );
    expect((await call(otherCookie, `/highlights/${id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await call(null, `/sources/${sourceId}/highlights`)).status).toBe(401);

    const still = await h.prisma.sourceHighlight.findUniqueOrThrow({ where: { id } });
    expect(still.note).toBeNull();
  });

  it('deletes a highlight', async () => {
    const created = (await (
      await send('POST', `/sources/${sourceId}/highlights`, body({ page: 9 }))
    ).json()) as ReaderHighlight;
    const res = await owner(`/highlights/${created.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await h.prisma.sourceHighlight.count({ where: { id: created.id } })).toBe(0);
    expect((await owner(`/highlights/${created.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('a merge carries the removed duplicate’s highlights to the kept paper', async () => {
    const dup = await h.prisma.source.create({
      data: { documentId, status: 'RESOLVED', title: 'Pump subsidies (copy)', year: 2019 },
    });
    await send(
      'POST',
      `/sources/${dup.id}/highlights`,
      body({ view: 'TEXT', chunkId: '01920000-0000-7000-8000-000000000001', note: 'keep me' }),
    );
    const merged = await send('POST', `/sources/${secondSourceId}/merge`, { duplicateId: dup.id });
    expect(merged.status).toBe(201);
    const moved = await h.prisma.sourceHighlight.findMany({ where: { sourceId: secondSourceId } });
    expect(moved.map((m) => [m.note, m.chunkId])).toEqual([['keep me', null]]);
  });

  it('a copy of the thesis has its own highlights; erasing the copy takes them', async () => {
    const res = await owner(`/documents/${documentId}/copy`, { method: 'POST' });
    expect(res.status).toBe(200);
    const copyId = ((await res.json()) as { id: string }).id;
    const copied = await h.prisma.sourceHighlight.findMany({
      where: { source: { documentId: copyId } },
    });
    const original = await h.prisma.sourceHighlight.count({ where: { source: { documentId } } });
    expect(copied).toHaveLength(original);
    for (const row of copied) {
      expect([sourceId, secondSourceId]).not.toContain(row.sourceId);
      expect(row.userId).toBe(h.userId);
    }

    expect((await owner(`/documents/${copyId}`, { method: 'DELETE' })).status).toBe(200);
    expect(
      await h.prisma.sourceHighlight.count({ where: { source: { documentId: copyId } } }),
    ).toBe(0);
    expect(await h.prisma.sourceHighlight.count({ where: { source: { documentId } } })).toBe(
      original,
    );
  });

  it('removing the paper removes its highlights', async () => {
    expect(await h.prisma.sourceHighlight.count({ where: { sourceId: secondSourceId } })).toBe(1);
    expect((await owner(`/sources/${secondSourceId}`, { method: 'DELETE' })).status).toBe(200);
    expect(await h.prisma.sourceHighlight.count({ where: { sourceId: secondSourceId } })).toBe(0);
  });

  it('erasing the thesis erases its highlights', async () => {
    expect(await h.prisma.sourceHighlight.count({ where: { sourceId } })).toBeGreaterThan(0);
    expect((await owner(`/documents/${documentId}`, { method: 'DELETE' })).status).toBe(200);
    expect(await h.prisma.sourceHighlight.count({ where: { sourceId } })).toBe(0);
  });

  it('erasing the account erases every highlight the student made', async () => {
    const doc = await h.prisma.document.create({
      data: { ownerId: h.userId, title: 'Second thesis', entryPath: 'A_TOPIC' },
    });
    const source = await h.prisma.source.create({
      data: { documentId: doc.id, status: 'RESOLVED', title: 'Tank irrigation' },
    });
    expect((await send('POST', `/sources/${source.id}/highlights`, body())).status).toBe(201);

    const { DeletionService } = await import('../src/modules/account/deletion.service.js');
    await h.app.get(DeletionService).erase(h.userId);
    expect(await h.prisma.sourceHighlight.count({ where: { userId: h.userId } })).toBe(0);
  });
});
