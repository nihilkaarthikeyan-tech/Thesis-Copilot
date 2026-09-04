/**
 * Admin dashboard — PRD §11.5 and §14. Empty in Phase 0 apart from the cost-model banner that
 * PHASES task 0.10 requires.
 *
 * Guarded to SUPERADMIN in week 4 when the dashboard gets real numbers (PHASES 4.5). There is
 * nothing to protect yet: the only route reports whether the cost model has been verified.
 */

import { Controller, Get } from '@nestjs/common';
import { computeMonthlyBudget } from '@tc/config';
import { FlagsService } from '../flags/flags.service.js';

@Controller('admin')
export class AdminController {
  constructor(private readonly flags: FlagsService) {}

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
}
