/**
 * The free trial ends (ADR-0036), on real Postgres.
 *
 * A trial past its end has no plan allowance: every metered action is refused with words that say
 * why and what still works, the usage meter shows zero, an admin's extra allowance still counts,
 * a paid plan is not affected, and an admin can extend the trial.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { periodFor, refusal, UsageService } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let usage: UsageService;

const STUDENT = 'trial-student@example.com';
const DAY = 86_400_000;

async function signIn(email: string): Promise<string> {
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
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

let studentId: string;
let studentCookie: string;

beforeAll(async () => {
  h = await startHarness('trial-admin@example.com');
  usage = h.app.get(UsageService);
  await h.prisma.user.update({ where: { id: h.userId }, data: { role: 'SUPERADMIN' } });
  studentCookie = await signIn(STUDENT);
  studentId = (await h.prisma.user.findUniqueOrThrow({ where: { email: STUDENT } })).id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const endTrial = (daysAgo = 1) =>
  h.prisma.user.update({
    where: { id: studentId },
    data: { trialEndsAt: new Date(Date.now() - daysAgo * DAY) },
  });

describe('the free trial', () => {
  it('starts at 14 days for a new account, set by the database', async () => {
    const user = await h.prisma.user.findUniqueOrThrow({ where: { id: studentId } });
    const days = ((user.trialEndsAt?.getTime() ?? 0) - user.createdAt.getTime()) / DAY;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThan(14.01);
    expect((await usage.consume(studentId, 'FREE_TRIAL', 'ASSIST')).ok).toBe(true);
  });

  it('once ended, refuses every action with words that say why and what still works', async () => {
    await endTrial();
    const result = await usage.consume(studentId, 'FREE_TRIAL', 'ASSIST');
    expect(result).toMatchObject({ ok: false, reason: 'trial', cap: 0 });
    if (result.ok) throw new Error('unreachable');
    const error = refusal('ASSIST', result);
    expect(error.getStatus()).toBe(402);
    const body = error.getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ type: 'CAP_EXCEEDED', trialEnded: true, cap: 0 });
    expect(body.resetsAt).toBeUndefined();
    expect(String(body.detail)).toContain('free trial ended');
    expect(String(body.detail)).toContain('Your theses are safe');

    for (const action of ['DRAFT', 'CITE', 'CHAT', 'VIVA'] as const) {
      expect((await usage.consume(studentId, 'FREE_TRIAL', action)).ok).toBe(false);
    }
  });

  it('shows zero allowances and the end date on the usage meter', async () => {
    const meter = (await (
      await h.api('/usage/me', { headers: { cookie: studentCookie, 'content-type': 'text/plain' } })
    ).json()) as {
      trial: { ended: boolean; daysLeft: number } | null;
      actions: Array<{ action: string; cap: number }>;
    };
    expect(meter.trial).toMatchObject({ ended: true, daysLeft: 0 });
    expect(meter.actions.every((a) => a.cap === 0)).toBe(true);
  });

  it('still honours an extra allowance an admin gives', async () => {
    await h.api(`/admin/users/${studentId}/allowance`, {
      method: 'POST',
      body: JSON.stringify({
        grants: [{ action: 'DRAFT', units: 1 }],
        reason: 'Finishing a chapter',
      }),
    });
    expect((await usage.consume(studentId, 'FREE_TRIAL', 'DRAFT')).ok).toBe(true);
    expect((await usage.consume(studentId, 'FREE_TRIAL', 'DRAFT')).ok).toBe(false);
  });

  it('does not touch a paid plan', async () => {
    expect((await usage.consume(studentId, 'STUDENT_MONTHLY', 'ASSIST')).ok).toBe(true);
  });

  it('can be extended by an admin, from today when it has already ended, and is logged', async () => {
    const response = await h.api(`/admin/users/${studentId}/trial`, {
      method: 'POST',
      body: JSON.stringify({ days: 7, reason: 'Exams delayed her start' }),
    });
    expect(response.status).toBe(200);
    const { trialEndsAt } = (await response.json()) as { trialEndsAt: string };
    const days = (new Date(trialEndsAt).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);

    expect((await usage.consume(studentId, 'FREE_TRIAL', 'CITE')).ok).toBe(true);
    const logged = await h.prisma.auditEvent.findFirst({
      where: { kind: 'TRIAL_EXTENDED', userId: studentId },
    });
    expect(logged?.actorId).toBe(h.userId);
    expect(logged?.detail).toMatchObject({ days: 7, reason: 'Exams delayed her start' });

    expect(
      (
        await h.api(`/admin/users/${studentId}/trial`, {
          method: 'POST',
          body: JSON.stringify({ days: 0, reason: 'nope' }),
        })
      ).status,
    ).toBe(400);
  });

  it('shows on the admin overview when it ends within three days', async () => {
    await h.prisma.user.update({
      where: { id: studentId },
      data: { trialEndsAt: new Date(Date.now() + 2 * DAY) },
    });
    const overview = (await (await h.api('/admin/overview')).json()) as {
      trialsEnding: Array<{ email: string }>;
    };
    expect(overview.trialsEnding.map((u) => u.email)).toContain(STUDENT);
    // The ledger this period, for the record of what the test spent.
    expect(
      await h.prisma.usageLedger.count({ where: { userId: studentId, period: periodFor() } }),
    ).toBeGreaterThan(0);
  });
});
