/**
 * Full-thesis export and the compliance gate — PRD Appendix D.3.2, D.3.3, FR-8.1, PHASES v2 B3.3–B3.4.
 *
 * The gate is the interesting part. D.3.3 says a failing check "blocks PDF export (not `.docx`)
 * until fixed or explicitly overridden with a reason that is written to the export log", and the
 * three halves of that sentence are three separate decisions:
 *
 *   - **`.docx` is never blocked.** A student must always be able to get their own words out
 *     (§12.2), even mid-draft with half the front matter empty.
 *   - **The PDF waits**, because that is the artefact they hand in.
 *   - **An override is allowed and recorded.** A university's rule that our checker misreads must
 *     not trap someone the night before a deadline — but the reason goes in the audit log, so the
 *     decision has an author.
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  citationKeys,
  citationNodesIn,
  exportLibrary,
  isKnownStyle,
  resolveStyle,
} from '@tc/citations';
import type { Env } from '@tc/config';
import {
  type ComplianceResult,
  pageSetupOf,
  runComplianceChecks,
  type ThesisChapter,
  thesisToDocx,
  thesisToHtml,
  thesisToLatexZip,
  withoutPendingDrafts,
} from '@tc/export';
import {
  readTemplateSpec,
  readThesisDetails,
  type TemplateSpec,
  type ThesisDetails,
} from '@tc/types';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { CitationsService } from '../chapters/citations.service.js';
import { StyleStoreService } from '../chapters/style-store.service.js';
import { loadFigures } from './figure-bytes.js';
import { type Readiness, readiness } from './readiness.js';

export type TemplateView = {
  id: string;
  name: string;
  /** True for `EXAMPLE_IN_UNIVERSITY`: the export screen must warn (D.3.1). */
  isExample: boolean;
  spec: TemplateSpec;
};

export type ThesisExportResult = {
  url: string;
  key: string;
  filename: string;
  bytes: number;
  /** ADR-0044: lowercase hex SHA-256 of the exported bytes, for integrity verification. */
  sha256: string;
  format: ThesisExportFormat;
  compliance: ComplianceResult;
  /** Set when the PDF was produced despite failures, with the reason recorded. */
  overrideReason?: string;
};

/** D.3.2 step 5: "keep the last 5 exports per document". */
/**
 * `docx` and `pdf` are what a student submits; `latex` (a project .zip) and `html` (one page) are
 * working formats (ADR-0021). Only the PDF is gated on the compliance checks.
 */
export type ThesisExportFormat = 'docx' | 'pdf' | 'latex' | 'html';

const CONTENT_TYPES: Record<ThesisExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  latex: 'application/zip',
  html: 'text/html; charset=utf-8',
};

const KEEP_EXPORTS = 5;

