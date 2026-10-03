import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { MailerModule } from './common/mailer.module.js';
import { AppConfigModule } from './config.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { AssistModule } from './modules/assist/assist.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { ChapterBuildModule } from './modules/chapter-build/chapter-build.module.js';
import { ChaptersModule } from './modules/chapters/chapters.module.js';
import { CitationReportModule } from './modules/citation-report/citation-report.module.js';
import { CoherenceModule } from './modules/coherence/coherence.module.js';
import { CollabModule } from './modules/collab/collab.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { ExportModule } from './modules/export/export.module.js';
import { FeedbackModule } from './modules/feedback/feedback.module.js';
import { FlagsModule } from './modules/flags/flags.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InstitutionModule } from './modules/institution/institution.module.js';
import { JournalsModule } from './modules/journals/journals.module.js';
import { LifecycleModule } from './modules/lifecycle/lifecycle.module.js';
import { MemoryModule } from './modules/memory/memory.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';
import { OverlapModule } from './modules/overlap/overlap.module.js';
import { PromptsModule } from './modules/prompts/prompts.module.js';
import { SourcesModule } from './modules/sources/sources.module.js';
import { UsageModule } from './modules/usage/usage.module.js';
import { VivaModule } from './modules/viva/viva.module.js';

@Module({
  imports: [
    BillingModule,
    CoherenceModule,
    CollabModule,
    FeedbackModule,
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
    MailerModule,
    AuthModule,
    HealthModule,
    MetricsModule,
    FlagsModule,
    AccountModule,
    UsageModule,
    DocumentsModule,
    ExportModule,
    AiModule,
    ChaptersModule,
    CitationReportModule,
    AssistModule,
    SourcesModule,
    PromptsModule,
    MemoryModule,
    AdminModule,
    InstitutionModule,
    VivaModule,
    ChapterBuildModule,
    JournalsModule,
    OverlapModule,
    LifecycleModule,
  ],
})
export class AppModule {}
