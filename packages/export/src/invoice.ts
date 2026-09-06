/**
 * Invoice document — PRD FR-9.5, PHASES v2 W11.2 ("invoice PDF per charge").
 *
 * Lives here rather than in the API because this package owns `docx`: one dependency on it, one
 * PDF pipeline (`docx` → Gotenberg), and an invoice that renders through the same path a thesis
 * chapter does.
 */

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

export type InvoiceInput = {
  /** `TC-2026-09-1a2b3c` — what the student quotes when asking about a charge. */
  number: string;
  /** When the charge happened. */
  date: Date;
  billedTo: string;
  planLabel: string;
  /** "one month" / "one year" of access. */
  periodLabel: string;
  amountInr: number;
  /** Last day of access this charge bought, when it is known. */
  accessThrough?: string | null;
  seller?: { name: string; line2?: string };
};

const line = (text: string, bold = false) =>
  new Paragraph({ children: [new TextRun({ text, bold })] });

/** Builds the `.docx`; the caller converts it to PDF and stores it. */
export async function invoiceToDocx(input: InvoiceInput): Promise<Buffer> {
  const seller = input.seller ?? { name: 'Thesis Copilot' };
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun(seller.name)],
          }),
          ...(seller.line2 ? [line(seller.line2)] : []),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `Invoice ${input.number}`, bold: true })],
          }),
          line(`Date: ${input.date.toISOString().slice(0, 10)}`),
          line(`Billed to: ${input.billedTo}`),
          line(''),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun('What was charged')],
          }),
          line(`${input.planLabel} — ${input.periodLabel} of access`),
          ...(input.accessThrough ? [line(`Access through: ${input.accessThrough}`)] : []),
          line(''),
          line(`Total: INR ${input.amountInr.toFixed(2)}`, true),
          line(''),
          line(
            'Paid through Razorpay. This invoice is generated from the charge recorded against your subscription.',
          ),
          line('Cancel any time from Account; you keep what you have paid for until it expires.'),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(document));
}
