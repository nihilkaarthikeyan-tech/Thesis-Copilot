import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { DocumentsController } from './documents.controller.js';
import { NextActionService } from './next-action.service.js';

@Module({ controllers: [DocumentsController], providers: [SessionGuard, NextActionService] })
export class DocumentsModule {}
