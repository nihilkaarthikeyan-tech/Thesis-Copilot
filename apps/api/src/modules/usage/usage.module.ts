import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { UsageController } from './usage.controller.js';
import { UsageService } from './usage.service.js';

@Module({
  controllers: [UsageController],
  providers: [UsageService, SessionGuard],
  exports: [UsageService],
})
export class UsageModule {}
