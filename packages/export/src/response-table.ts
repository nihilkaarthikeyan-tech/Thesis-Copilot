/**
 * Response-to-committee table — PRD Appendix D.2.5, PHASES v2 B2.6.
 *
 *   "`.docx` with a table: `No. | Guide's comment | Location (chapter, section) | Action taken
 *    (Accepted as suggested / Revised manually / Not changed — reason) | Revised text (first 60
 *    words)`. Sorted by chapter. Includes a header with document title, student name, guide email,
 *    and export date."
 *
 * This is the document a student hands their committee, so it says what happened to every comment
 * including the ones they refused — with the reason they gave at the time. A table that quietly
 * omitted the rejections would be worse than no table.
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

export type ResponseRow = {
  comment: string;
  chapterTitle: string;
  section?: string | null;
  status: 'ACCEPTED' | 'EDITED' | 'REJECTED' | 'OPEN';
  resolutionNote?: string | null;
  /** The passage as it reads now, after whatever the student did. */
  revisedText?: string | null;
};

export type ResponseTableInput = {
  documentTitle: string;
  studentName: string;
  guideEmails: readonly string[];
  exportedAt: Date;
  rows: readonly ResponseRow[];
};

/** D.2.5's four wordings, and nothing else — a committee reads these as a fixed vocabulary. */
export function actionTaken(row: ResponseRow): string {
  switch (row.status) {
    case 'ACCEPTED':
      return 'Accepted as suggested';
    case 'EDITED':
      return 'Revised manually';
    case 'REJECTED':
      return `Not changed — ${row.resolutionNote?.trim() || 'no reason recorded'}`;
    default:
      return 'Still open';
  }
}

export function firstWords(text: string | null | undefined, count = 60): string {
  const words = (text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return '';
  return words.length <= count ? words.join(' ') : `${words.slice(0, count).join(' ')}…`;
}

const cell = (text: string, bold = false) =>
  new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    width: { size: 20, type: WidthType.PERCENTAGE },
  });

export async function responseTableToDocx(input: ResponseTableInput): Promise<Buffer> {
  const header = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Response to comments')],
    }),
    new Paragraph({ children: [new TextRun(input.documentTitle)] }),
    new Paragraph({ children: [new TextRun(`Student: ${input.studentName}`)] }),
    new Paragraph({
      children: [
        new TextRun(
          `Reviewer${input.guideEmails.length === 1 ? '' : 's'}: ${input.guideEmails.join(', ') || '—'}`,
        ),
      ],
    }),
    new Paragraph({
      children: [new TextRun(`Prepared: ${input.exportedAt.toISOString().slice(0, 10)}`)],
    }),
    new Paragraph({ children: [new TextRun('')] }),
  ];

  const rows = [
    new TableRow({
      children: [
        cell('No.', true),
        cell('Comment', true),
        cell('Location', true),
        cell('Action taken', true),
        cell('Revised text', true),
      ],
    }),
    ...input.rows.map(
      (row, index) =>
        new TableRow({
          children: [
            cell(String(index + 1)),
            cell(row.comment),
            cell([row.chapterTitle, row.section].filter(Boolean).join(' · ')),
            cell(actionTaken(row)),
            cell(firstWords(row.revisedText)),
          ],
        }),
    ),
  ];

  const document = new Document({
    sections: [
      {
        children: [
          ...header,
          new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: `${input.rows.length} comment${input.rows.length === 1 ? '' : 's'} in total.`,
                italics: true,
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(document));
}
