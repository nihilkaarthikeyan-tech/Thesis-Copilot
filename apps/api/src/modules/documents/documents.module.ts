import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { DocumentsController } from './documents.controller.js';

@Module({ controllers: [DocumentsController], providers: [SessionGuard] })
export class DocumentsModule {}
