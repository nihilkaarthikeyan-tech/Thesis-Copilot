/**
 * Jenni build plan R36 (ADR-0115) — "How was this?" after a build.
 *
 * Pinned on the real application: a finished chapter build and a viva question set are rated up
 * or down with a one-line note, the run's own view returns the rating, answering again changes the
 * same row and `0` takes it back; an unfinished build, another thesis's run, another student and a
 * signed-out caller are refused; the superadmin reads them in the feedback inbox; and they go with
 * the thesis when it is deleted.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma } from '@tc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let otherDocumentId: string;
let doneBuild: string;
let runningBuild: string;
let otherBuild: string;
let vivaSet: string;
let strangerCookie = '';

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

const rate = (cookie: string | null, path: string, body: unknown) =>
  call(cookie, path, { method: 'PUT', body: JSON.stringify(body) });
const buildPath = (doc: string, build: string) =>
  `/documents/${doc}/ratings/chapter-build/${build}`;

async function build(doc: string, chapter: string, status: string): Promise<string> {
  const row = await h.prisma.chapterBuild.create({
    data: {
      documentId: doc,
      chapterId: chapter,
      userId: h.userId,
      status,
      profile: {
        disciplineId: 'general',
        paradigm: 'experimental',
        universityId: 'generic',
      } as Prisma.InputJsonValue,
      ...(status === 'DONE' ? { finishedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  return row.id;
}

async function thesis(title: string): Promise<{ id: string; firstChapterId: string }> {
  const res = await call(h.cookie, '/documents', {
    method: 'POST',
    body: JSON.stringify({ title, entryPath: 'A_TOPIC' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; firstChapterId: string };
}

beforeAll(async () => {
  h = await startHarness('rating-owner@example.com');
  const mine = await thesis('Fly ash bricks in rural housing');
  documentId = mine.id;
  chapterId = mine.firstChapterId;
  const other = await thesis('Millet procurement in Odisha');
  otherDocumentId = other.id;

  // Runs as the worker and the viva service leave them: a finished build, one still running, a
  // finished build of the other thesis, and one question of a viva set.
  doneBuild = await build(documentId, chapterId, 'DONE');
  runningBuild = await build(documentId, chapterId, 'RUNNING');
  otherBuild = await build(otherDocumentId, other.firstChapterId, 'DONE');
  vivaSet = randomUUID();
  await h.prisma.vivaQuestion.create({
    data: {
      documentId,
      setId: vivaSet,
      order: 1,
      kind: 'Methods',
      question: 'Why were the bricks cured for fourteen days rather than twenty-eight?',
      probing: 'Whether the curing period was chosen or inherited.',
      chapterId,
      passage: 'The bricks were cured for fourteen days.',
      from: 1,
      to: 40,
    },
  });
  strangerCookie = await signIn('rating-stranger@example.com');
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('rating a chapter build', () => {
  it('stores thumbs up with a line, and the build view returns it', async () => {
    const res = await rate(h.cookie, buildPath(documentId, doneBuild), {
      rating: 1,
      note: 'The methods section read like my own.',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rating: 1, note: 'The methods section read like my own.' });

    const view = (await (
      await call(h.cookie, `/documents/${documentId}/chapter-build/${doneBuild}`)
    ).json()) as { rating: unknown };
    expect(view.rating).toEqual({ value: 1, note: 'The methods section read like my own.' });

    const rows = await h.prisma.outputRating.findMany();
    expect(rows.map((r) => [r.kind, r.runId, r.userId, r.documentId, r.rating])).toEqual([
      ['CHAPTER_BUILD', doneBuild, h.userId, documentId, 1],
    ]);
  });

  it('a second answer changes the same row, with line breaks folded', async () => {
    const res = await rate(h.cookie, buildPath(documentId, doneBuild), {
      rating: -1,
      note: 'Two sections\nrepeat each other.',
    });
    expect(await res.json()).toEqual({ rating: -1, note: 'Two sections repeat each other.' });
    expect(await h.prisma.outputRating.count()).toBe(1);
  });

  it('0 takes it back, note and all', async () => {
    const res = await rate(h.cookie, buildPath(documentId, doneBuild), { rating: 0 });
    expect(await res.json()).toEqual({ rating: null, note: null });
    expect(await h.prisma.outputRating.count()).toBe(0);
    const view = (await (
      await call(h.cookie, `/documents/${documentId}/chapter-build/${doneBuild}`)
    ).json()) as { rating: unknown };
    expect(view.rating).toBeNull();
  });

  it('refuses a build still running, another thesis’s build, another student and no session', async () => {
    expect((await rate(h.cookie, buildPath(documentId, runningBuild), { rating: 1 })).status).toBe(
      409,
    );
    // The other thesis's build, asked for under this thesis.
    expect((await rate(h.cookie, buildPath(documentId, otherBuild), { rating: 1 })).status).toBe(
      404,
    );
    expect(
      (await rate(strangerCookie, buildPath(documentId, doneBuild), { rating: 1 })).status,
    ).toBe(404);
    expect((await rate(null, buildPath(documentId, doneBuild), { rating: 1 })).status).toBe(401);
    expect(
      (
        await rate(h.cookie, `/documents/${documentId}/ratings/proposal/${doneBuild}`, {
          rating: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await rate(h.cookie, `/documents/${documentId}/ratings/chapter-build/not-an-id`, {
          rating: 1,
        })
      ).status,
    ).toBe(404);
    expect(await h.prisma.outputRating.count()).toBe(0);
  });

  it('refuses a rating that is not a thumb and a note longer than one line allows', async () => {
    expect((await rate(h.cookie, buildPath(documentId, doneBuild), { rating: 5 })).status).toBe(
      400,
    );
    expect(
      (await rate(h.cookie, buildPath(documentId, doneBuild), { rating: 1, note: 'x'.repeat(201) }))
        .status,
    ).toBe(400);
    expect(await h.prisma.outputRating.count()).toBe(0);
  });
});

describe('rating a viva question set', () => {
  it('stores it against the set, and the viva view returns it', async () => {
    const res = await rate(h.cookie, `/documents/${documentId}/ratings/viva/${vivaSet}`, {
      rating: 1,
    });
    expect(await res.json()).toEqual({ rating: 1, note: null });
    const view = (await (await call(h.cookie, `/documents/${documentId}/viva`)).json()) as {
      setId: string;
      rating: unknown;
    };
    expect(view.setId).toBe(vivaSet);
    expect(view.rating).toEqual({ value: 1, note: null });
    // A set of another thesis is not this one's to rate.
    expect(
      (await rate(h.cookie, `/documents/${otherDocumentId}/ratings/viva/${vivaSet}`, { rating: 1 }))
        .status,
    ).toBe(404);
  });
});

describe('the superadmin’s list, and deletion', () => {
  it('lists the ratings with the counts for a superadmin, and refuses a student', async () => {
    await rate(h.cookie, buildPath(documentId, doneBuild), {
      rating: -1,
      note: 'Too few sources in 2.3.',
    });
    expect((await call(h.cookie, '/admin/feedback/ratings')).status).toBe(403);

    await h.prisma.user.update({ where: { id: h.userId }, data: { role: 'SUPERADMIN' } });
    const res = await call(h.cookie, '/admin/feedback/ratings');
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      rows: Array<{
        kind: string;
        rating: number;
        note: string | null;
        userEmail: string | null;
        documentTitle: string | null;
      }>;
      total: number;
      useful: number;
      notUseful: number;
    };
    expect(page.total).toBe(2);
    expect({ useful: page.useful, notUseful: page.notUseful }).toEqual({ useful: 1, notUseful: 1 });
    expect(page.rows.map((r) => [r.kind, r.rating, r.note, r.userEmail, r.documentTitle])).toEqual([
      [
        'CHAPTER_BUILD',
        -1,
        'Too few sources in 2.3.',
        'rating-owner@example.com',
        'Fly ash bricks in rural housing',
      ],
      ['VIVA', 1, null, 'rating-owner@example.com', 'Fly ash bricks in rural housing'],
    ]);
    await h.prisma.user.update({ where: { id: h.userId }, data: { role: 'STUDENT' } });
  });

  it('the ratings go with their thesis when it is deleted', async () => {
    expect((await call(h.cookie, `/documents/${documentId}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    expect(await h.prisma.outputRating.count()).toBe(0);
  });
});
