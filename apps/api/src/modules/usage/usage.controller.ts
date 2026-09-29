/**
 * `GET /usage/me` — PRD §9.4 / §6.2 usage meter ("Assist 143/180 · Draft 4/10").
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { METERED_ACTIONS, PLAN_LIMITS, PLANS, type Plan } from '@tc/config';
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
    const used = Object.fromEntries(rows.map((r) => [r.action, r.count])) as Record<string, number>;
    // An admin's extra allowance counts as cap for this month (2026-09-29).
    const bonus = Object.fromEntries(rows.map((r) => [r.action, r.bonus])) as Record<
      string,
      number
    >;
    const planCaps = PLAN_LIMITS[plan].caps;
    const caps = Object.fromEntries(
      METERED_ACTIONS.map((a) => [a, planCaps[a] + (bonus[a] ?? 0)]),
    ) as Record<string, number>;

    return {
      period: periodFor(),
      resetsAt: resetsAtFor().toISOString(),
      plan,
      actions: METERED_ACTIONS.map((action) => ({
        action,
        used: used[action] ?? 0,
        cap: caps[action] ?? 0,
        remaining: Math.max((caps[action] ?? 0) - (used[action] ?? 0), 0),
      })),
    };
  }
}
