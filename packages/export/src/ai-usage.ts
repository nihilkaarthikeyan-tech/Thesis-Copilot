/**
 * AI-usage log export — PRD FR-8.6, §12 (integrity), PHASES 4.8.
 *
 *   "per chapter, word counts by provenance (`human`, `assist`, `draft`, `command`,
 *    `human_edited`), number of AI actions, date range."
 *
 * This is the artefact that makes the product's integrity claim checkable: §12 says a student can
 * "disclose exactly what the AI did". So the numbers here must come from the document itself — the
 * provenance marks the editor maintains on save (B.4) — and never from an estimate. If the counts
 * and the chapter ever disagree, the chapter is right and this is wrong.
 */

import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';

/** The provenance kinds B.4 tracks, in the order FR-8.6 lists them. */
export const PROVENANCE_KINDS = ['HUMAN', 'ASSIST', 'DRAFT', 'COMMAND', 'HUMAN_EDITED'] as const;

export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export type WordCounts = Partial<Record<ProvenanceKind, number>>;

export type ChapterUsage = {
  title: string;
  wordCounts: WordCounts;
  /** AI actions recorded against this chapter (`SuggestionEvent`). */
  actions: number;
};

export type UsageReport = {
  documentTitle: string;
  chapters: readonly ChapterUsage[];
  /** Inclusive range the actions were counted over. */
  from: Date | null;
  to: Date | null;
};

const LABEL: Record<ProvenanceKind, string> = {
  HUMAN: 'Written by the student',
  ASSIST: 'Accepted from Assist',
  DRAFT: 'Accepted from Draft',
  COMMAND: 'Produced by a command',
  HUMAN_EDITED: 'AI text the student rewrote',
};

export function totalWords(counts: WordCounts): number {
  return PROVENANCE_KINDS.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0);
}

/** Percentage of a chapter that is not the student's own words, to one decimal place. */
export function aiShare(counts: WordCounts): number {
  const total = totalWords(counts);
  if (total === 0) return 0;
  // HUMAN_EDITED counts as the student's: they rewrote it, which is the point of the mark.
  const own = (counts.HUMAN ?? 0) + (counts.HUMAN_EDITED ?? 0);
  return Math.round(((total - own) / total) * 1000) / 10;
}

const formatDate = (date: Date | null): string =>
  date ? date.toISOString().slice(0, 10) : 'not recorded';

/** FR-8.6's CSV form. One row per chapter, plus a total. */
export function usageToCsv(report: UsageReport): string {
  const header = [
    'chapter',
    ...PROVENANCE_KINDS.map((kind) => kind.toLowerCase()),
    'total_words',
    'ai_share_percent',
    'ai_actions',
  ];

  const quote = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const rows = report.chapters.map((chapter) =>
    [
      quote(chapter.title),
      ...PROVENANCE_KINDS.map((kind) => String(chapter.wordCounts[kind] ?? 0)),
      String(totalWords(chapter.wordCounts)),
      String(aiShare(chapter.wordCounts)),
      String(chapter.actions),
    ].join(','),
  );

  const totals: WordCounts = {};
  for (const kind of PROVENANCE_KINDS) {
    totals[kind] = report.chapters.reduce((sum, c) => sum + (c.wordCounts[kind] ?? 0), 0);
  }
  const totalRow = [
    'TOTAL',
    ...PROVENANCE_KINDS.map((kind) => String(totals[kind] ?? 0)),
    String(totalWords(totals)),
    String(aiShare(totals)),
    String(report.chapters.reduce((sum, c) => sum + c.actions, 0)),
  ].join(',');

  return [header.join(','), ...rows, totalRow].join('\n');
}

/** FR-8.6's `.docx` form: the same numbers, as something a student can hand in. */
export async function usageToDocx(report: UsageReport): Promise<Buffer> {
  const totals: WordCounts = {};
  for (const kind of PROVENANCE_KINDS) {
    totals[kind] = report.chapters.reduce((sum, c) => sum + (c.wordCounts[kind] ?? 0), 0);
  }

  const headerRow = new TableRow({
    children: [
      'Chapter',
      ...PROVENANCE_KINDS.map((k) => LABEL[k]),
      'Total',
      'AI share',
      'Actions',
    ].map(
      (text) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
        }),
    ),
  });

  const bodyRows = report.chapters.map(
    (chapter) =>
      new TableRow({
        children: [
          chapter.title,
          ...PROVENANCE_KINDS.map((kind) => String(chapter.wordCounts[kind] ?? 0)),
          String(totalWords(chapter.wordCounts)),
          `${aiShare(chapter.wordCounts)}%`,
          String(chapter.actions),
        ].map((text) => new TableCell({ children: [new Paragraph(text)] })),
      }),
  );

  const totalRow = new TableRow({
    children: [
      'TOTAL',
      ...PROVENANCE_KINDS.map((kind) => String(totals[kind] ?? 0)),
      String(totalWords(totals)),
      `${aiShare(totals)}%`,
      String(report.chapters.reduce((sum, c) => sum + c.actions, 0)),
    ].map(
      (text) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
        }),
    ),
  });

  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('AI usage log')],
          }),
          new Paragraph({ children: [new TextRun(report.documentTitle)] }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Actions recorded between ${formatDate(report.from)} and ${formatDate(report.to)}.`,
                italics: true,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text:
                  'Word counts come from the document itself: every run of text carries a mark ' +
                  'recording where it came from, maintained as the chapter is written. ' +
                  '"AI text the student rewrote" counts towards the student’s own words.',
                italics: true,
                size: 20,
              }),
            ],
          }),
          new Table({ rows: [headerRow, ...bodyRows, totalRow] }),
        ],
      },
    ],
  });

  return Packer.toBuffer(document);
}
