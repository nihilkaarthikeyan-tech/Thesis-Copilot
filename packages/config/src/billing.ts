/**
 * Retail pricing and billing constants — PRD §11.6, FR-9.5, §2.5, PHASES v2 W11.
 *
 * §11.6 is marked `DECISION PENDING: owner confirms`, so these are its numbers and nothing more;
 * the pricing page reads them from here, and so does the invoice, which is why the page and the
 * charge can never disagree. Money is integer paise for Razorpay (which takes the smallest unit)
 * and integer rupees for display — never a float (§0.2).
 */

import type { Plan } from './plans.js';

export type BillingPeriod = 'monthly' | 'yearly';

export type PlanPricing = {
  readonly plan: Plan;
  /** Retail price, ₹, per period (§11.6). */
  readonly priceInr: number;
  readonly period: BillingPeriod;
  /** What Razorpay charges: the smallest currency unit. */
  readonly amountPaise: number;
  /** Env var naming the Razorpay plan id, created once in their dashboard. */
  readonly planIdEnv: 'RAZORPAY_PLAN_MONTHLY' | 'RAZORPAY_PLAN_ANNUAL' | null;
  /** Shown on the pricing page under the price. */
  readonly blurb: string;
};

/** §11.6's table. `FREE_TRIAL` and `INSTITUTION_SEAT` are not bought from the pricing page. */
export const PRICING: Readonly<Record<Plan, PlanPricing>> = {
  FREE_TRIAL: {
    plan: 'FREE_TRIAL',
    priceInr: 0,
    period: 'monthly',
    amountPaise: 0,
    planIdEnv: null,
    blurb: '14 days. No card. Everything works, at smaller monthly allowances.',
  },
  STUDENT_MONTHLY: {
    plan: 'STUDENT_MONTHLY',
    priceInr: 299,
    period: 'monthly',
    amountPaise: 299_00,
    planIdEnv: 'RAZORPAY_PLAN_MONTHLY',
    blurb: 'Cancel any time, from any device. We email you three days before every renewal.',
  },
  STUDENT_ANNUAL: {
    plan: 'STUDENT_ANNUAL',
    priceInr: 2_499,
    period: 'yearly',
    amountPaise: 2_499_00,
    planIdEnv: 'RAZORPAY_PLAN_ANNUAL',
    blurb: '₹208 a month, paid once. The same cancel-any-time terms.',
  },
  INSTITUTION_SEAT: {
    plan: 'INSTITUTION_SEAT',
    priceInr: 0,
    period: 'yearly',
    amountPaise: 0,
    planIdEnv: null,
    blurb: 'Negotiated per department. Talk to us.',
  },
};

/** What the pricing page lists, in order. */
export const PURCHASABLE_PLANS = [
  'STUDENT_MONTHLY',
  'STUDENT_ANNUAL',
] as const satisfies readonly Plan[];
export type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];

export function isPurchasable(plan: string): plan is PurchasablePlan {
  return (PURCHASABLE_PLANS as readonly string[]).includes(plan);
}

/**
 * FR-9.5's lifecycle constants.
 *
 * §2.5 is the reason the reminder exists at all: almost every one-star review of the product we
 * are measured against is about a renewal nobody saw coming.
 */
export const BILLING = {
  /** "Renewal reminder email T-3 days". */
  reminderDaysBefore: 3,
  /** "past-due grace of 3 days, then FREE_TRIAL caps with documents preserved". */
  graceDays: 3,
  currency: 'INR',
  /** Razorpay bills a monthly subscription for this many cycles before it must be renewed. */
  monthlyTotalCount: 12,
  annualTotalCount: 5,
} as const;

/** Subscription states we store. Razorpay has more; these are the ones that change what a user gets. */
export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * The plan whose caps apply right now.
 *
 * A cancelled subscription keeps its plan until the period it was paid for ends — the student
 * bought that month. Past due keeps it through the grace days, then falls back to the trial caps
 * with every document untouched (FR-9.5).
 */
export function effectivePlan(
  subscription: {
    plan: Plan;
    status: string;
    currentPeriodEnd: Date;
  } | null,
  now: Date = new Date(),
): Plan {
  if (!subscription) return 'FREE_TRIAL';
  const end = subscription.currentPeriodEnd.getTime();
  switch (subscription.status) {
    case 'active':
    case 'trialing':
      return subscription.plan;
    case 'cancelled':
      return end > now.getTime() ? subscription.plan : 'FREE_TRIAL';
    case 'past_due':
      return end + BILLING.graceDays * 86_400_000 > now.getTime()
        ? subscription.plan
        : 'FREE_TRIAL';
    default:
      return 'FREE_TRIAL';
  }
}
