/**
 * `extract-paper` — PRD FR-1.2, Appendix A.5, PHASES 1-W2 task 2.3.
 *
 * Reads an uploaded seed paper out of object storage, extracts its text (unpdf or mammoth), runs
 * A.5 over it on the Strong tier, validates against `PaperExtraction` (§10.7.1), and stores the
 * result on the `SeedPaper` row. Then seeds the document's glossary from the extracted terminology
 * (FR-3.5) and creates one `Source` per reference so resolution can start (FR-2.1).
 *
 * Failure is recorded on the row with a readable reason, which is what FR-1.1's acceptance
 * criterion asks the UI to show.
 */

import { extractPaper, type GlossaryValue, type LlmProvider, mergeTerminology } from '@tc/ai';
import type { PrismaClient } from '@tc/db';
import { extractDocument } from '@tc/retrieval';
import type { ExtractPaperJob, PaperExtraction } from '@tc/types';

export type ExtractPaperDeps = {
  prisma: PrismaClient;
  llm: LlmProvider;
  /** Reads an object out of storage by key. */
  getObject: (key: string) => Promise<Buffer>;
  /** Enqueues the follow-on reference resolution jobs. */
  enqueueResolve: (input: {
    documentId: string;
    userId: string;
    rawReference: string;
    printedDoi?: string;
  }) => Promise<unknown>;
  log?: (event: Record<string, unknown>) => void;
};

export type ExtractPaperResult = {
  seedPaperId: string;
  title: string;
  references: number;
  terminology: number;
  parts: number;
  retries: number;
  pages: number;
  twoColumnPages: number[];
  queuedResolutions: number;
};

export async function runExtractPaper(
  job: ExtractPaperJob,
  deps: ExtractPaperDeps,
): Promise<ExtractPaperResult> {
  const log = deps.log ?? (() => undefined);

  const seedPaper = await deps.prisma.seedPaper.findUnique({
    where: { id: job.seedPaperId },
    select: { id: true, documentId: true, fileKey: true, filename: true },
  });
  if (!seedPaper) throw new Error(`seed paper ${job.seedPaperId} no longer exists`);

  await deps.prisma.seedPaper.update({
    where: { id: seedPaper.id },
    data: { status: 'EXTRACTING', error: null },
  });

  try {
    const bytes = await deps.getObject(seedPaper.fileKey);
    const kind = seedPaper.filename.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';
    const document = await extractDocument(new Uint8Array(bytes), kind);

    if (document.text.trim().length === 0) {
      throw new Error(
        'No text could be read from this file. It may be a scan; run OCR on it and upload again.',
      );
    }

    log({
      msg: 'extracted text',
      seedPaperId: seedPaper.id,
      pages: document.totalPages,
      characters: document.text.length,
      twoColumnPages: document.twoColumnPages,
      usedFallback: document.usedFallback,
    });

    const { extraction, parts, retries } = await extractPaper(deps.llm, {
      userId: job.userId,
      documentId: job.documentId,
      filename: seedPaper.filename,
      text: document.text,
      onPart: (info) => log({ msg: 'extraction part', seedPaperId: seedPaper.id, ...info }),
    });

    await deps.prisma.seedPaper.update({
      where: { id: seedPaper.id },
      data: { extraction: extraction as never, status: 'DONE', error: null },
    });

    const glossaryConflicts = await seedGlossary(
      deps.prisma,
      job.documentId,
      extraction,
      seedPaper.filename,
    );
    if (glossaryConflicts.length > 0) {
      log({
        msg: 'glossary terms defined differently',
        seedPaperId: seedPaper.id,
        terms: glossaryConflicts,
      });
    }
    const queuedResolutions = await createSources(deps, job, extraction);

    return {
      seedPaperId: seedPaper.id,
      title: extraction.title,
      references: extraction.references.length,
      terminology: extraction.terminology.length,
      parts,
      retries,
      pages: document.totalPages,
      twoColumnPages: document.twoColumnPages,
      queuedResolutions,
    };
  } catch (error) {
    const reason = readableReason(error);
    await deps.prisma.seedPaper.update({
      where: { id: seedPaper.id },
      data: { status: 'FAILED', error: reason },
    });
    throw error;
  }
}

/**
 * FR-3.5: the glossary is seeded from the paper's own terminology, so the first Assist call already
 * knows the student's vocabulary. Existing entries win — the student's edits are never overwritten.
 */
async function seedGlossary(
  prisma: PrismaClient,
  documentId: string,
  extraction: PaperExtraction,
  paper: string,
): Promise<string[]> {
  if (extraction.terminology.length === 0) return [];

  const memory = await prisma.documentMemory.findUnique({
    where: { documentId },
    select: { glossary: true },
  });

  // PHASES 6.2: dedupe by term; a second paper's differing definition is kept alongside the
  // first and the entry is flagged, never silently overwritten.
  const { glossary, conflicts } = mergeTerminology(
    (memory?.glossary as Record<string, GlossaryValue>) ?? {},
    paper,
    extraction.terminology,
  );

  await prisma.documentMemory.update({
    where: { documentId },
    data: { glossary: glossary as never },
  });
  return conflicts;
}

/**
 * FR-2.1: one `Source` per extracted reference, then a resolution job each. Idempotent by
 * `documentId + rawReference`, so a retried extraction does not double the library.
 */
async function createSources(
  deps: ExtractPaperDeps,
  job: ExtractPaperJob,
  extraction: PaperExtraction,
): Promise<number> {
  const existing = await deps.prisma.source.findMany({
    where: { documentId: job.documentId },
    select: { rawReference: true },
  });
  const seen = new Set(existing.map((s) => s.rawReference).filter(Boolean) as string[]);

  let queued = 0;
  for (const reference of extraction.references) {
    const raw = reference.raw.trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);

    await deps.prisma.source.create({
      data: {
        documentId: job.documentId,
        status: 'PENDING',
        rawReference: raw,
        ...(reference.doi ? { doi: reference.doi } : {}),
      },
    });

    await deps.enqueueResolve({
      documentId: job.documentId,
      userId: job.userId,
      rawReference: raw,
      ...(reference.doi ? { printedDoi: reference.doi } : {}),
    });
    queued++;
  }

  return queued;
}

/** A message a student can act on, not a stack trace (FR-1.1 AC: "failures show a readable reason"). */
export function readableReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/no text could be read/i.test(message)) return message;
  if (/password|encrypt/i.test(message)) {
    return 'This PDF is password-protected. Remove the password and upload it again.';
  }
  if (/invalid pdf|corrupt|xref/i.test(message)) {
    return 'This file could not be opened as a PDF. Try re-exporting it.';
  }
  if (/extraction failed/i.test(message)) {
    return 'The paper was read but could not be summarised. Try uploading it again.';
  }
  return message.slice(0, 300);
}
