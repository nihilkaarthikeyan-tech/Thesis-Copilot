/**
 * ADR-0057 — the roles screen: Guide (comments), Co-author (edits live), Reader (reads).
 *
 * What is pinned: a Reader can open the thesis and read a chapter and nothing else — no comment,
 * not even anyone else's comments; the owner can change a role and it takes effect on the next
 * request; only the owner can change or revoke one; and a revoked person gets the 404 a thesis
 * that does not exist gives.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flagsFor, requestedRole, roleOf } from '../src/modules/feedback/share-roles.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;

function call(cookie: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${h.baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      origin: 'http://localhost:3000',
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
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
  expect(signedIn.status, `sign-in for ${email}`).toBe(200);
  return (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const owner = (path: string, init?: RequestInit) => call(h.cookie, path, init);

type Share = { id: string; guideEmail: string; role: string; canEdit: boolean; url: string };

describe('share roles, pure', () => {
  it('maps each role to its flags and back', () => {
    for (const role of ['GUIDE', 'COAUTHOR', 'READER'] as const) {
      expect(roleOf(flagsFor(role))).toBe(role);
    }
    expect(flagsFor('READER')).toEqual({ canEdit: false, canComment: false });
    expect(flagsFor('COAUTHOR')).toEqual({ canEdit: true, canComment: true });
  });

  it('keeps the pre-ADR-0057 checkbox meaning what it meant', () => {
    expect(requestedRole({ canEdit: true })).toBe('COAUTHOR');
    expect(requestedRole({ canEdit: false })).toBe('GUIDE');
    expect(requestedRole({})).toBe('GUIDE');
    expect(requestedRole({ role: 'READER', canEdit: true })).toBe('READER');
  });
});

describe('share roles, through the API', () => {
  let readerCookie: string;
  let strangerCookie: string;
  let share: Share;

  beforeAll(async () => {
    h = await startHarness('share-roles-owner@example.com');
    const created = await owner('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Roles Thesis', entryPath: 'A_TOPIC' }),
    });
    const document = (await created.json()) as { id: string; firstChapterId: string };
    documentId = document.id;
    chapterId = document.firstChapterId;
    readerCookie = await signIn('reader@example.ac.in');
    strangerCookie = await signIn('stranger@example.ac.in');

    const made = await owner(`/documents/${documentId}/feedback/shares`, {
      method: 'POST',
      body: JSON.stringify({ guideEmail: 'reader@example.ac.in', role: 'READER' }),
    });
    expect(made.status).toBe(200);
    share = (await made.json()) as Share;
  }, 180_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('lists the person with their role', async () => {
    expect(share.role).toBe('READER');
    expect(share.canEdit).toBe(false);
    const list = (await (
      await owner(`/documents/${documentId}/feedback/shares`)
    ).json()) as Share[];
    expect(list.map((s) => [s.guideEmail, s.role])).toEqual([['reader@example.ac.in', 'READER']]);
  });

  it('lets a Reader open the thesis and read a chapter', async () => {
    const token = share.url.split('/guide/')[1] as string;
    const accepted = await call(readerCookie, `/guide/accept/${token}`, {
      method: 'POST',
      body: '{}',
    });
    expect(accepted.status).toBe(200);
    const view = (await accepted.json()) as { role: string; canComment: boolean };
    expect(view.role).toBe('READER');
    expect(view.canComment).toBe(false);
    const chapter = await call(
      readerCookie,
      `/guide/documents/${documentId}/chapters/${chapterId}`,
    );
    expect(chapter.status).toBe(200);
  });

  it('refuses a Reader every comment route, reading and writing', async () => {
    const write = await call(readerCookie, `/documents/${documentId}/feedback/comments`, {
      method: 'POST',
      body: JSON.stringify({ chapterId, body: 'I should not be able to say this.' }),
    });
    expect(write.status).toBe(403);
    const read = await call(readerCookie, `/documents/${documentId}/feedback/comments`);
    expect(read.status).toBe(403);
    const counts = await call(readerCookie, `/documents/${documentId}/feedback/comments/counts`);
    expect(counts.status).toBe(403);
    expect(await h.prisma.comment.count({ where: { documentId } })).toBe(0);
  });

  it('cannot reach the chapter through the owner’s own route, or write it', async () => {
    expect((await call(readerCookie, `/chapters/${chapterId}`)).status).toBe(404);
    const write = await call(readerCookie, `/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({ content: { type: 'doc', content: [] }, baseVersion: 1 }),
    });
    expect(write.status).toBe(404);
  });

  it('only the owner can change a role or revoke', async () => {
    for (const cookie of [readerCookie, strangerCookie]) {
      const change = await call(cookie, `/documents/${documentId}/feedback/shares/${share.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: 'COAUTHOR' }),
      });
      expect(change.status).toBe(404);
      const revoke = await call(cookie, `/documents/${documentId}/feedback/shares/${share.id}`, {
        method: 'DELETE',
      });
      expect(revoke.status).toBe(404);
    }
    const row = await h.prisma.guideShare.findUniqueOrThrow({ where: { id: share.id } });
    expect(roleOf(row)).toBe('READER');
  });

  it('a role the owner changes takes effect on the next request', async () => {
    const changed = await owner(`/documents/${documentId}/feedback/shares/${share.id}`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'GUIDE' }),
    });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as Share).role).toBe('GUIDE');

    const write = await call(readerCookie, `/documents/${documentId}/feedback/comments`, {
      method: 'POST',
      body: JSON.stringify({ chapterId, body: 'Now I may comment.' }),
    });
    expect(write.status).toBe(200);

    const back = await owner(`/documents/${documentId}/feedback/shares/${share.id}`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'READER' }),
    });
    expect(back.status).toBe(200);
    expect((await call(readerCookie, `/documents/${documentId}/feedback/comments`)).status).toBe(
      403,
    );
  });

  it('refuses a role that does not exist', async () => {
    const bad = await owner(`/documents/${documentId}/feedback/shares/${share.id}`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'OWNER' }),
    });
    expect(bad.status).toBe(400);
  });

  it('a revoked person gets the thesis-does-not-exist answer', async () => {
    const revoked = await owner(`/documents/${documentId}/feedback/shares/${share.id}`, {
      method: 'DELETE',
    });
    expect(revoked.status).toBe(200);
    expect((await call(readerCookie, `/guide/documents/${documentId}`)).status).toBe(404);
    expect(
      (await call(readerCookie, `/guide/documents/${documentId}/chapters/${chapterId}`)).status,
    ).toBe(404);
  });
});
