import { Module } from '@nestjs/common';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { InstitutionController } from './institution.controller.js';
import { InstitutionService } from './institution.service.js';

@Module({
  controllers: [InstitutionController],
  providers: [InstitutionService, StorageService, SessionGuard],
  // `AuthModule` claims an invite at sign-in (FR-9.6).
  exports: [InstitutionService],
})
export class InstitutionModule {}
