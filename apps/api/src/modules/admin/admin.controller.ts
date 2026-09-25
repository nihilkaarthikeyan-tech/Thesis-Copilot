/**
 * Admin dashboards — PRD §9.4, §11.5, §14, PHASES 4.3, 4.4, 4.5, 4.9.
 *
 * `/admin/cost-model` stays open: it reports only whether the cost model has been verified, and
 * PHASES 0.10 wants that banner visible without a login. Everything with real numbers in it is
 * SUPERADMIN-only.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { computeMonthlyBudget, type Env, PLANS } from '@tc/config';
import { z } from 'zod';
import { ENV } from '../../common/env.token.js';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsService } from '../flags/flags.service.js';
import { PlatformBudgetService } from '../usage/platform-budget.service.js';
import { AdminService } from './admin.service.js';
import { AlertsService } from './alerts.service.js';
import { FeedbackService } from './feedback.service.js';
import { SuperadminGuard } from './superadmin.guard.js';
import { UsersService } from './users.service.js';

/** Query strings are always strings; coerce and bound them here rather than trusting them. */
const usersQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const flagBody = z.object({ enabled: z.boolean() });
const planBody = z.object({ plan: z.enum(PLANS) });
/**
 * The roles an admin may hand out (2026-09-25). GUIDE is not one of them: the share flow sets it
 * on the person a student invites, and nothing else should.
 */
export const ASSIGNABLE_ROLES = ['STUDENT', 'INSTITUTION_ADMIN', 'SUPERADMIN'] as const;
const roleBody = z.object({ role: z.enum(ASSIGNABLE_ROLES) });
const budgetBody = z.object({ ceilingInr: z.number().int().min(1).nullable() });
const feedbackBody = z.object({
  documentId: z.string().uuid(),
  message: z.string().trim().min(1).max(4_000),
  page: z.string().max(300).optional(),
});

