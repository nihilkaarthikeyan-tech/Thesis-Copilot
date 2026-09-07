import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { UsageModule } from '../usage/usage.module.js';
import { MemoryController } from './memory.controller.js';
import { OutlineController } from './outline.controller.js';
import { OutlineService } from './outline.service.js';
import { ProposalController } from './proposal.controller.js';
import { ProposalService } from './proposal.service.js';
import { StyleService } from './style.service.js';

@Module({
  // FR-3.6's per-section regeneration is metered against the COMMAND cap (ADR-0008).
  imports: [UsageModule],
  controllers: [MemoryController, ProposalController, OutlineController],
  exports: [StyleService],
  providers: [SessionGuard, ProposalService, OutlineService, StyleService, QueueService],
})
export class MemoryModule {}
