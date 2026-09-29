/**
 * The superadmin's controls (2026-09-29, the owner's approved design), on the real application
 * with real Postgres, Redis and MinIO.
 *
 * What is worth proving here is the part a mock would hide: that an extra allowance really moves
 * the cap inside the one atomic statement, that a suspended account cannot get a session by any
 * route, that opening a thesis is logged and mails the student once per visit, and that deleting
 * a thesis leaves nothing behind in the bucket either.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ConsoleMailer, MAILER } from '../src/common/mailer.js';
import { StorageService } from '../src/common/storage.service.js';
import { periodFor, UsageService } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let mailer: ConsoleMailer;
let usage: UsageService;
let storage: StorageService;

const STUDENT = 'controls-student@example.com';

/** Signs `email` in through the OTP flow and returns the cookie, or the refusal. */
async function signIn(
  email: string,
): Promise<{ cookie: string } | { status: number; code?: string }> {
  const spy = vi.spyOn(console, 'log');
  await fetch(`${h.baseUrl}/api/v1/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const line = spy.mock.calls
    .map((call) => call.join(' '))
    .find((text) => text.includes(`one-time code for ${email}`));
  spy.mockRestore();
  const otp = /:\s*(\d{6})/.exec(line ?? '')?.[1];
  const response = await fetch(`${h.baseUrl}/api/v1/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    return { status: response.status, code: body.code };
  }
  return { cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
}

/**
 * As the student. A request without a body is sent without the JSON content type, as the web
 * client sends it: Fastify refuses an empty body that claims to be JSON.
 */
const asStudent = (cookie: string, path: string, init: RequestInit = {}) =>
  h.api(path, {
    ...init,
    headers: {
      cookie,
      ...(init.body ? {} : { 'content-type': 'text/plain' }),
      ...(init.headers ?? {}),
    },
  });

const post = (path: string, body: unknown = {}) =>
  h.api(path, { method: 'POST', body: JSON.stringify(body) });

async function waitFor<T>(read: () => T | undefined, ms = 5_000): Promise<T | undefined> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

let studentId: string;
let studentCookie: string;

beforeAll(async () => {
  h = await startHarness('controls-admin@example.com');
  mailer = h.app.get<ConsoleMailer>(MAILER);
  usage = h.app.get(UsageService);
  storage = h.app.get(StorageService);
  await h.prisma.user.update({ where: { id: h.userId }, data: { role: 'SUPERADMIN' } });
  const signedIn = await signIn(STUDENT);
  if (!('cookie' in signedIn)) throw new Error('the student could not sign in');
  studentCookie = signedIn.cookie;
  const student = await h.prisma.user.findUniqueOrThrow({ where: { email: STUDENT } });
  studentId = student.id;
  await h.prisma.user.update({ where: { id: studentId }, data: { name: 'Asha Menon' } });
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('extra allowance', () => {
  it('raises this month’s cap inside the atomic check, and is logged with the reason', async () => {
    await h.prisma.usageLedger.create({
      data: { userId: studentId, period: periodFor(), action: 'DRAFT', count: 2 },
    });
    expect((await usage.consume(studentId, 'FREE_TRIAL', 'DRAFT')).ok).toBe(false);

    const granted = await post(`/admin/users/${studentId}/allowance`, {
      grants: [{ action: 'DRAFT', units: 2 }],
      reason: 'Submission next week',
    });
    expect(granted.status).toBe(200);

    const first = await usage.consume(studentId, 'FREE_TRIAL', 'DRAFT');
    expect(first).toMatchObject({ ok: true, cap: 4, remaining: 1 });
    expect((await usage.consume(studentId, 'FREE_TRIAL', 'DRAFT')).ok).toBe(true);
    const refused = await usage.consume(studentId, 'FREE_TRIAL', 'DRAFT');
    expect(refused).toMatchObject({ ok: false, reason: 'cap', cap: 4 });

    const logged = await h.prisma.auditEvent.findFirst({
      where: { kind: 'ALLOWANCE_GRANTED', userId: studentId },
    });
    expect(logged?.actorId).toBe(h.userId);
    expect(logged?.detail).toMatchObject({
      action: 'DRAFT',
      units: 2,
      reason: 'Submission next week',
    });

    const meter = (await (await asStudent(studentCookie, '/usage/me')).json()) as {
      actions: Array<{ action: string; cap: number; used: number }>;
    };
    expect(meter.actions.find((a) => a.action === 'DRAFT')).toMatchObject({ cap: 4, used: 4 });
  });

  it('opens an action the plan gives none of, for exactly the units given', async () => {
    // FREE_TRIAL's consistency check cap is 0.
    expect((await usage.consume(studentId, 'FREE_TRIAL', 'COHERENCE')).ok).toBe(false);
    await post(`/admin/users/${studentId}/allowance`, {
      grants: [{ action: 'COHERENCE', units: 1 }],
      reason: 'Trying the check once',
    });
    expect((await usage.consume(studentId, 'FREE_TRIAL', 'COHERENCE')).ok).toBe(true);
    expect((await usage.consume(studentId, 'FREE_TRIAL', 'COHERENCE')).ok).toBe(false);
  });

  it('refuses an empty grant or one without a reason', async () => {
    expect(
      (await post(`/admin/users/${studentId}/allowance`, { grants: [], reason: 'x' })).status,
    ).toBe(400);
    expect(
      (
        await post(`/admin/users/${studentId}/allowance`, {
          grants: [{ action: 'ASSIST', units: 5 }],
          reason: '',
        })
      ).status,
    ).toBe(400);
  });
});

describe('suspension', () => {
  it('signs the student out, refuses a new sign-in with a reason, and undoes cleanly', async () => {
    expect((await asStudent(studentCookie, '/documents')).status).toBe(200);

    expect(
      (await post(`/admin/users/${studentId}/suspend`, { reason: 'Automated use' })).status,
    ).toBe(200);
    expect((await asStudent(studentCookie, '/documents')).status).toBe(401);

    const refused = await signIn(STUDENT);
    expect(refused).toMatchObject({ status: 403, code: 'ACCOUNT_SUSPENDED' });

    const listed = (await (await h.api('/admin/users?status=suspended')).json()) as {
      rows: Array<{ id: string; status: string }>;
    };
    expect(listed.rows.map((r) => r.id)).toContain(studentId);

    expect((await post(`/admin/users/${studentId}/unsuspend`)).status).toBe(200);
    const again = await signIn(STUDENT);
    expect('cookie' in again).toBe(true);
    if ('cookie' in again) studentCookie = again.cookie;

    const kinds = (
      await h.prisma.auditEvent.findMany({
        where: { userId: studentId, kind: { in: ['USER_SUSPENDED', 'USER_UNSUSPENDED'] } },
        select: { kind: true, actorId: true },
      })
    ).map((e) => [e.kind, e.actorId]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['USER_SUSPENDED', h.userId],
        ['USER_UNSUSPENDED', h.userId],
      ]),
    );
  });

  it('will not let an admin suspend or sign out their own account', async () => {
    expect(
      (await post(`/admin/users/${h.userId}/suspend`, { reason: 'Testing this' })).status,
    ).toBe(400);
    expect((await post(`/admin/users/${h.userId}/sign-out`)).status).toBe(400);
  });

  it('signs every device out on request', async () => {
    const response = await post(`/admin/users/${studentId}/sign-out`);
    expect(((await response.json()) as { sessions: number }).sessions).toBeGreaterThan(0);
    expect((await asStudent(studentCookie, '/documents')).status).toBe(401);
    const again = await signIn(STUDENT);
    if ('cookie' in again) studentCookie = again.cookie;
  });
});

describe('reading a thesis', () => {
  let documentId: string;
  let chapterId: string;

  beforeAll(async () => {
    const document = await h.prisma.document.create({
      data: { ownerId: studentId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
    });
    documentId = document.id;
    const source = await h.prisma.source.create({
      data: {
        documentId,
        title: 'Rooftop solar in India',
        year: 2016,
        authors: [{ family: 'Goel', given: 'M.' }],
      },
    });
    const chapter = await h.prisma.chapter.create({
      data: {
        documentId,
        outlineNodeId: 'n1',
        title: 'Introduction',
        order: 1,
        wordCount: 12,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Most of the target rests on households ' },
                { type: 'citation', attrs: { sourceId: source.id } },
              ],
            },
          ],
        },
      },
    });
    chapterId = chapter.id;
  });

  it('is logged every time and mails the student once per visit, not per refresh', async () => {
    const before = mailer.sent.length;
    const first = await h.api(`/admin/theses/${documentId}`);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ title: 'Rooftop solar in Karnataka', words: 12 });

    const mail = await waitFor(() =>
      mailer.sent.slice(before).find((m) => m.subject === 'An administrator viewed your thesis'),
    );
    expect(mail?.to).toEqual([STUDENT]);
    expect(mail?.text).toContain('Hi Asha,');
    expect(mail?.text).toContain('“Rooftop solar in Karnataka”');
    expect(mail?.text).toContain('cannot change anything');

    await h.api(`/admin/theses/${documentId}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      mailer.sent.slice(before).filter((m) => m.subject === 'An administrator viewed your thesis'),
    ).toHaveLength(1);
    expect(
      await h.prisma.auditEvent.count({
        where: { kind: 'THESIS_VIEWED', documentId, actorId: h.userId },
      }),
    ).toBe(2);
  });

  it('hands back a chapter with who is cited, and logs that it was read', async () => {
    const response = await h.api(`/admin/theses/${documentId}/chapters/${chapterId}`);
    const chapter = (await response.json()) as { citeLabels: Record<string, string> };
    expect(Object.values(chapter.citeLabels)).toEqual(['Goel, 2016']);
    expect(await h.prisma.auditEvent.count({ where: { kind: 'CHAPTER_VIEWED', documentId } })).toBe(
      1,
    );
  });

  it('is refused to a student, even for their own thesis', async () => {
    expect((await asStudent(studentCookie, `/admin/theses/${documentId}`)).status).toBe(403);
  });
});

describe('deleting a thesis', () => {
  async function thesisWithFiles(title: string) {
    const document = await h.prisma.document.create({
      data: { ownerId: studentId, title, entryPath: 'A_TOPIC' },
    });
    const figure = `figures/${document.id}/chart.png`;
    const snapshot = `versions/${document.id}/v1.json.gz`;
    await storage.put(figure, Buffer.from('png'));
    await storage.put(snapshot, Buffer.from('{}'));
    await h.prisma.documentVersion.create({
      data: { documentId: document.id, snapshotKey: snapshot, reason: 'MANUAL' },
    });
    await h.prisma.chapter.create({
      data: { documentId: document.id, outlineNodeId: 'n1', title: 'One', order: 1, content: {} },
    });
    return { id: document.id, figure, snapshot };
  }

  it('by an admin: rows and files gone, the student told why, the log says who', async () => {
    const thesis = await thesisWithFiles('Pilot: drip irrigation adoption');
    const before = mailer.sent.length;
    const response = await post(`/admin/theses/${thesis.id}/delete`, { reason: 'Spam content' });
    expect(response.status).toBe(200);

    expect(await h.prisma.document.count({ where: { id: thesis.id } })).toBe(0);
    expect(await h.prisma.chapter.count({ where: { documentId: thesis.id } })).toBe(0);
    expect(await storage.exists(thesis.figure)).toBe(false);
    expect(await storage.exists(thesis.snapshot)).toBe(false);

    const mail = await waitFor(() =>
      mailer.sent.slice(before).find((m) => m.subject.includes('deleted one of your theses')),
    );
    expect(mail?.text).toContain('Spam content');
    const logged = await h.prisma.auditEvent.findFirst({
      where: { kind: 'DOCUMENT_DELETED', documentId: thesis.id },
    });
    expect(logged).toMatchObject({ actorId: h.userId, userId: studentId });
  });

  it('by the student: their own only, and the same clean sweep', async () => {
    const thesis = await thesisWithFiles('A thesis to throw away');
    const mine = await h.prisma.document.create({
      data: { ownerId: h.userId, title: 'Not the student’s', entryPath: 'A_TOPIC' },
    });
    expect(
      (await asStudent(studentCookie, `/documents/${mine.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect(await h.prisma.document.count({ where: { id: mine.id } })).toBe(1);

    const response = await asStudent(studentCookie, `/documents/${thesis.id}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(200);
    expect(await h.prisma.document.count({ where: { id: thesis.id } })).toBe(0);
    expect(await storage.exists(thesis.figure)).toBe(false);
    expect(await storage.exists(thesis.snapshot)).toBe(false);
  });
});

describe('the read-outs', () => {
  it('the users list filters by search text', async () => {
    const page = (await (await h.api('/admin/users?q=controls-student')).json()) as {
      rows: Array<{ email: string }>;
      total: number;
    };
    expect(page.rows.map((r) => r.email)).toEqual([STUDENT]);
    expect((await h.api('/admin/users?status=nonsense')).status).toBe(400);
  });

  it('the activity log names the admin, and leaves out refused calls unless asked', async () => {
    const log = (await (await h.api('/admin/activity?q=controls-student')).json()) as {
      rows: Array<{ kind: string; actorEmail: string | null }>;
    };
    expect(
      log.rows.some(
        (r) => r.kind === 'USER_SUSPENDED' && r.actorEmail === 'controls-admin@example.com',
      ),
    ).toBe(true);
    expect(log.rows.some((r) => r.kind === 'CAP_EXCEEDED')).toBe(false);
    const refusals = (await (await h.api('/admin/activity?kind=CAP_EXCEEDED')).json()) as {
      rows: Array<{ kind: string }>;
    };
    expect(refusals.rows.length).toBeGreaterThan(0);
  });

  it('feedback can be read and marked answered, and the badge counts only unread', async () => {
    const document = await h.prisma.document.create({
      data: { ownerId: studentId, title: 'Feedback thesis', entryPath: 'A_TOPIC' },
    });
    const sent = await asStudent(studentCookie, '/feedback', {
      method: 'POST',
      body: JSON.stringify({ documentId: document.id, message: 'The export needs my cover page' }),
    });
    expect(sent.status).toBe(200);
    const unread = (await (await h.api('/admin/feedback?status=unread')).json()) as {
      rows: Array<{ id: string; message: string; userEmail: string }>;
    };
    const item = unread.rows.find((r) => r.message === 'The export needs my cover page');
    expect(item?.userEmail).toBe(STUDENT);
    const before = (await (await h.api('/admin/badges')).json()) as { unreadFeedback: number };

    expect((await post(`/admin/feedback/${item?.id}/answered`)).status).toBe(200);
    const after = (await (await h.api('/admin/badges')).json()) as { unreadFeedback: number };
    expect(after.unreadFeedback).toBe(before.unreadFeedback - 1);
    const all = (await (await h.api('/admin/feedback?status=all')).json()) as {
      rows: Array<{ id: string; answeredAt: string | null }>;
    };
    expect(all.rows.find((r) => r.id === item?.id)?.answeredAt).toBeTruthy();
  });

  it('the overview and the jobs screen answer', async () => {
    const overview = (await (await h.api('/admin/overview')).json()) as {
      students: number;
      signupsPerDay: unknown[];
    };
    expect(overview.students).toBeGreaterThan(0);
    expect(overview.signupsPerDay).toHaveLength(30);
    const jobs = (await (await h.api('/admin/jobs')).json()) as {
      queues: Array<{ queue: string }>;
    };
    expect(jobs.queues.map((q) => q.queue)).toContain('extract-paper');
  });
});
