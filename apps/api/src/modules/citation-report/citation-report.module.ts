/**
 * `GET /documents/:id/citation-report` — every weak citation in one place (2026-09-25).
 *
 * Reads only. The four checks it gathers are free and run on request; the coherence flags are
 * read as stored, so opening the report never spends a coherence run.
 */

import { Controller, Get, Injectable, Module, Param, UseGuards } from '@nestjs/common';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ChaptersModule } from '../chapters/chapters.module.js';
import { CitationsService } from '../chapters/citations.service.js';
import { CoherenceModule } from '../coherence/coherence.module.js';
import { CoherenceService } from '../coherence/coherence.service.js';
import { buildCitationReport, type CitationReport } from './citation-report.js';

@Injectable()
export class CitationReportService {
  constructor(
    private readonly citations: CitationsService,
    private readonly coherence: CoherenceService,
  ) {}

  async report(ownerId: string, documentId: string): Promise<CitationReport> {
    // Each call checks ownership itself; the first refusal is the answer.
    const [citations, health, depth, flags] = await Promise.all([
      this.citations.render(ownerId, documentId),
      this.citations.referenceHealth(ownerId, documentId),
      this.citations.readingDepth(ownerId, documentId),
      this.coherence.flags(ownerId, documentId, 'OPEN'),
    ]);
    return buildCitationReport({ citations, health: health.findings, depth, flags });
  }
}

@Controller('documents/:id')
@UseGuards(SessionGuard)
export class CitationReportController {
  constructor(private readonly reports: CitationReportService) {}

  @Get('citation-report')
  report(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.reports.report(user.id, documentId);
  }
}

@Module({
  imports: [ChaptersModule, CoherenceModule],
  controllers: [CitationReportController],
  providers: [CitationReportService, SessionGuard],
})
export class CitationReportModule {}
