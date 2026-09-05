import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsModule } from '../flags/flags.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { SuperadminGuard } from './superadmin.guard.js';

@Module({
  imports: [FlagsModule],
  controllers: [AdminController],
  providers: [AdminService, SessionGuard, SuperadminGuard],
  exports: [AdminService],
})
export class AdminModule {}
