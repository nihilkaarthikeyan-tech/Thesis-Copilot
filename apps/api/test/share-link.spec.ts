/**
 * ADR-0057 — "anyone with the link can read".
 *
 * Pinned: the link is off until the owner turns it on; it reads without a session and gives the
 * text and nothing else (no e-mail, no comments, no sources, no stored JSON); it cannot write
 * anything; turning it off — or making a new one — kills the old URL at once; only a hash is
 * stored; only the owner can manage it; every change is audited; and the public route is
 * rate-limited per IP.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyRequest, HEAVY_RATE_LIMITS } from '../src/common/rate-limit.js';
import { readBlocks } from '../src/modules/feedback/read-view.js';
import {
  hashToken,
  isTokenShaped,
  newToken,
  sameDigest,
} from '../src/modules/feedback/share-link.service.js';
import { type Harness, startHarness } from './_harness.js';

const OWNER = 'share-link-owner@example.com';
const SECRET_PHRASE = 'A pending suggestion that is not thesis text yet.';

const CHAPTER = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Background' }] },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Solar dryers cut spoilage in coastal fisheries.',
          marks: [{ type: 'provenance', attrs: { kind: 'HUMAN' } }],
        },
        {
          type: 'citation',
          attrs: { nodeKey: 'c1', sourceId: '00000000-0000-0000-0000-000000000000' },
        },
      ],
    },
    {
      type: 'draftBlock',
      attrs: { status: 'pending' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: SECRET_PHRASE }] }],
    },
  ],
};

describe('the link, pure', () => {
  it('makes 256-bit tokens of one fixed shape', () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(isTokenShaped(a)).toBe(true);
    expect(isTokenShaped(`${a}x`)).toBe(false);
    expect(isTokenShaped('../../etc/passwd')).toBe(false);
  });

  it('compares digests in constant time and only full ones', () => {
    const digest = hashToken('x');
    expect(sameDigest(digest, hashToken('x'))).toBe(true);
    expect(sameDigest(digest, hashToken('y'))).toBe(false);
    expect(sameDigest(digest, '')).toBe(false);
  });

  it('reads a chapter as text, without pending drafts or citation internals', () => {
    const blocks = readBlocks(CHAPTER);
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Background' },
      { kind: 'paragraph', text: 'Solar dryers cut spoilage in coastal fisheries.' },
    ]);
    const accepted = readBlocks({
      type: 'doc',
      content: [{ ...CHAPTER.content[2], attrs: { status: 'accepted' } }],
    });
    expect(accepted).toEqual([{ kind: 'paragraph', text: SECRET_PHRASE }]);
  });

  it('rate-limits the public route as its own kind, tighter than the general rule', () => {
    expect(classifyRequest('GET', '/api/v1/read/abc')?.heavy).toBe('link');
    expect(classifyRequest('GET', '/api/v1/read/abc/chapters/def')?.heavy).toBe('link');
    expect(HEAVY_RATE_LIMITS.link.max).toBeLessThan(600);
  });
});

describe('the link, through the API', () => {
  let h: Harness;
  let documentId: string;
  let chapterId: string;
  let otherCookie: string;

  const anonymous = (path: string, init: RequestInit = {}) =>
    fetch(`${h.baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        origin: 'http://localhost:3000',
        ...(init.headers ?? {}),
      },
    });
  const as = (cookie: string, path: string, init: RequestInit = {}) =>
    anonymous(path, { ...init, headers: { cookie, ...(init.headers ?? {}) } });
  const owner = (path: string, init: RequestInit = {}) => as(h.cookie, path, init);
  const tokenOf = (url: string) => url.split('/read/')[1] as string;

  beforeAll(async () => {
    h = await startHarness(OWNER);
    const created = await owner('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Linked Thesis', entryPath: 'A_TOPIC' }),
    });
    const document = (await created.json()) as { id: string; firstChapterId: string };
    documentId = document.id;
    chapterId = document.firstChapterId;
    const current = (await (await owner(`/chapters/${chapterId}`)).json()) as { version: number };
    const saved = await owner(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({ content: CHAPTER, baseVersion: current.version }),
    });
    expect(saved.status).toBe(200);

    // A second account, to prove the owner-only rule.
    const email = 'share-link-other@example.com';
    await anonymous('/auth/email-otp/send-verification-otp', {
      method: 'POST',
      body: JSON.stringify({ email, type: 'sign-in' }),
    });
    const { otp } = (await (
      await anonymous(`/auth/dev/last-otp?email=${encodeURIComponent(email)}`)
    ).json()) as { otp: string };
    const signedIn = await anonymous('/auth/sign-in/email-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    });
    otherCookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }, 180_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('is off by default', async () => {
    const status = (await (await owner(`/documents/${documentId}/feedback/link`)).json()) as {
      enabled: boolean;
    };
    expect(status.enabled).toBe(false);
    expect(await h.prisma.shareLink.count()).toBe(0);
  });

  it('only the owner can see, make or remove it', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const res = await as(otherCookie, `/documents/${documentId}/feedback/link`, { method });
      expect(res.status, method).toBe(404);
      const signedOut = await anonymous(`/documents/${documentId}/feedback/link`, { method });
      expect(signedOut.status, `${method} signed out`).toBe(401);
    }
    expect(await h.prisma.shareLink.count()).toBe(0);
  });

  it('reads without a session: the text, and nothing that identifies the student', async () => {
    const made = await owner(`/documents/${documentId}/feedback/link`, { method: 'POST' });
    expect(made.status).toBe(200);
    const { url } = (await made.json()) as { url: string };
    const token = tokenOf(url);
    expect(isTokenShaped(token)).toBe(true);

    // Only the hash is stored.
    const row = await h.prisma.shareLink.findUniqueOrThrow({ where: { documentId } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);

    const doc = await anonymous(`/read/${token}`);
    expect(doc.status).toBe(200);
    const docText = await doc.text();
    expect(JSON.parse(docText)).toMatchObject({ title: 'Linked Thesis' });
    expect(docText).not.toContain(OWNER);
    expect(docText).not.toContain('ownerId');

    const chapter = await anonymous(`/read/${token}/chapters/${chapterId}`);
    expect(chapter.status).toBe(200);
    const chapterText = await chapter.text();
    expect(chapterText).toContain('Solar dryers cut spoilage');
    expect(chapterText).not.toContain(SECRET_PHRASE);
    expect(chapterText).not.toContain('provenance');
    expect(chapterText).not.toContain('sourceId');
    expect(chapterText).not.toContain(OWNER);

    const after = await h.prisma.shareLink.findUniqueOrThrow({ where: { documentId } });
    expect(after.views).toBe(1);
    expect(after.lastViewedAt).not.toBeNull();
  });

  it('cannot write: no route takes the token, and the owner’s routes still want the owner', async () => {
    const { url } = (await (
      await owner(`/documents/${documentId}/feedback/link`, { method: 'POST' })
    ).json()) as { url: string };
    const token = tokenOf(url);
    const before = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await anonymous(`/read/${token}/chapters/${chapterId}`, {
        method,
        body: JSON.stringify({ content: { type: 'doc', content: [] } }),
      });
      expect(res.status, method).toBe(404);
      const top = await anonymous(`/read/${token}`, { method, body: '{}' });
      expect(top.status, `${method} top`).toBe(404);
    }
    // The token is not a session: the routes that do write answer as to a stranger.
    const write = await anonymous(`/chapters/${chapterId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: { type: 'doc', content: [] }, baseVersion: before.version }),
    });
    expect(write.status).toBe(401);
    const comment = await anonymous(`/documents/${documentId}/feedback/comments`, {
      method: 'POST',
      body: JSON.stringify({ chapterId, body: 'From a link.' }),
    });
    expect(comment.status).toBe(401);

    const after = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(after.version).toBe(before.version);
    expect(after.content).toEqual(before.content);
    expect(await h.prisma.comment.count({ where: { documentId } })).toBe(0);
  });

  it('a chapter of another thesis is not reachable through this link', async () => {
    const { url } = (await (
      await owner(`/documents/${documentId}/feedback/link`, { method: 'POST' })
    ).json()) as { url: string };
    const other = await as(otherCookie, '/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Someone Else', entryPath: 'A_TOPIC' }),
    });
    const { firstChapterId } = (await other.json()) as { firstChapterId: string };
    expect((await anonymous(`/read/${tokenOf(url)}/chapters/${firstChapterId}`)).status).toBe(404);
    expect((await anonymous(`/read/${tokenOf(url)}/chapters/not-a-uuid`)).status).toBe(404);
  });

  it('a new link kills the old one, and turning it off kills the new one', async () => {
    const first = tokenOf(
      (
        (await (
          await owner(`/documents/${documentId}/feedback/link`, { method: 'POST' })
        ).json()) as {
          url: string;
        }
      ).url,
    );
    expect((await anonymous(`/read/${first}`)).status).toBe(200);

    const second = tokenOf(
      (
        (await (
          await owner(`/documents/${documentId}/feedback/link`, { method: 'POST' })
        ).json()) as {
          url: string;
        }
      ).url,
    );
    expect(second).not.toBe(first);
    expect((await anonymous(`/read/${first}`)).status).toBe(404);
    expect((await anonymous(`/read/${first}/chapters/${chapterId}`)).status).toBe(404);
    expect((await anonymous(`/read/${second}`)).status).toBe(200);

    const off = await owner(`/documents/${documentId}/feedback/link`, { method: 'DELETE' });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { enabled: boolean }).enabled).toBe(false);
    expect((await anonymous(`/read/${second}`)).status).toBe(404);
    expect((await anonymous(`/read/${second}/chapters/${chapterId}`)).status).toBe(404);
    expect(await h.prisma.shareLink.count({ where: { documentId } })).toBe(0);
  });

  it('records each change in the audit log', async () => {
    const events = await h.prisma.auditEvent.findMany({
      where: { documentId, kind: { in: ['SHARE_LINK_ON', 'SHARE_LINK_OFF'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.kind)).toContain('SHARE_LINK_ON');
    expect(events.at(-1)?.kind).toBe('SHARE_LINK_OFF');
    expect(events.every((e) => e.userId === h.userId)).toBe(true);
  });

  it('a malformed or unknown token is the same 404', async () => {
    expect((await anonymous('/read/short')).status).toBe(404);
    expect((await anonymous(`/read/${newToken()}`)).status).toBe(404);
  });

  it('erasing the thesis removes its link', async () => {
    const res = await owner(`/documents/${documentId}/feedback/link`, { method: 'POST' });
    expect(res.status).toBe(200);
    const removed = await owner(`/documents/${documentId}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await h.prisma.shareLink.count({ where: { documentId } })).toBe(0);
  });

  // Last: it uses up this IP's link allowance for the minute.
  it('limits how fast one address can try links', async () => {
    let limited = false;
    for (let i = 0; i < HEAVY_RATE_LIMITS.link.max + 5 && !limited; i++) {
      limited = (await anonymous(`/read/${newToken()}`)).status === 429;
    }
    expect(limited).toBe(true);
  });
});
