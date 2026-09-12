/**
 * Pilot support tooling — PHASES 5.9, ADR-0004.
 *
 * The admin's per-user view, the logged cap reset, the logged plan change, the feedback mail, and
 * the audit row a cap refusal leaves. The harness user is promoted to SUPERADMIN; a second,
 * ordinary student is the subject.
 */

import { capFor } from '@tc/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ConsoleMailer, MAILER } from '../src/common/mailer.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let mailer: ConsoleMailer;
let studentId: string;
let documentId: string;

beforeAll(async () => {
  h = await startHarness('admin-users@example.com');
  mailer = h.app.get<ConsoleMailer>(MAILER);
  await h.prisma.user.update({ where: { id: h.userId }, data: { role: 'SUPERADMIN' } });

  const student = await h.prisma.user.create({
    data: { email: 'pilot-student@example.com', name: 'Pilot Student' },
  });
  studentId = student.id;
  const document = await h.prisma.document.create({
    data: { ownerId: studentId, title: 'Pilot thesis', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  await h.prisma.usageLedger.create({
    data: { userId: studentId, period: periodFor(), action: 'ASSIST', count: 37 },
  });
  await h.prisma.aiCallLog.create({
    data: {
      userId: studentId,
      documentId,
      action: 'ASSIST',
      model: 'mock-fast',
      inputTokens: 1_000,
      cachedInputTokens: 3_000,
      outputTokens: 60,
      costMicroInr: 2_500_000n,
      latencyMs: 300,
      ok: true,
    },
  });
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /admin/users', () => {
  it('bounds the page and reports the total, so the list cannot grow unbounded', async () => {
    const response = await h.api('/admin/users?limit=1&offset=0');
    const page = (await response.json()) as { rows: unknown[]; total: number; limit: number };
    expect(page.rows).toHaveLength(1);
    expect(page.limit).toBe(1);
    // The total counts everyone, which is what makes a bounded page honest.
    expect(page.total).toBeGreaterThanOrEqual(2);
  });

  it('refuses a limit that is not a number rather than silently ignoring it', async () => {
    expect((await h.api('/admin/users?limit=all')).status).toBe(400);
  });

  it('lists every account with this month’s usage against caps, cost and last activity', async () => {
    const response = await h.api('/admin/users');
    expect(response.status).toBe(200);
    // A page, not an array: this list grows with the platform, so it is paginated (newest first)
    // and reports the total alongside the rows.
    const page = (await response.json()) as {
      total: number;
      limit: number;
      offset: number;
      rows: Array<{
        id: string;
        email: string;
        plan: string;
        documents: number;
        costInr: number;
        lastActiveAt: string | null;
        usage: Array<{ action: string; used: number; cap: number }>;
      }>;
    };
    expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
    expect(page.limit).toBeGreaterThan(0);
    const student = page.rows.find((r) => r.id === studentId);
    expect(student).toMatchObject({
      email: 'pilot-student@example.com',
      plan: 'FREE_TRIAL',
      documents: 1,
      costInr: 2.5,
    });
    expect(student?.lastActiveAt).not.toBeNull();
    expect(student?.usage.find((u) => u.action === 'ASSIST')).toEqual({
      action: 'ASSIST',
      used: 37,
      cap: 50,
    });
  });

  it('is SUPERADMIN-only, and the detail page is titles only', async () => {
    const anonymous = await fetch(`${h.baseUrl}/api/v1/admin/users`);
    expect(anonymous.status).toBe(401);

    const detail = await h.api(`/admin/users/${studentId}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      documentList: Array<Record<string, unknown>>;
      capExceeded: number;
    };
    expect(body.documentList).toHaveLength(1);
    expect(Object.keys(body.documentList[0] ?? {}).sort()).toEqual(
      ['chapters', 'id', 'title', 'updatedAt'].sort(),
    );
  });

  it('answers 404 for an unknown user', async () => {
    const response = await h.api('/admin/users/00000000-0000-7000-8000-000000000000');
    expect(response.status).toBe(404);
  });
});

describe('POST /admin/users/:id/reset-caps', () => {
  it('zeroes the period’s counters and logs who did it and what the counters were', async () => {
    const response = await h.api(`/admin/users/${studentId}/reset-caps`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reset: [{ action: 'ASSIST', was: 37 }] });

    const ledger = await h.prisma.usageLedger.findFirst({
      where: { userId: studentId, period: periodFor(), action: 'ASSIST' },
    });
    expect(ledger?.count).toBe(0);

    const audit = await h.prisma.auditEvent.findFirst({
      where: { userId: studentId, kind: 'CAPS_RESET' },
    });
    expect(audit?.actorId).toBe(h.userId);
    expect(audit?.detail).toMatchObject({ reset: [{ action: 'ASSIST', was: 37 }] });

    // The detail page lists it.
    const detail = (await (await h.api(`/admin/users/${studentId}`)).json()) as {
      recentEvents: Array<{ kind: string; actorId: string | null }>;
    };
    expect(detail.recentEvents[0]).toMatchObject({ kind: 'CAPS_RESET', actorId: h.userId });
  });
});

describe('PUT /admin/users/:id/plan', () => {
  it('changes the plan (PHASES 5.8 pilot override) and logs the change', async () => {
    const response = await h.api(`/admin/users/${studentId}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ plan: 'STUDENT_MONTHLY' }),
    });
    expect(response.status).toBe(200);
    const user = await h.prisma.user.findUniqueOrThrow({ where: { id: studentId } });
    expect(user.plan).toBe('STUDENT_MONTHLY');
    const audit = await h.prisma.auditEvent.findFirst({
      where: { userId: studentId, kind: 'PLAN_CHANGED' },
    });
    expect(audit?.detail).toEqual({ from: 'FREE_TRIAL', to: 'STUDENT_MONTHLY' });

    // The list now shows STUDENT_MONTHLY caps.
    const page = (await (await h.api('/admin/users')).json()) as {
      rows: Array<{ id: string; usage: Array<{ action: string; cap: number }> }>;
    };
    expect(
      page.rows.find((r) => r.id === studentId)?.usage.find((u) => u.action === 'ASSIST')?.cap,
    ).toBe(capFor('STUDENT_MONTHLY', 'ASSIST'));
  });

  it('rejects a plan that does not exist', async () => {
    const response = await h.api(`/admin/users/${studentId}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ plan: 'FREE_FOREVER' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('a cap refusal leaves an audit row (ADR-0004)', () => {
  it('is counted on the admin’s per-user page', async () => {
    // The harness user's own thesis, with the DRAFT cap already spent: the next draft is refused
    // at the door, which is the one place a refusal is written.
    const created = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Admin own', entryPath: 'A_TOPIC' }),
    });
    const { firstChapterId } = (await created.json()) as { firstChapterId: string };

    const before = await h.prisma.auditEvent.count({
      where: { userId: h.userId, kind: 'CAP_EXCEEDED' },
    });
    await h.prisma.usageLedger.upsert({
      where: { userId_period_action: { userId: h.userId, period: periodFor(), action: 'DRAFT' } },
      create: { userId: h.userId, period: periodFor(), action: 'DRAFT', count: 2 },
      update: { count: 2 },
    });
    const chapter = (await (await h.api(`/chapters/${firstChapterId}`)).json()) as {
      outlineNodeId: string;
    };
    const refused = await h.api('/draft/section', {
      method: 'POST',
      body: JSON.stringify({ chapterId: firstChapterId, outlineNodeId: chapter.outlineNodeId }),
    });
    expect(refused.status).toBe(429);

    const after = await h.prisma.auditEvent.findMany({
      where: { userId: h.userId, kind: 'CAP_EXCEEDED' },
    });
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.detail).toMatchObject({ action: 'DRAFT', cap: 2 });

    const detail = (await (await h.api(`/admin/users/${h.userId}`)).json()) as {
      capExceeded: number;
    };
    expect(detail.capExceeded).toBe(before + 1);
  });
});

describe('POST /feedback', () => {
  it('mails the admin the document id and the last five suggestion events, and logs it', async () => {
    // Sign the student in is more than this needs: the harness user sends feedback about a
    // document of their own, with six events so the mail shows only five.
    const created = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Feedback doc', entryPath: 'A_TOPIC' }),
    });
    const { id } = (await created.json()) as { id: string };
    for (let i = 0; i < 6; i++) {
      await h.prisma.suggestionEvent.create({
        data: {
          userId: h.userId,
          documentId: id,
          action: 'ASSIST',
          shownChars: 100 + i,
          outcome: i % 2 ? 'ACCEPTED' : 'SHOWN',
          latencyMs: 400,
          ttfbMs: 250,
        },
      });
    }

    mailer.sent.length = 0;
    const response = await h.api('/feedback', {
      method: 'POST',
      body: JSON.stringify({ documentId: id, message: 'The ghost text vanished when I scrolled.' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, events: 5 });

    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0];
    expect(mail?.to).toEqual(['admin@example.com']);
    expect(mail?.subject).toContain('Feedback from admin-users@example.com');
    expect(mail?.text).toContain(`Document: ${id}`);
    expect(mail?.text).toContain('The ghost text vanished when I scrolled.');
    expect(mail?.text.match(/ASSIST/g)).toHaveLength(5);
    // Ids and outcomes travel; chapter text never does.
    expect(mail?.text).not.toContain('content');

    const audit = await h.prisma.auditEvent.findFirst({
      where: { userId: h.userId, kind: 'FEEDBACK', documentId: id },
    });
    expect(audit?.detail).toMatchObject({ events: 5 });
  });

  it('refuses feedback about someone else’s document with 404', async () => {
    const response = await h.api('/feedback', {
      method: 'POST',
      body: JSON.stringify({ documentId, message: 'Not mine.' }),
    });
    expect(response.status).toBe(404);
    expect(mailer.sent).toHaveLength(1);
  });
});
