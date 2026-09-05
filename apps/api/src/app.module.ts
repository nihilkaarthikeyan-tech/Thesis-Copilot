import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { AssistModule } from './modules/assist/assist.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChaptersModule } from './modules/chapters/chapters.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { FlagsModule } from './modules/flags/flags.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';
import { UsageModule } from './modules/usage/usage.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        // PRD §14: a request id is propagated to jobs.
        genReqId: (req: IncomingMessage) =>
          (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
        // PRD §12.1: never log request bodies of AI endpoints, and never log secrets.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body',
            'res.headers["set-cookie"]',
          ],
          remove: true,
        },
        autoLogging: {
          ignore: (req: IncomingMessage) => req.url === '/metrics' || req.url === '/api/v1/health',
        },
      },
    }),
    AppConfigModule,
    AuthModule,
    HealthModule,
    MetricsModule,
    FlagsModule,
    UsageModule,
    DocumentsModule,
    AiModule,
    ChaptersModule,
    AssistModule,
    AdminModule,
  ],
})
export class AppModule {}
