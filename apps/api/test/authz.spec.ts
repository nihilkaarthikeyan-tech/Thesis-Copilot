/**
 * Authorisation and the AI rate limit — PRD §12.1, PHASES 5.4.
 *
 *   "user A cannot read/write user B's document, chapter, source, or export (assert 404, not
 *    403, to avoid enumeration). Rate limits on auth and AI endpoints (assert 429)."
 *
 * User A owns everything; user B is signed in through the same OTP flow and tries each route with
 * A's ids. Every answer must be 404 — the same answer an id that never existed would get — so the
 * ids leak nothing. A's own calls are the control that the routes work.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AI_RATE_LIMIT } from '../src/common/rate-limit.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let cookieB = '';
let documentId: string;
let chapterId: string;
let sourceId: string;
let seedPaperId: string;

/** The harness signs one user in; the second goes through the same door. */
async function signIn(email: string): Promise<string> {
  const spy = vi.spyOn(console, 'log');
  const sent = await h.api('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    headers: { cookie: '' },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  expect(sent.status).toBe(200);
  const line = spy.mock.calls
    .map((call) => call.join(' '))
    .find((text) => text.includes(`one-time code for ${email}`));
  spy.mockRestore();
  const otp = /:\s*(\d{6})/.exec(line ?? '')?.[1];
  expect(otp).toBeTruthy();
  const signedIn = await h.api('/auth/sign-in/email-otp', {
    method: 'POST',
    headers: { cookie: '' },
    body: JSON.stringify({ email, otp }),
  });
  expect(signedIn.status).toBe(200);
  return (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const asB = (path: string, init: RequestInit = {}) =>
  h.api(path, { ...init, headers: { ...(init.headers ?? {}), cookie: cookieB } });

beforeAll(async () => {
  h = await startHarness('owner-a@example.com');
  cookieB = await signIn('intruder-b@example.com');

  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Owned by A', entryPath: 'B_PAPER' }),
  });
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  chapterId = document.firstChapterId;

  const source = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title: 'A private paper',
      year: 2020,
      fileKey: 'sources/private.pdf',
    },
  });
  sourceId = source.id;
  const seedPaper = await h.prisma.seedPaper.create({
    data: { documentId, status: 'PENDING', fileKey: 'none', filename: 'private.pdf' },
  });
  seedPaperId = seedPaper.id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('§12.1: another user’s resources answer 404, never 403', () => {
  const reads: Array<[string, string]> = [
    ['document', '/documents/{d}'],
    ['chapter', '/chapters/{c}'],
    ['chapter pins', '/chapters/{c}/pins'],
    ['document versions', '/documents/{d}/versions'],
    ['sources', '/documents/{d}/sources'],
    ['citation report', '/documents/{d}/citation-report'],
    ['viva questions', '/documents/{d}/viva'],
    ['seed papers', '/documents/{d}/seed-papers'],
    ['one seed paper', '/documents/{d}/seed-papers/{sp}'],
    ['source file', '/sources/{s}/file'],
  ];
  const fill = (path: string) =>
    path
      .replace('{d}', documentId)
      .replace('{c}', chapterId)
      .replace('{s}', sourceId)
      .replace('{sp}', seedPaperId);

  it.each(reads)('GET %s: the owner sees it, the other user gets 404', async (_name, path) => {
    const own = await h.api(fill(path));
    expect(own.status, `owner on ${path}`).not.toBe(404);
    const other = await asB(fill(path));
    expect(other.status, `other user on ${path}`).toBe(404);
    expect(((await other.json()) as { status: number }).status).toBe(404);
  });

  it('cannot save into A’s chapter', async () => {
    const response = await asB(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        baseVersion: 1,
      }),
    });
    expect(response.status).toBe(404);
    // Untouched: the version is still what A created.
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.version).toBe(1);
  });

  it('cannot pin, snapshot, or delete against A’s ids', async () => {
    const pins = await asB(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ sourceIds: [sourceId] }),
    });
    expect(pins.status).toBe(404);

    const snapshot = await asB(`/chapters/${chapterId}/snapshot`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'MANUAL' }),
    });
    expect(snapshot.status).toBe(404);

    // A body, because the harness sends a JSON content-type and Fastify refuses an empty one.
    const removed = await asB(`/sources/${sourceId}`, { method: 'DELETE', body: '{}' });
    expect(removed.status).toBe(404);
    expect(await h.prisma.source.findUnique({ where: { id: sourceId } })).not.toBeNull();
  });

  it('cannot export A’s chapter or usage log', async () => {
    const chapter = await asB(`/documents/${documentId}/export`, {
      method: 'POST',
      body: JSON.stringify({ chapterId, format: 'docx' }),
    });
    expect(chapter.status).toBe(404);

    const usage = await asB(`/documents/${documentId}/export/ai-usage-log`, {
      method: 'POST',
      body: JSON.stringify({ format: 'csv' }),
    });
    expect(usage.status).toBe(404);
  });

  it('cannot proofread A’s chapter, and is not charged for trying', async () => {
    const response = await asB('/proofread', {
      method: 'POST',
      body: JSON.stringify({ chapterId }),
    });
    expect(response.status).toBe(404);
    expect(await h.prisma.aiCallLog.count({ where: { documentId, action: 'COMMAND' } })).toBe(0);
  });

  it('cannot ask viva questions about A’s thesis or answer A’s, and is not charged', async () => {
    const asked = await asB(`/viva/${documentId}/questions`, { method: 'POST', body: '{}' });
    expect(asked.status).toBe(404);

    const question = await h.prisma.vivaQuestion.create({
      data: {
        documentId,
        setId: documentId,
        order: 0,
        kind: 'method',
        question: 'Why this sample?',
        probing: 'Sampling.',
        chapterId,
        passage: 'A passage.',
        from: 1,
        to: 10,
      },
    });
    const answered = await asB(`/viva/questions/${question.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer: 'An answer typed by somebody else entirely.' }),
    });
    expect(answered.status).toBe(404);
    expect(await h.prisma.aiCallLog.count({ where: { documentId, action: 'VIVA' } })).toBe(0);
    expect(
      (await h.prisma.vivaQuestion.findUniqueOrThrow({ where: { id: question.id } })).answer,
    ).toBeNull();
  });

  it('cannot use A’s chapter as grounding for a suggestion', async () => {
    const response = await asB('/citations/suggest', {
      method: 'POST',
      body: JSON.stringify({
        chapterId,
        sentence: 'Studies show that 78% of households cited cost as the main barrier.',
      }),
    });
    expect(response.status).toBe(404);
  });
});

describe('§12.1: the AI endpoints are rate limited', () => {
  // Last, because the window is per IP and the harness shares one.
  it(`answers 429 RATE_LIMITED after ${AI_RATE_LIMIT.max} AI requests in a minute`, async () => {
    // A sentence the claim heuristic declines: passes the rate-limit hook, never reaches the
    // provider or the cap, so the sixty-plus calls cost nothing but the counter.
    const body = JSON.stringify({ chapterId, sentence: 'This section examines cost barriers.' });
    // The limiter's window is the clock minute (`checkRateLimit`). A loop that straddles a minute
    // boundary starts the count again halfway and never reaches the limit — which is what failed
    // CI on 2026-09-25 (`first429` stayed -1). So start with the window at least 20 s from ending.
    const windowMs = AI_RATE_LIMIT.windowSeconds * 1000;
    const left = windowMs - (Date.now() % windowMs);
    if (left < 20_000) await new Promise((resolve) => setTimeout(resolve, left + 250));
    let first429 = -1;
    let retryAfter: string | null = null;
    for (let i = 0; i < AI_RATE_LIMIT.max + 5; i++) {
      const response = await h.api('/citations/suggest', { method: 'POST', body });
      if (response.status === 429) {
        first429 = i;
        retryAfter = response.headers.get('retry-after');
        expect(((await response.json()) as { type: string }).type).toBe('RATE_LIMITED');
        break;
      }
      expect(response.status).toBe(200);
    }
    // Earlier cases in this file spent a few of the sixty; the refusal lands at or before the cap.
    expect(first429).toBeGreaterThan(0);
    expect(first429).toBeLessThanOrEqual(AI_RATE_LIMIT.max);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('does not count outcome telemetry against the AI limit', async () => {
    // Still inside the same window: the AI limit is exhausted, telemetry goes through.
    const response = await h.api('/assist/outcome', {
      method: 'POST',
      body: JSON.stringify({
        suggestionId: '00000000-0000-7000-8000-000000000000',
        outcome: 'REJECTED',
      }),
    });
    expect(response.status).not.toBe(429);
  });
});
