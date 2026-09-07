/**
 * Razorpay webhooks — PRD FR-9.5, §12.1; PHASES v2 W11 and the VERIFY batch ("billing webhooks").
 *
 * This is the only unauthenticated route in the application and the only one that reads a raw
 * body, so it gets the most careful reading in the suite. Three properties carry the weight:
 *
 * **The signature is the whole authentication.** Anyone can POST here. A forged event could move
 * a student onto a paid plan, or off one, and the only thing between the internet and the
 * subscription table is an HMAC over the exact bytes.
 *
 * **A retry must not be applied twice.** Razorpay retries until it gets a 2xx, so the same
 * `subscription.charged` arrives two or three times; applying each would push the period end
 * further forward than the student paid for.
 *
 * **The reply is always 200.** A non-2xx makes Razorpay retry an event we have already decided
 * about, so "I will not act on this" is reported in the body, not in the status.
 */

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

const SECRET = 'webhook-test-secret';

let h: Harness;
let subId: string;

/** The bytes Razorpay would send, and the signature over exactly those bytes. */
function signed(body: unknown, secret = SECRET): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  return { raw, signature: createHmac('sha256', secret).update(raw).digest('hex') };
}

function post(
  body: unknown,
  options: { secret?: string; signature?: string } = {},
): Promise<Response> {
  const { raw, signature } = signed(body, options.secret ?? SECRET);
  return fetch(`${h.baseUrl}/api/v1/billing/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': options.signature ?? signature,
    },
    body: raw,
  });
}

const event = (
  name: string,
  over: {
    id?: string;
    status?: string;
    current_end?: number | null;
    current_start?: number | null;
  } = {},
) => ({
  event: name,
  payload: {
    subscription: {
      entity: {
        id: over.id ?? subId,
        status: over.status ?? 'active',
        plan_id: 'plan_test',
        current_start: over.current_start ?? 1_780_000_000,
        current_end: over.current_end ?? 1_790_000_000,
        notes: null,
      },
    },
  },
});

const subscription = () => h.prisma.subscription.findUniqueOrThrow({ where: { userId: h.userId } });
const plan = async () => (await h.prisma.user.findUniqueOrThrow({ where: { id: h.userId } })).plan;

beforeAll(async () => {
  // Set before the harness boots: `packages/config` validates the environment at module
  // construction, so a secret assigned afterwards would never be read.
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
  process.env.RAZORPAY_PLAN_MONTHLY = 'plan_monthly';
  process.env.RAZORPAY_PLAN_ANNUAL = 'plan_annual';

  h = await startHarness('billing-webhook@example.com');
  subId = `sub_${Date.now()}`;
  await h.prisma.subscription.create({
    data: {
      userId: h.userId,
      plan: 'STUDENT_MONTHLY',
      status: 'created',
      provider: 'razorpay',
      providerSubId: subId,
      currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
    },
  });
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('the signature is the authentication', () => {
  it('refuses a body with no signature at all', async () => {
    const response = await fetch(`${h.baseUrl}/api/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event('subscription.charged')),
    });
    expect(response.status).toBe(401);
  });

  it('refuses a signature made with the wrong secret', async () => {
    const response = await post(event('subscription.charged'), { secret: 'not-the-secret' });
    expect(response.status).toBe(401);
  });

  it('refuses a signature of the right length that is simply wrong', async () => {
    // A length mismatch short-circuits before `timingSafeEqual`; this exercises the comparison.
    const { signature } = signed(event('subscription.charged'));
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`;
    const response = await post(event('subscription.charged'), { signature: flipped });
    expect(response.status).toBe(401);
  });

  it('refuses a signature over different bytes from the ones sent', async () => {
    // The signature must be over the raw body, not over a re-serialisation of it: a proxy that
    // re-orders JSON keys would otherwise silently authenticate a body nobody signed.
    const { signature } = signed(event('subscription.charged'));
    const response = await fetch(`${h.baseUrl}/api/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
      body: JSON.stringify(event('subscription.cancelled')),
    });
    expect(response.status).toBe(401);
  });

  it('changes nothing at all when it refuses', async () => {
    const before = await subscription();
    await post(event('subscription.charged'), { secret: 'wrong' });
    expect(await subscription()).toEqual(before);
  });
});

