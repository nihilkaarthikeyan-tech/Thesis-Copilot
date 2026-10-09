/** Account deletion (PRD §12.2) and email change (ADR-0015). */

import { Module } from '@nestjs/common';
import { DocumentEraser } from '../../common/document-eraser.service.js';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AccountController } from './account.controller.js';
import { DeletionScheduler } from './deletion.scheduler.js';
import { DeletionService } from './deletion.service.js';
import { EmailChangeService } from './email-change.service.js';
import { PasswordService } from './password.service.js';
import { UnsubscribeController } from './unsubscribe.controller.js';

@Module({
  controllers: [AccountController, UnsubscribeController],
  providers: [
    DeletionService,
    DeletionScheduler,
    EmailChangeService,
    PasswordService,
    StorageService,
    DocumentEraser,
    SessionGuard,
  ],
  exports: [DeletionService],
})
export class AccountModule {}
