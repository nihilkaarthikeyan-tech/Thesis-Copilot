/**
 * Billing — PRD FR-9.5, §11.6, §2.5, PHASES v2 W11.1–W11.2.
 *
 * Razorpay subscriptions (UPI autopay and cards). Three rules shape everything here:
 *
 *   1. **The webhook is the source of truth.** A checkout that succeeded in the browser is not a
 *      subscription; the `subscription.activated` event is. Nothing grants caps before it arrives.
 *   2. **Idempotent by event id.** Razorpay retries, so every event is recorded and a repeat is a
 *      no-op. Without this a retried `charged` would extend a period twice.
 *   3. **Cancelling never takes anything away today.** §2.5: the product we are measured against
 *      is one-starred for exactly this. Cancel sets `cancelAtPeriodEnd`; the plan the student paid
 *      for runs to the end of its period, and their documents are never touched.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BILLING,
  type Env,
  effectivePlan,
  isPurchasable,
  type Plan,
  PRICING,
  type PurchasablePlan,
} from '@tc/config';
import { Prisma } from '@tc/db';
import Razorpay from 'razorpay';
import { ENV } from '../../common/env.token.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { MAILER, type Mailer } from '../../common/mailer.js';
import { PrismaService } from '../../common/prisma.service.js';

export type BillingView = {
  plan: Plan;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Set while Razorpay is not configured, so the screen can say why nothing is buyable. */
  unavailableReason: string | null;
  plans: Array<{
    plan: PurchasablePlan;
    priceInr: number;
    period: string;
    blurb: string;
    current: boolean;
  }>;
};

/** What `POST /billing/subscribe` hands the browser for Razorpay's checkout. */
export type CheckoutHandle = {
  subscriptionId: string;
  keyId: string;
  plan: PurchasablePlan;
  amountPaise: number;
  currency: string;
};

