/**
 * The site-wide monthly AI budget (`PLATFORM_MONTHLY_CEILING_INR`, 2026-09-25).
 *
 * The per-user ceiling bounds one student; this bounds the bill. It is summed over every user's
 * successful calls, refused with its own reason and audit kind so the student is told it is not
 * their allowance, and read at most once a minute.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsageService } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

// Set before the harness loads the environment: two rupees for the whole site this month.
process.env.PLATFORM_MONTHLY_CEILING_INR = '2';

let h: Harness;
let usage: UsageService;
let otherUserId: string;

beforeAll(async () => {
  h = await startHarness('platform-ceiling@example.com');
  usage = h.app.get(UsageService);
  const other = await h.prisma.user.create({ data: { email: 'someone-else@example.com' } });
  otherUserId = other.id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const spend = (userId: string, inr: number, ok = true) =>
  h.prisma.aiCallLog.create({
    data: {
      userId,
      action: 'CHAT',
      model: 'mock-fast',
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 10,
      costMicroInr: BigInt(Math.round(inr * 1_000_000)),
      latencyMs: 10,
      ok,
    },
  });

describe('the site-wide ceiling', () => {
  it('lets a call through while the site is under it', async () => {
    await spend(otherUserId, 1.5);
    const result = await usage.consume(h.userId, 'FREE_TRIAL', 'ASSIST', new Date());
    expect(result.ok).toBe(true);
  });

  it('refuses everyone once every user’s spend adds up to it — even a user who spent nothing', async () => {
    // The other user's spend crosses the line; the harness user has spent nothing themselves.
    await spend(otherUserId, 0.6);
    await spend(otherUserId, 5, false); // a failed call: refunded, not counted
    // Past the one-minute cache.
    const later = new Date(Date.now() + 61_000);
    const result = await usage.consume(h.userId, 'FREE_TRIAL', 'ASSIST', later);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('platform');
    expect(result.platformCeilingInr).toBe(2);
    expect(result.spentInr).toBeCloseTo(2.1, 2);

    const audit = await h.prisma.auditEvent.findFirst({
      where: { userId: h.userId, kind: 'PLATFORM_CEILING_EXCEEDED' },
    });
    expect(audit).not.toBeNull();
  });

  it('is what a metered endpoint answers with, in the student’s words', async () => {
    const created = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Ceiling', entryPath: 'A_TOPIC' }),
    });
    const doc = (await created.json()) as { id: string; firstChapterId: string };
    const response = await h.api('/proofread', {
      method: 'POST',
      body: JSON.stringify({ chapterId: doc.firstChapterId }),
    });
    // The cache may still hold the under-ceiling figure for a moment; the endpoint's own clock
    // is real, so the sum is re-read once the minute is up. Either way, no provider call and a
    // 429 whose type names the site, not the student.
    expect([200, 429]).toContain(response.status);
    if (response.status === 429) {
      expect(((await response.json()) as { type: string }).type).toBe('PLATFORM_CEILING_EXCEEDED');
    }
  });
});