describe('applying an event', () => {
  it('activates the subscription and moves the plan the cap check reads', async () => {
    const response = await post(event('subscription.charged'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, applied: true });

    const row = await subscription();
    expect(row.status).toBe('active');
    expect(row.currentPeriodEnd.toISOString()).toBe(new Date(1_790_000_000 * 1000).toISOString());
    expect(await plan()).toBe('STUDENT_MONTHLY');
  });

  it('records the charge as an audit row, which is what an invoice is built from', async () => {
    const row = await h.prisma.auditEvent.findFirst({
      where: { userId: h.userId, kind: 'BILLING_EVENT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.detail).toMatchObject({ event: 'subscription.charged', status: 'active' });
  });

  it('ignores the retry of an event it has already applied', async () => {
    const before = await subscription();
    const response = await post(event('subscription.charged'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: false, reason: 'duplicate' });
    // The period end in particular: applying twice would give away a month.
    expect((await subscription()).currentPeriodEnd).toEqual(before.currentPeriodEnd);
  });

  it('treats a new billing period as a new event, not a duplicate', async () => {
    const response = await post(
      event('subscription.charged', {
        current_start: 1_790_000_001,
        current_end: 1_800_000_000,
      }),
    );
    expect(await response.json()).toMatchObject({ applied: true });
    expect((await subscription()).currentPeriodEnd.toISOString()).toBe(
      new Date(1_800_000_000 * 1000).toISOString(),
    );
  });

  it('a halted payment moves the subscription past due but keeps the plan through the grace', async () => {
    const response = await post(
      event('subscription.halted', { status: 'halted', current_start: 1_800_000_001 }),
    );
    expect(await response.json()).toMatchObject({ applied: true });
    expect((await subscription()).status).toBe('past_due');
    // §11: three days of grace, documents preserved. The plan drops only after that.
    expect(await plan()).toBe('STUDENT_MONTHLY');
  });

  it('a cancellation keeps what the student paid for until the period ends', async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86_400;
    const response = await post(
      event('subscription.cancelled', {
        status: 'cancelled',
        current_start: 1_810_000_000,
        current_end: future,
      }),
    );
    expect(await response.json()).toMatchObject({ applied: true });
    const row = await subscription();
    expect(row.status).toBe('cancelled');
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(await plan()).toBe('STUDENT_MONTHLY');
  });

  it('drops to FREE_TRIAL once a cancelled period has actually ended', async () => {
    const past = Math.floor(Date.now() / 1000) - 86_400;
    await post(
      event('subscription.cancelled', {
        status: 'cancelled',
        current_start: 1_820_000_000,
        current_end: past,
      }),
    );
    expect(await plan()).toBe('FREE_TRIAL');
  });
});

describe('what it will not act on', () => {
  it('answers 200 and says why, rather than making Razorpay retry for ever', async () => {
    // A non-2xx is a request to send this again. There is nothing to be gained by re-receiving an
    // event about a subscription we do not have.
    const response = await post(event('subscription.charged', { id: 'sub_not_ours' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      applied: false,
      reason: 'unknown subscription',
    });
  });

  it('ignores an event about something other than a subscription', async () => {
    const response = await post({
      event: 'payment.captured',
      payload: { payment: { entity: {} } },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: false });
  });

  it('ignores a subscription event it has no state for', async () => {
    const response = await post(
      event('subscription.something.new', { status: 'weird', current_start: 1_830_000_000 }),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { reason?: string }).reason).toContain('unhandled');
  });

  it('ignores a payload that is not shaped like an event', async () => {
    const response = await post({ hello: 'world' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: false, reason: 'unrecognised payload' });
  });
});
