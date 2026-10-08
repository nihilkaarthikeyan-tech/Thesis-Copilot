/**
 * Jenni build plan R29 (ADR-0114) — archive and restore a thesis.
 *
 * Pinned on the real application: archiving takes a thesis off `GET /documents` (the list and the
 * Chrome add-on's picker) and onto `?archived=1`, deletes nothing, leaves its date and place on
 * the list alone, keeps a guide's share working and the thesis openable by its link; restoring
 * puts it back where it was; only the owner can do either; a copy of an archived thesis is on the
 * list as "… (copy)"; and an archived thesis can still be deleted for good.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let older: string;
let newer: string;
let strangerCookie = '';
let guideCookie = '';

type Summary = { id: string; title: string; updatedAt: string; archivedAt: string | null };

function call(cookie: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${h.baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      origin: 'http://localhost:3000',
      ...(cookie ? { cookie } : {}),
    },
  });
}

async function signIn(email: string): Promise<string> {
  await call(null, '/auth/email-otp/send-verification-otp', {
    method: 'POST',
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const { otp } = (await (
    await call(null, `/auth/dev/last-otp?email=${encodeURIComponent(email)}`)
  ).json()) as { otp: string };
  const signedIn = await call(null, '/auth/sign-in/email-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });
  return (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const owner = (path: string, init?: RequestInit) => call(h.cookie, path, init);
const list = async (query = '') => (await (await owner(`/documents${query}`)).json()) as Summary[];
const post = (cookie: string | null, path: string) =>
  call(cookie, path, { method: 'POST', body: '{}' });

async function create(title: string): Promise<string> {
  const res = await owner('/documents', {
    method: 'POST',
    body: JSON.stringify({ title, entryPath: 'A_TOPIC' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeAll(async () => {
  h = await startHarness('archive-owner@example.com');
  older = await create('Groundwater recharge in hard-rock aquifers');
  newer = await create('Women’s self-help groups and microcredit in Tamil Nadu');
  // A clear difference in last-edited time, so the list's order is a fact rather than a race.
  await h.prisma.document.update({
    where: { id: older },
    data: { updatedAt: new Date('2026-09-01T00:00:00Z') },
  });
  strangerCookie = await signIn('archive-stranger@example.com');

  // A guide with a share on the thesis that will be archived.
  const share = (await (
    await owner(`/documents/${newer}/feedback/shares`, {
      method: 'POST',
      body: JSON.stringify({ guideEmail: 'archive-guide@example.ac.in' }),
    })
  ).json()) as { id: string };
  const { token } = await h.prisma.guideShare.findUniqueOrThrow({ where: { id: share.id } });
  guideCookie = await signIn('archive-guide@example.ac.in');
  expect((await call(guideCookie, `/guide/accept/${token}`, { method: 'POST' })).status).toBe(200);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('archiving a thesis', () => {
  it('takes it off the list and onto the archive, deleting nothing', async () => {
    const before = await h.prisma.document.findUniqueOrThrow({
      where: { id: newer },
      include: { chapters: true, memory: true },
    });
    expect((await list()).map((d) => d.id)).toEqual([newer, older]);

    const res = await post(h.cookie, `/documents/${newer}/archive`);
    expect(res.status).toBe(200);
    const state = (await res.json()) as { id: string; archivedAt: string | null };
    expect(state.id).toBe(newer);
    expect(state.archivedAt).not.toBeNull();

    expect((await list()).map((d) => d.id)).toEqual([older]);
    const archived = await list('?archived=1');
    expect(archived.map((d) => [d.id, d.archivedAt])).toEqual([[newer, state.archivedAt]]);

    // Nothing touched: the row, its chapters, its memory and its last-edited time.
    const after = await h.prisma.document.findUniqueOrThrow({
      where: { id: newer },
      include: { chapters: true, memory: true },
    });
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    expect(after.chapters.map((c) => c.id)).toEqual(before.chapters.map((c) => c.id));
    expect(after.memory).toEqual(before.memory);

    const audit = await h.prisma.auditEvent.findMany({ where: { kind: 'DOCUMENT_ARCHIVED' } });
    expect(audit.map((a) => [a.documentId, a.userId, a.actorId])).toEqual([
      [newer, h.userId, null],
    ]);
  });

  it('a second archive keeps the first date and writes no second audit line', async () => {
    const first = (await list('?archived=1'))[0]?.archivedAt;
    const again = (await (await post(h.cookie, `/documents/${newer}/archive`)).json()) as {
      archivedAt: string;
    };
    expect(again.archivedAt).toBe(first);
    expect(await h.prisma.auditEvent.count({ where: { kind: 'DOCUMENT_ARCHIVED' } })).toBe(1);
  });

  it('still opens by its link, and a guide’s share still works', async () => {
    const detail = await owner(`/documents/${newer}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as Summary).archivedAt).not.toBeNull();
    expect((await call(guideCookie, `/guide/documents/${newer}`)).status).toBe(200);
  });

  it('only the owner can archive or restore', async () => {
    expect((await post(strangerCookie, `/documents/${older}/archive`)).status).toBe(404);
    expect((await post(strangerCookie, `/documents/${newer}/restore`)).status).toBe(404);
    expect((await post(null, `/documents/${older}/archive`)).status).toBe(401);
    expect(
      (await (await call(strangerCookie, '/documents?archived=1')).json()) as unknown[],
    ).toEqual([]);
    expect((await list()).map((d) => d.id)).toEqual([older]);
  });

  it('a copy of an archived thesis is on the list, named "… (copy)"', async () => {
    const res = await post(h.cookie, `/documents/${newer}/copy`);
    expect(res.status).toBe(200);
    const copy = (await res.json()) as { id: string; title: string };
    expect(copy.title).toBe('Women’s self-help groups and microcredit in Tamil Nadu (copy)');
    const listed = await list();
    expect(listed.map((d) => d.id)).toContain(copy.id);
    expect(listed.find((d) => d.id === copy.id)?.archivedAt).toBeNull();
    // Out of the way of the order checks below.
    expect((await call(h.cookie, `/documents/${copy.id}`, { method: 'DELETE' })).status).toBe(200);
  });
});

describe('restoring a thesis', () => {
  it('puts it back where it was on the list, its last-edited time unchanged', async () => {
    const before = await h.prisma.document.findUniqueOrThrow({ where: { id: newer } });
    const res = await post(h.cookie, `/documents/${newer}/restore`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { archivedAt: string | null }).archivedAt).toBeNull();

    expect((await list()).map((d) => d.id)).toEqual([newer, older]);
    expect(await list('?archived=1')).toEqual([]);
    const after = await h.prisma.document.findUniqueOrThrow({ where: { id: newer } });
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    expect(await h.prisma.auditEvent.count({ where: { kind: 'DOCUMENT_RESTORED' } })).toBe(1);

    // Restoring a thesis on the list is a no-op, not an error.
    expect((await post(h.cookie, `/documents/${newer}/restore`)).status).toBe(200);
    expect(await h.prisma.auditEvent.count({ where: { kind: 'DOCUMENT_RESTORED' } })).toBe(1);
  });

  it('an archived thesis can still be deleted for good', async () => {
    expect((await post(h.cookie, `/documents/${older}/archive`)).status).toBe(200);
    expect((await call(h.cookie, `/documents/${older}`, { method: 'DELETE' })).status).toBe(200);
    expect(await list('?archived=1')).toEqual([]);
    expect(await h.prisma.document.findUnique({ where: { id: older } })).toBeNull();
  });
});
