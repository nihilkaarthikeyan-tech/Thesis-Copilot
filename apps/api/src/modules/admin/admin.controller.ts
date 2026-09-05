/**
 * Admin dashboards — PRD §9.4, §11.5, §14, PHASES 4.3, 4.4, 4.5, 4.9.
 *
 * `/admin/cost-model` stays open: it reports only whether the cost model has been verified, and
 * PHASES 0.10 wants that banner visible without a login. Everything with real numbers in it is
 * SUPERADMIN-only.
 */

import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { computeMonthlyBudget } from '@tc/config';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsService } from '../flags/flags.service.js';
import { AdminService } from './admin.service.js';
import { SuperadminGuard } from './superadmin.guard.js';

const flagBody = z.object({ enabled: z.boolean() });

@Controller('admin')
export class AdminController {
  constructor(
    private readonly flags: FlagsService,
    private readonly admin: AdminService,
  ) {}

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
    const budget = computeMonthlyBudget('STUDENT_MONTHLY');

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