@Controller('admin')
export class AdminController {
  constructor(
    private readonly flags: FlagsService,
    private readonly budget: PlatformBudgetService,
    private readonly admin: AdminService,
    private readonly alerts: AlertsService,
    private readonly users: UsersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** PHASES 5.9: every pilot student's usage on one screen — a page at a time. */
  @Get('users')
  @UseGuards(SessionGuard, SuperadminGuard)
  listUsers(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const parsed = usersQuery.safeParse({ limit, offset });
    if (!parsed.success) throw new ValidationError('limit and offset must be whole numbers.');
    return this.users.list(parsed.data);
  }

  @Get('users/:id')
  @UseGuards(SessionGuard, SuperadminGuard)
  getUser(@Param('id') id: string) {
    return this.users.get(id);
  }

  /** PHASES 5.9 "reset caps (logged)": the admin's id goes into the audit row. */
  @Post('users/:id/reset-caps')
  @HttpCode(200)
  @UseGuards(SessionGuard, SuperadminGuard)
  resetCaps(@CurrentUser() admin: SessionUser, @Param('id') id: string) {
    return this.users.resetCaps(admin.id, id);
  }

  /** PHASES 5.8: pilot accounts get STUDENT_MONTHLY caps by admin override. */
  @Put('users/:id/plan')
  @UseGuards(SessionGuard, SuperadminGuard)
  setPlan(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const parsed = planBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid plan', parsed.error.issues);
    return this.users.setPlan(admin.id, id, parsed.data.plan);
  }

  /**
   * Make someone an admin, or stop them being one (2026-09-25). Until this existed the only
   * superadmin was the one the seed made from `SEED_ADMIN_EMAIL`, so a second administrator —
   * the owner's manager, an HR admin — had no way in short of editing the database.
   */
  @Put('users/:id/role')
  @UseGuards(SessionGuard, SuperadminGuard)
  setRole(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const parsed = roleBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid role', parsed.error.issues);
    return this.users.setRole(admin.id, id, parsed.data.role);
  }

  /**
   * PRD §0.3 rule 5 and Appendix E.3: until a human has filled the verification ledger, the
   * dashboard header must read `Cost model: UNVERIFIED`, and Phase 1 week 4 cannot be marked done.
   */
  @Get('cost-model')
  async costModel(): Promise<{
    verified: boolean;
    banner: string | null;
    projectedMonthlyInr: number;
    ceilingInr: number;
    withinCeiling: boolean;
  }> {
    const verified = await this.flags.isEnabled('costModelVerified');
    // Priced at the models this deployment runs (ADR-0011, ADR-0030), as `pnpm ai:verify` does.
    // Priced by tier alone it showed the PRD's reference-price figure, ₹197.84 and "within
    // ceiling: No", on an admin screen whose real answer is ₹25.60 and "Yes" (2026-09-25).
    const budget = computeMonthlyBudget('STUDENT_MONTHLY', {
      models: { fast: this.env.AI_FAST_MODEL, strong: this.env.AI_STRONG_MODEL },
    });

    return {
      verified,
      banner: verified
        ? null
        : 'Cost model: UNVERIFIED — run `pnpm ai:verify` with real provider keys and fill PRD Appendix E.3.',
      projectedMonthlyInr: Number(budget.totalInr.toFixed(2)),
      ceilingInr: budget.ceilingInr,
      withinCeiling: budget.withinCeiling,
    };
  }

  /** §9.4 `/admin/costs` — what the AI actually cost this period (PHASES 4.3). */
  @Get('costs')
  @UseGuards(SessionGuard, SuperadminGuard)
  costs() {
    return this.admin.costs();
  }

  /** §9.4 `/admin/telemetry` — what students did with it (PHASES 4.4, FR-9.4). */
  @Get('telemetry')
  @UseGuards(SessionGuard, SuperadminGuard)
  telemetry() {
    return this.admin.telemetry();
  }

  /** The caps each plan enforces, shown beside actual use (FR-9.2). */
  @Get('plans')
  @UseGuards(SessionGuard, SuperadminGuard)
  plans() {
    return this.admin.plans();
  }

  /** §14 alerts, evaluated now rather than on the 15-minute timer (PHASES 4.6). */
  @Post('alerts/evaluate')
  @HttpCode(200)
  @UseGuards(SessionGuard, SuperadminGuard)
  evaluateAlerts() {
    return this.alerts.evaluate();
  }

  /** The site-wide monthly AI budget (2026-09-25): spend so far against the number, and its source. */
  @Get('platform-budget')
  @UseGuards(SessionGuard, SuperadminGuard)
  platformBudget() {
    return this.budget.status();
  }

  /** Sets it (null switches the site-wide stop off). Logged as PLATFORM_BUDGET_CHANGED. */
  @Put('platform-budget')
  @UseGuards(SessionGuard, SuperadminGuard)
  setPlatformBudget(@CurrentUser() admin: SessionUser, @Body() body: unknown) {
    const parsed = budgetBody.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('A whole number of rupees, or null for off', parsed.error.issues);
    }
    return this.budget.setCeiling(admin.id, parsed.data.ceilingInr);
  }

  @Get('flags')
  @UseGuards(SessionGuard, SuperadminGuard)
  flagList() {
    return this.admin.flags();
  }

  /** FR-9.7 / PHASES 4.9. The cache is invalidated so the next call sees the change at once. */
  @Put('flags/:key')
  @UseGuards(SessionGuard, SuperadminGuard)
  async setFlag(@Param('key') key: string, @Body() body: unknown) {
    const parsed = flagBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid flag payload', parsed.error.issues);
    const updated = await this.admin.setFlag(key, parsed.data.enabled);
    this.flags.invalidate();
    return updated;
  }
}

/** PHASES 5.9: the feedback link. Any signed-in student, about their own document. */
@Controller('feedback')
@UseGuards(SessionGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(200)
  send(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = feedbackBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid feedback', parsed.error.issues);
    return this.feedback.send(user, parsed.data);
  }
}
