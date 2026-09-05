import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { MemoryController } from './memory.controller.js';
import { OutlineController } from './outline.controller.js';
import { OutlineService } from './outline.service.js';
import { ProposalController } from './proposal.controller.js';
import { ProposalService } from './proposal.service.js';

@Module({
  controllers: [MemoryController, ProposalController, OutlineController],
  providers: [SessionGuard, ProposalService, OutlineService, QueueService],
})
export class MemoryModule {}
