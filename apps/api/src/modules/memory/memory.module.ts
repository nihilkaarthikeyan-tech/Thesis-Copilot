import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { MemoryController } from './memory.controller.js';

@Module({ controllers: [MemoryController], providers: [SessionGuard] })
export class MemoryModule {}
