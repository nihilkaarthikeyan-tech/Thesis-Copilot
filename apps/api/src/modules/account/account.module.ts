/** Account deletion (PRD §12.2) and email change (ADR-0015). */

import { Module } from '@nestjs/common';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AccountController } from './account.controller.js';
import { DeletionScheduler } from './deletion.scheduler.js';
import { DeletionService } from './deletion.service.js';
import { EmailChangeService } from './email-change.service.js';
import { PasswordService } from './password.service.js';

@Module({
  controllers: [AccountController],
  providers: [
    DeletionService,
    DeletionScheduler,
    EmailChangeService,
    PasswordService,
    StorageService,
    SessionGuard,
  ],
  exports: [DeletionService],
})
export class AccountModule {}