@Injectable()
export class ThesisExportService {
  private readonly logger = new Logger(ThesisExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly citations: CitationsService,
    private readonly styleStore: StyleStoreService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        title: true,
        meta: true,
        citationStyle: true,
        institutionTemplateId: true,
        submissionDeadline: true,
        language: true,
      },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /** Every template a student can pick, with the example flagged. */
  async templates(): Promise<TemplateView[]> {
    const rows = await this.prisma.institutionTemplate.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      isExample: row.name === 'EXAMPLE_IN_UNIVERSITY',
      spec: readTemplateSpec(row.spec),
    }));
  }

  /** The template on this document, falling back to the example (D.3.1). */
  private async templateFor(
    institutionTemplateId: string | null,
  ): Promise<{ view: TemplateView; spec: TemplateSpec }> {
    const templates = await this.templates();
    const chosen =
      templates.find((t) => t.id === institutionTemplateId) ??
      templates.find((t) => t.isExample) ??
      templates[0];
    if (!chosen) {
      throw new ValidationError('No institution template is installed. Seed one first.');
    }
    return { view: chosen, spec: chosen.spec };
  }

  async details(
    ownerId: string,
    documentId: string,
  ): Promise<{
    details: ThesisDetails;
    template: TemplateView;
    templates: TemplateView[];
  }> {
    const document = await this.owned(ownerId, documentId);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    const { view } = await this.templateFor(document.institutionTemplateId);
    return {
      details: readThesisDetails(meta.thesisDetails),
      template: view,
      templates: await this.templates(),
    };
  }

  /** D.3.2 step 1: the form a student fills once. */
  async saveDetails(
    ownerId: string,
    documentId: string,
    details: ThesisDetails,
  ): Promise<{ details: ThesisDetails }> {
    const document = await this.owned(ownerId, documentId);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: documentId },
      data: { meta: { ...meta, thesisDetails: details } as never },
    });
    return { details };
  }

  async setTemplate(
    ownerId: string,
    documentId: string,
    templateId: string,
  ): Promise<TemplateView> {
    await this.owned(ownerId, documentId);
    const template = (await this.templates()).find((t) => t.id === templateId);
    if (!template) throw new NotFoundError('That template');
    await this.prisma.document.update({
      where: { id: documentId },
      data: { institutionTemplateId: templateId },
    });
    return template;
  }

  /**
   * D.3.3, run against the document as it stands. Called by the export screen before the student
   * presses anything, and again inside `exportThesis` against the file that was actually built.
   */
  async check(
    ownerId: string,
    documentId: string,
  ): Promise<ComplianceResult & { templateName: string; isExample: boolean }> {
    const document = await this.owned(ownerId, documentId);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    const { view, spec } = await this.templateFor(document.institutionTemplateId);
    const chapters = await this.prisma.chapter.findMany({
      where: { documentId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, order: true, content: true },
    });
    const rendered = await this.citations.render(ownerId, documentId);

    const result = runComplianceChecks({
      spec,
      details: readThesisDetails(meta.thesisDetails),
      documentTitle: document.title,
      chapters,
      citations: {
        orphans: rendered.counts.orphans,
        bibliographyEntries: rendered.bibliography.length,
        style: document.citationStyle,
      },
      actualPageSetup: pageSetupOf(spec),
    });
    return { ...result, templateName: view.name, isExample: view.isExample };
  }

  /**
   * The compliance result joined to the deadline — "eight of ten, and you have eleven days".
   *
   * A read of `check` plus one column. It deliberately adds no new judgement about whether the
   * thesis may be exported: `exportThesis` still owns that refusal, and a second opinion living
   * here would be a second thing to keep in step with D.3.3.
   */
  async readiness(
    ownerId: string,
    documentId: string,
  ): Promise<Readiness & { templateName: string }> {
    const [result, document] = await Promise.all([
      this.check(ownerId, documentId),
      this.owned(ownerId, documentId),
    ]);
    return {
      ...readiness({
        checks: result.checks.map((c) => ({
          check: c.check,
          label: c.label,
          passed: c.passed,
          findingCount: c.findings.length,
        })),
        deadline: document.submissionDeadline,
      }),
      templateName: result.templateName,
    };
  }

  /** The student telling us when it is due, or clearing it. */
  async setDeadline(
    ownerId: string,
    documentId: string,
    deadline: string | null,
  ): Promise<{ submissionDeadline: string | null }> {
    await this.owned(ownerId, documentId);
    // Parsed as a UTC midnight so the stored DATE is the day the student typed, not the day
    // before it in whatever timezone the server happens to run in.
    const value = deadline ? new Date(`${deadline}T00:00:00Z`) : null;
    if (deadline && Number.isNaN(value?.getTime())) {
      throw new ValidationError('That is not a date we can read. Use YYYY-MM-DD.');
    }
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { submissionDeadline: value },
      select: { submissionDeadline: true },
    });
    return {
      submissionDeadline: updated.submissionDeadline
        ? updated.submissionDeadline.toISOString().slice(0, 10)
        : null,
    };
  }

  /**
   * Builds the whole thesis. `.docx` always; `.pdf` only when the checklist passes or the student
   * overrides it with a reason.
   */
  async exportThesis(
    user: SessionUser,
    documentId: string,
    format: ThesisExportFormat,
    overrideReason?: string,
  ): Promise<ThesisExportResult> {
    const document = await this.owned(user.id, documentId);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    const details = readThesisDetails(meta.thesisDetails);
    const { view, spec } = await this.templateFor(document.institutionTemplateId);

    const chapterRows = await this.prisma.chapter.findMany({
      where: { documentId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, order: true, content: true },
    });
    if (chapterRows.length === 0) throw new ValidationError('This thesis has no chapters yet.');

    // FR-5.2: the bibliography and every label come from one citeproc pass over the whole
    // document, in the style the template demands rather than whatever the editor is showing.
    // Any style in the catalogue, not only the twenty shipped: a university template can name the
    // journal style its department follows.
    const styleForExport = isKnownStyle(spec.bibliography.style)
      ? spec.bibliography.style
      : document.citationStyle;
    // Loaded before the switch is written, so a failed download leaves the thesis on the style it
    // had rather than on one that cannot render.
    await this.styleStore.ensure(styleForExport);
    const previousStyle = document.citationStyle;
    if (styleForExport !== previousStyle) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { citationStyle: styleForExport },
      });
    }
    const rendered = await this.citations.render(user.id, documentId);

    const compliance = runComplianceChecks({
      spec,
      details,
      documentTitle: document.title,
      chapters: chapterRows,
      citations: {
        orphans: rendered.counts.orphans,
        bibliographyEntries: rendered.bibliography.length,
        style: styleForExport,
      },
      actualPageSetup: pageSetupOf(spec),
    });

    if (format === 'pdf' && !compliance.passed && !overrideReason?.trim()) {
      // Count the checks, not the findings: one missing title page is a dozen findings and
      // telling a student "12 checks failed" when three did overstates the work in front of them.
      const failed = compliance.checks.filter((c) => !c.passed).length;
      throw new ValidationError(
        `${failed} formatting check${failed === 1 ? '' : 's'} did not pass. Fix ${failed === 1 ? 'it' : 'them'}, export the .docx instead, or override with a reason.`,
        compliance.findings.map((f) => ({ message: f.message, path: [f.check] })),
      );
    }

    const chapters: ThesisChapter[] = chapterRows.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      order: chapter.order,
      content: chapter.content,
      renderedMap: rendered.labels,
    }));

    // Every chapter's figures in one map, keyed by storage path. Before this, a submitted thesis
    // carried a correctly numbered caption under a bracketed placeholder — the caption machinery
    // worked, and there was nothing above it.
    const images = Object.assign(
      {},
      ...(await Promise.all(
        chapters.map((chapter) =>
          loadFigures(this.storage, chapter.content, document.id, this.logger),
        ),
      )),
    );
    const exportedOn = new Date().toISOString().slice(0, 10);
    const base = slug(document.title);

    let body: Buffer;
    let filename: string;
    if (format === 'latex') {
      const style = resolveStyle(styleForExport);
      body = await thesisToLatexZip({
        spec,
        details,
        documentTitle: document.title,
        chapters,
        bibliography: rendered.bibliography.map((b) => b.text),
        images,
        ...(await this.latexCitations(documentId, chapterRows)),
        // biblatex's nearest built-in style; a note style's is `verbose-ibid` (ADR-0029).
        bibStyle: rendered.noteStyle
          ? 'verbose-ibid'
          : style.family === 'numeric'
            ? 'numeric'
            : 'authoryear',
        styleLabel: style.label,
        exportedOn,
      });
      filename = `${base}-latex.zip`;
    } else if (format === 'html') {
      body = Buffer.from(
        thesisToHtml({
          spec,
          details,
          documentTitle: document.title,
          chapters,
          bibliography: rendered.bibliography,
          citeSources: Object.fromEntries(
            citedNodes(chapterRows).map((node) => [node.nodeKey, node.sourceId] as const),
          ),
          images,
          language: document.language,
          exportedOn,
          noteStyle: rendered.noteStyle,
        }),
        'utf8',
      );
      filename = `${base}.html`;
    } else {
      const docx = await thesisToDocx({
        spec,
        details,
        documentTitle: document.title,
        chapters,
        bibliography: rendered.bibliography.map((b) => b.text),
        images,
        noteStyle: rendered.noteStyle,
      });
      body = format === 'pdf' ? await this.toPdf(docx, `${base}.docx`) : docx;
      filename = `${base}.${format}`;
    }
    const stored = await this.store(
      documentId,
      user.id,
      format,
      filename,
      body,
      CONTENT_TYPES[format],
    );

    if (format === 'pdf' && !compliance.passed && overrideReason?.trim()) {
      // D.3.3: the reason goes in the export log, so an override has an author and a date.
      await this.prisma.auditEvent.create({
        data: {
          kind: 'EXPORT_OVERRIDE',
          userId: user.id,
          documentId,
          detail: {
            reason: overrideReason.trim(),
            template: view.name,
            failed: [...new Set(compliance.findings.map((f) => f.check))],
          },
        },
      });
      this.logger.warn(
        { documentId, failed: compliance.findings.length },
        'PDF exported over failing compliance checks',
      );
    }

    await this.prune(documentId);
    return {
      ...stored,
      format,
      compliance,
      ...(overrideReason?.trim() ? { overrideReason: overrideReason.trim() } : {}),
    };
  }

  private async toPdf(docx: Buffer, filename: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(docx)]), filename);
    // D.3.2 step 3: LibreOffice fills the TOC/LOF/LOT indexes during the conversion, so the PDF
    // the student hands in has real page numbers rather than a field the reader must refresh.
    form.append('updateIndexes', 'true');
    form.append('exportFormFields', 'false');
    const response = await fetch(`${this.env.GOTENBERG_URL}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) throw new Error(`Gotenberg refused the conversion (HTTP ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async store(
    documentId: string,
    userId: string,
    format: ThesisExportFormat,
    filename: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ url: string; key: string; filename: string; bytes: number; sha256: string }> {
    const key = `exports/${documentId}/thesis/${Date.now()}-${filename}`;
    await this.storage.put(key, body, { 'content-type': contentType });
    // ADR-0044: fingerprint the exact bytes we stored, and keep a durable record of it.
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.prisma.exportArtifact.create({
      data: { documentId, userId, format, filename, storageKey: key, bytes: body.length, sha256 },
    });
    return { url: await this.storage.signedUrl(key), key, filename, bytes: body.length, sha256 };
  }

  /** ADR-0044: the recent export fingerprints for a thesis, newest first, owner-scoped. */
  async artifacts(
    ownerId: string,
    documentId: string,
  ): Promise<
    Array<{ format: string; filename: string; bytes: number; sha256: string; createdAt: string }>
  > {
    await this.owned(ownerId, documentId);
    const rows = await this.prisma.exportArtifact.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { format: true, filename: true, bytes: true, sha256: true, createdAt: true },
    });
    return rows.map((r) => ({
      format: r.format,
      filename: r.filename,
      bytes: r.bytes,
      sha256: r.sha256,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * What `main.tex` cites with and `references.bib` holds: the cited sources only, keyed by
   * `citationKeys` — the function `exportLibrary` keys the `.bib` with, over the same list in the
   * same order, so every `\parencite` finds its entry.
   */
  private async latexCitations(
    documentId: string,
    chapterRows: ReadonlyArray<{ id: string; title: string; content: unknown }>,
  ): Promise<{
    citeKeys: Record<string, string>;
    locators: Record<string, string | null>;
    bibtex: string;
  }> {
    const nodes = citedNodes(chapterRows);
    const cited = [...new Set(nodes.map((node) => node.sourceId).filter(Boolean))];
    const [sources, rows] = await Promise.all([
      this.prisma.source.findMany({
        where: { documentId, id: { in: cited } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          authors: true,
          year: true,
          venue: true,
          doi: true,
          cslJson: true,
          isPreprint: true,
          rawReference: true,
        },
      }),
      this.prisma.citation.findMany({
        where: { chapter: { documentId } },
        select: { nodeKey: true, locator: true },
      }),
    ]);
    const keys = citationKeys(sources);
    const citeKeys: Record<string, string> = {};
    for (const node of nodes) {
      const key = keys.get(node.sourceId);
      if (key) citeKeys[node.nodeKey] = key;
    }
    return {
      citeKeys,
      locators: Object.fromEntries(rows.map((row) => [row.nodeKey, row.locator])),
      // Without the library file's "RETRACTED" and "Not identified" notes, which biblatex would
      // print in the thesis's reference list; the editor's reference sweep is where those belong.
      bibtex: exportLibrary(sources, 'bib', { statusNotes: false }).body,
    };
  }

  /** D.3.2 step 5. Best-effort: a storage hiccup must not fail an export the student has. */
  private async prune(documentId: string): Promise<void> {
    try {
      const keys = await this.storage.list(`exports/${documentId}/thesis/`);
      if (keys.length <= KEEP_EXPORTS) return;
      const stale = [...keys].sort().slice(0, keys.length - KEEP_EXPORTS);
      for (const key of stale) await this.storage.remove(key);
    } catch (error) {
      this.logger.warn({ err: error, documentId }, 'could not prune old exports');
    }
  }
}

/** Every citation in the thesis as exported — an unaccepted draft's citations are not in it. */
function citedNodes(chapterRows: ReadonlyArray<{ id: string; title: string; content: unknown }>) {
  return chapterRows.flatMap((chapter) =>
    citationNodesIn({ ...chapter, content: withoutPendingDrafts(chapter.content) }),
  );
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'thesis'
  );
}
