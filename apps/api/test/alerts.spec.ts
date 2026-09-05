/**
 * Alerts — PRD §11.5, §14, PHASES 4.6.
 *
 *   "Done when: a forced condition in a test sends the email through the mock mailer."
 *
 * Each §14 condition is forced by writing the rows that would produce it into `AiCallLog`, then
 * the evaluation is triggered through the real SUPERADMIN route, and the mail is read back from
 * the console mailer the module provides. Nothing here is mocked except delivery, which is the
 * one thing that cannot exist yet.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ConsoleMailer, MAILER } from '../src/common/mailer.js';
import { ALERT, type Breach } from '../src/modules/admin/alerts.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let mailer: ConsoleMailer;
let documentId: string;

const INR = 1_000_000n;

async function evaluate(): Promise<Breach[]> {
  const response = await h.api('/admin/alerts/evaluate', { method: 'POST', body: '{}' });
  expect(response.status).toBe(200);
  return (await response.json()) as Breach[];
}

/** One logged call, at a given cost and outcome, `minutesAgo` before now. */
async function call(over: {
  costInr?: number;
  ok?: boolean;
  latencyMs?: number;
  minutesAgo?: number;
  userId?: string;
}): Promise<void> {
  await h.prisma.aiCallLog.create({
    data: {
      userId: over.userId ?? h.userId,
      documentId,
      action: 'ASSIST',
      model: 'mock-fast',
      inputTokens: 1_000,
      cachedInputTokens: 4_000,
      outputTokens: 50,
      costMicroInr: BigInt(Math.round((over.costInr ?? 0) * 100)) * (INR / 100n),
      latencyMs: over.latencyMs ?? 300,
      ok: over.ok ?? true,
      error: over.ok === false ? 'forced failure' : null,
      createdAt: new Date(Date.now() - (over.minutesAgo ?? 1) * 60_000),
    },
  });
}

beforeAll(async () => {
  h = await startHarness('alerts@example.com');
  mailer = h.app.get<ConsoleMailer>(MAILER);

  // The evaluate route is SUPERADMIN-only; the harness user starts as a STUDENT.
  await h.prisma.user.update({ where: { id: h.userId }, data: { role: 'SUPERADMIN' } });

  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Alerts', entryPath: 'A_TOPIC' }),
  });
  documentId = ((await created.json()) as { id: string }).id;
}, 300_000);

beforeEach(async () => {
  await h.prisma.aiCallLog.deleteMany({});
  mailer.sent.length = 0;
  // Clear the once-per-breach memory between cases by letting every condition resolve.
  await evaluate();
  mailer.sent.length = 0;
});

afterAll(async () => {
  await h?.stop();
});

describe('§14 alerts through the mock mailer', () => {
  it('is quiet when nothing has breached', async () => {
    await call({ costInr: 5 });
    expect(await evaluate()).toEqual([]);
    expect(mailer.sent).toHaveLength(0);
  });

  it('emails when one user passes ₹120 month-to-date (§11.5)', async () => {
    await call({ costInr: ALERT.userCostInr + 1 });

    const breaches = await evaluate();
    expect(breaches.map((b) => b.kind)).toContain('USER_COST');

    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0];
    expect(mail?.subject).toContain('USER_COST');
    expect(mail?.text).toContain('threshold of 120');
    expect(mail?.to).toEqual(['admin@example.com']);
  });

  it('emails when the platform average passes ₹90 (§11.5)', async () => {
    // Two users at ₹95 each: neither crosses the per-user line, the average crosses its own.
    const other = await h.prisma.user.create({
      data: { email: 'other-alerts@example.com', name: 'Other' },
    });
    await call({ costInr: 95 });
    await call({ costInr: 95, userId: other.id });

    const breaches = await evaluate();
    const kinds = breaches.map((b) => b.kind);
    expect(kinds).toContain('PLATFORM_AVERAGE');
    expect(kinds).not.toContain('USER_COST');
    expect(mailer.sent[0]?.subject).toContain('PLATFORM_AVERAGE');
  });

  it('emails when more than 5% of calls in the last 15 minutes failed (§14)', async () => {
    for (let i = 0; i < 9; i++) await call({ ok: true });
    await call({ ok: false });
    // 1 of 10 = 10%, over the 5% line.
    const breaches = await evaluate();
    expect(breaches.find((b) => b.kind === 'JOB_FAILURES')).toMatchObject({ value: 10 });
    expect(mailer.sent[0]?.subject).toContain('JOB_FAILURES');
  });

  it('ignores a failure outside the 15-minute window', async () => {
    await call({ ok: true });
    await call({ ok: false, minutesAgo: ALERT.windowMinutes + 5 });
    expect((await evaluate()).map((b) => b.kind)).not.toContain('JOB_FAILURES');
  });

  it('emails when Assist p95 latency passes 900 ms over 15 minutes (§14)', async () => {
    for (let i = 0; i < 19; i++) await call({ latencyMs: 300 });
    await call({ latencyMs: 1_500 });
    // The slowest of twenty is the p95.
    const breaches = await evaluate();
    expect(breaches.find((b) => b.kind === 'TTFB_P95')).toMatchObject({ value: 1_500 });
    expect(mailer.sent[0]?.subject).toContain('TTFB_P95');
  });

  it('sends each breach once, and again only after it has cleared', async () => {
    await call({ costInr: ALERT.userCostInr + 1 });
    await evaluate();
    expect(mailer.sent).toHaveLength(1);

    // Still breached: no second email for the same fact.
    await evaluate();
    expect(mailer.sent).toHaveLength(1);

    // Cleared, then breached again: a new email.
    await h.prisma.aiCallLog.deleteMany({});
    expect(await evaluate()).toEqual([]);
    await call({ costInr: ALERT.userCostInr + 1 });
    await evaluate();
    expect(mailer.sent).toHaveLength(2);
  });

  it('is SUPERADMIN-only', async () => {
    const response = await fetch(`${h.baseUrl}/api/v1/admin/alerts/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
  });
});
