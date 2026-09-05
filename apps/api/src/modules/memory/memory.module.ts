import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { MemoryController } from './memory.controller.js';
import { ProposalController } from './proposal.controller.js';
import { ProposalService } from './proposal.service.js';

@Module({
  controllers: [MemoryController, ProposalController],
  providers: [SessionGuard, ProposalService],
})
export class MemoryModule {}