/**
 * Whether a Prisma error is a unique-constraint violation.
 *
 * P2002 is the only code that means "a row with this key already exists", which for a webhook is
 * not a failure but the correct answer: someone got there first.
 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly client: Razorpay | null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {
    // Keys are a human item (`docs/PENDING.md`). Without them the product runs in full except
    // that nothing can be bought, which is the right behaviour for dev and for the pilot.
    this.client =
      env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
        ? new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET })
        : null;
  }

  private planId(plan: PurchasablePlan): string | null {
    const envKey = PRICING[plan].planIdEnv;
    if (!envKey) return null;
    const value = (this.env as unknown as Record<string, string | undefined>)[envKey];
    return value && value.length > 0 ? value : null;
  }

  private unavailableReason(): string | null {
    if (!this.client) return 'Payments are not switched on yet.';
    for (const plan of ['STUDENT_MONTHLY', 'STUDENT_ANNUAL'] as const) {
      if (!this.planId(plan)) return 'Payments are not switched on yet.';
    }
    return null;
  }

  /** `GET /billing` — what the account screen shows. */
  async view(userId: string): Promise<BillingView> {
    const subscription = await this.prisma.subscription.findUnique({ where: { userId } });
    const plan = effectivePlan(subscription);
    return {
      plan,
      status: subscription?.status ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd.toISOString() ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      unavailableReason: this.unavailableReason(),
      plans: (['STUDENT_MONTHLY', 'STUDENT_ANNUAL'] as const).map((p) => ({
        plan: p,
        priceInr: PRICING[p].priceInr,
        period: PRICING[p].period,
        blurb: PRICING[p].blurb,
        current: plan === p,
      })),
    };
  }

  /**
   * Creates the Razorpay subscription and hands its id back for checkout. It is stored as
   * `trialing` with no period end: the student has not paid yet, and until `activated` arrives
   * they keep the caps they had.
   */
  async subscribe(user: { id: string; email: string }, plan: string): Promise<CheckoutHandle> {
    if (!isPurchasable(plan)) throw new ValidationError(`${plan} cannot be bought here.`);
    const reason = this.unavailableReason();
    if (!this.client || reason) throw new ConflictError(reason ?? 'Payments are not available.');
    const planId = this.planId(plan);
    if (!planId) throw new ConflictError('That plan is not configured.');

    const existing = await this.prisma.subscription.findUnique({ where: { userId: user.id } });
    if (existing && existing.status === 'active' && !existing.cancelAtPeriodEnd) {
      throw new ConflictError('You already have an active subscription.');
    }

    const created = await this.client.subscriptions.create({
      plan_id: planId,
      total_count: plan === 'STUDENT_ANNUAL' ? BILLING.annualTotalCount : BILLING.monthlyTotalCount,
      customer_notify: 1,
      notes: { userId: user.id, email: user.email },
    });

    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        provider: 'razorpay',
        providerSubId: created.id,
        plan,
        status: 'trialing',
        currentPeriodEnd: new Date(),
      },
      update: { providerSubId: created.id, plan, status: 'trialing' },
    });

    return {
      subscriptionId: created.id,
      keyId: this.env.RAZORPAY_KEY_ID as string,
      plan,
      amountPaise: PRICING[plan].amountPaise,
      currency: BILLING.currency,
    };
  }

  /**
   * FR-9.5: "cancel from account page on any device; downgrade at period end". Razorpay is told
   * to stop at the cycle end; the row records it so the screen can say when access ends.
   */
  async cancel(userId: string): Promise<BillingView> {
    const subscription = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!subscription) throw new NotFoundError('A subscription');
    if (subscription.cancelAtPeriodEnd) return this.view(userId);

    if (this.client && subscription.providerSubId) {
      try {
        await this.client.subscriptions.cancel(subscription.providerSubId, true);
      } catch (error) {
        // The student's intent is recorded either way; a provider outage must not trap them in a
        // subscription. The webhook reconciles the state when it arrives.
        this.logger.error({ err: error, userId }, 'Razorpay cancel failed; recorded locally');
      }
    }

    await this.prisma.subscription.update({
      where: { userId },
      data: { cancelAtPeriodEnd: true },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user) {
      // §2.5: a cancellation that sends no confirmation is a cancellation the student cannot prove.
      await this.mailer.send({
        to: [user.email],
        subject: 'Your Thesis Copilot subscription is cancelled',
        text: [
          'Your subscription will not renew.',
          '',
          `You keep everything until ${subscription.currentPeriodEnd.toISOString().slice(0, 10)}.`,
          'After that your account moves to the free allowances. Your theses, sources and',
          'exports stay exactly as they are — nothing is deleted, and you can subscribe again',
          'at any time.',
          '',
          'If you meant to do something else, reply to this email.',
        ].join('\n'),
      });
    }
    return this.view(userId);
  }

  /**
   * One Razorpay webhook event, applied once.
   *
   * The signature is checked by the controller before this is called. `providerEventId` is the
   * idempotency key, carried on `AuditEvent.dedupeKey`, which is unique.
   *
   * The marker and the subscription change go in **one transaction, marker first**. The previous
   * version read for an existing marker and then acted, which two concurrent retries can both
   * pass — and it updated the subscription *before* writing the marker, so both would extend the
   * paid period. Razorpay retries until it gets a 2xx, so a slow first attempt and its retry
   * overlapping is the ordinary case, not a rare one.
   *
   * Doing it in a transaction rather than writing the marker alone up front matters too: if the
   * update fails, the marker rolls back with it, so a genuine retry is still applied instead of
   * being skipped as a duplicate of an event that never took effect.
   */
  async applyEvent(event: {
    id: string;
    event: string;
    subscription: {
      id: string;
      status?: string;
      current_end?: number | null;
      current_start?: number | null;
      plan_id?: string;
      notes?: Record<string, string> | null;
    };
  }): Promise<{ applied: boolean; reason?: string }> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { providerSubId: event.subscription.id },
    });
    if (!subscription) return { applied: false, reason: 'unknown subscription' };

    // Every event Razorpay sends about a subscription maps onto one of the four states we store.
    const status = STATUS_BY_EVENT[event.event] ?? statusFrom(event.subscription.status);
    if (!status) return { applied: false, reason: `unhandled event ${event.event}` };

    const periodEnd = event.subscription.current_end
      ? new Date(event.subscription.current_end * 1000)
      : subscription.currentPeriodEnd;

    try {
      await this.prisma.$transaction([
        // First, so a concurrent duplicate loses here and nothing after it runs.
        this.prisma.auditEvent.create({
          data: {
            kind: 'BILLING_EVENT',
            userId: subscription.userId,
            dedupeKey: `billing:${event.id}`,
            detail: {
              providerEventId: event.id,
              event: event.event,
              subId: event.subscription.id,
              status,
              periodEnd: periodEnd.toISOString(),
            },
          },
        }),
        this.prisma.subscription.update({
          where: { userId: subscription.userId },
          data: {
            status,
            currentPeriodEnd: periodEnd,
            ...(status === 'cancelled' ? { cancelAtPeriodEnd: true } : {}),
          },
        }),
        // The plan on `User` is what the cap check reads, so it follows the subscription.
        this.prisma.user.update({
          where: { id: subscription.userId },
          data: {
            plan: effectivePlan({ plan: subscription.plan, status, currentPeriodEnd: periodEnd }),
          },
        }),
      ]);
    } catch (error) {
      // P2002 is the unique violation on `dedupeKey`: this event has already been applied.
      if (isUniqueViolation(error)) return { applied: false, reason: 'duplicate' };
      throw error;
    }

    this.logger.log(
      { event: event.event, userId: subscription.userId, status },
      'billing event applied',
    );
    return { applied: true };
  }

  /**
   * FR-9.5's renewal reminder, run by the worker: every active subscription whose period ends in
   * three days, once. "Once" is an `AuditEvent` per period, so a scheduler that runs every hour
   * does not email every hour.
   */
  async sendRenewalReminders(now: Date = new Date()): Promise<{ sent: number }> {
    const from = new Date(now.getTime() + (BILLING.reminderDaysBefore - 1) * 86_400_000);
    const to = new Date(now.getTime() + BILLING.reminderDaysBefore * 86_400_000);
    const due = await this.prisma.subscription.findMany({
      where: {
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { gte: from, lt: to },
      },
      select: { userId: true, plan: true, currentPeriodEnd: true },
    });

    let sent = 0;
    for (const subscription of due) {
      const period = subscription.currentPeriodEnd.toISOString().slice(0, 10);
      const already = await this.prisma.auditEvent.findFirst({
        where: {
          userId: subscription.userId,
          kind: 'RENEWAL_REMINDER',
          detail: { path: ['period'], equals: period },
        },
      });
      if (already) continue;

      const user = await this.prisma.user.findUnique({
        where: { id: subscription.userId },
        select: { email: true },
      });
      if (!user) continue;

      const pricing = PRICING[subscription.plan];
      await this.mailer.send({
        to: [user.email],
        subject: `Your Thesis Copilot subscription renews on ${period}`,
        text: [
          `On ${period} your ${pricing.period} subscription renews and ₹${pricing.priceInr} will be charged.`,
          '',
          'Nothing to do if that is what you want.',
          'To stop it: open Thesis Copilot → Account → Cancel. One click, on any device,',
          'and you keep everything you have paid for until the date above.',
        ].join('\n'),
      });
      await this.prisma.auditEvent.create({
        data: {
          kind: 'RENEWAL_REMINDER',
          userId: subscription.userId,
          detail: { period, plan: subscription.plan },
        },
      });
      sent += 1;
    }
    return { sent };
  }
}

/** Razorpay's subscription events (`subscription.*`), mapped onto the four states we store. */
const STATUS_BY_EVENT: Record<string, string | undefined> = {
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.authenticated': 'trialing',
  'subscription.pending': 'past_due',
  'subscription.halted': 'past_due',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'cancelled',
  'subscription.paused': 'past_due',
  'subscription.resumed': 'active',
};

function statusFrom(providerStatus: string | undefined): string | null {
  switch (providerStatus) {
    case 'active':
    case 'authenticated':
      return 'active';
    case 'pending':
    case 'halted':
    case 'paused':
      return 'past_due';
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'cancelled';
    default:
      return null;
  }
}
