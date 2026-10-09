/**
 * `GET /usage/me` — PRD §9.4 / §6.2 usage meter ("Assist 143/180 · Draft 4/10").
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  callCeiling,
  countsKept,
  METERED_ACTIONS,
  type MeteredAction,
  offeredOnSomePlan,
  PLAN_LIMITS,
  PLANS,
  type Plan,
} from '@tc/config';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { periodFor, resetsAtFor, UsageService } from './usage.service.js';

@Controller('usage')
@UseGuards(SessionGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('me')
  async me(@CurrentUser() user: SessionUser) {
    const plan: Plan = (PLANS as readonly string[]).includes(user.plan)
      ? (user.plan as Plan)
      : 'FREE_TRIAL';
    const rows = await this.usage.usageFor(user.id);
    // ADR-0144: an allowance that counts kept suggestions shows the ones kept as used; the calls
    // and their ceiling travel beside it.
    const used = Object.fromEntries(
      rows.map((r) => [r.action, countsKept(r.action as MeteredAction) ? r.kept : r.count]),
    ) as Record<string, number>;
    const calls = Object.fromEntries(rows.map((r) => [r.action, r.count])) as Record<
      string,
      number
    >;
    // An admin's extra allowance counts as cap for this month (2026-09-29).
    const bonus = Object.fromEntries(rows.map((r) => [r.action, r.bonus])) as Record<
      string,
      number
    >;
    // ADR-0036: a free trial past its end has no plan allowance, only what an admin gave.
    const trial = plan === 'FREE_TRIAL' ? await this.usage.trialStatus(user.id) : null;
    const planCaps = PLAN_LIMITS[plan].caps;
    const caps = Object.fromEntries(
      METERED_ACTIONS.map((a) => [a, (trial?.ended ? 0 : planCaps[a]) + (bonus[a] ?? 0)]),
    ) as Record<string, number>;

    // ADR-0124: an allowance no plan includes yet (the literature review build) is not listed as
    // "not included" for everyone; an account an admin gave units to still sees its line.
    const listed = METERED_ACTIONS.filter(
      (action) => offeredOnSomePlan(action) || (bonus[action] ?? 0) > 0 || (used[action] ?? 0) > 0,
    );

    return {
      period: periodFor(),
      resetsAt: resetsAtFor().toISOString(),
      plan,
      trial,
      actions: listed.map((action) => ({
        action,
        used: used[action] ?? 0,
        cap: caps[action] ?? 0,
        remaining: Math.max((caps[action] ?? 0) - (used[action] ?? 0), 0),
        ...(countsKept(action)
          ? {
              countsKept: true,
              calls: calls[action] ?? 0,
              callCeiling: callCeiling(action, caps[action] ?? 0),
            }
          : {}),
      })),
    };
  }
}
