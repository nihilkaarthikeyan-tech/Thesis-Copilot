import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { PlatformBudgetService } from './platform-budget.service.js';
import { UsageController } from './usage.controller.js';
import { UsageService } from './usage.service.js';

@Module({
  controllers: [UsageController],
  providers: [UsageService, PlatformBudgetService, SessionGuard],
  exports: [UsageService, PlatformBudgetService],
})
export class UsageModule {}
