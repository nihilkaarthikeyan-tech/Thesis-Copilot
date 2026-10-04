/**
 * Small Word files for the "Import from Word" specs, built with the `docx` package at test time —
 * nothing binary is committed, and every fixture says in code what is in it.
 */

import {
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';

/** A 1×1 transparent PNG. */
const PIXEL = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8FFFF3F0005FE02FEA7D605A40000000049454E44AE426082',
  'hex',
);

export function heading1(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}

export function heading2(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

export function para(text: string): Paragraph {
  return new Paragraph(text);
}

export async function buildWord(
  children: Array<Paragraph | Table>,
  footnotes: Record<number, string> = {},
): Promise<Buffer> {
  const document = new Document({
    footnotes: Object.fromEntries(
      Object.entries(footnotes).map(([id, text]) => [id, { children: [new Paragraph(text)] }]),
    ),
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}

/**
 * A three-part thesis: a title page before the first Heading 1, an Introduction with every kind of
 * content the import keeps (and one picture it does not), and a short Methods chapter.
 */
export function thesisWord(): Promise<Buffer> {
  return buildWord(
    [
      para('A thesis submitted for the degree of Master of Science'),
      heading1('Introduction'),
      new Paragraph({
        children: [
          new TextRun('Groundwater in the district is '),
          new TextRun({ text: 'falling', bold: true }),
          new TextRun({ text: ' every year', italics: true }),
          new TextRun(' (Kumar, 2021).'),
          new FootnoteReferenceRun(1),
        ],
      }),
      heading2('Background'),
      new Paragraph({ text: 'Wells are deeper', bullet: { level: 0 } }),
      new Paragraph({ text: 'Pumps run longer', bullet: { level: 0 } }),
      new Paragraph({
        children: [
          new ImageRun({ type: 'png', data: PIXEL, transformation: { width: 8, height: 8 } }),
        ],
      }),
      new Table({
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [para('Year')] }),
              new TableCell({ children: [para('Depth')] }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({ children: [para('2020')] }),
              new TableCell({ children: [para('42 m')] }),
            ],
          }),
        ],
      }),
      heading1('Methods'),
      para('We surveyed forty villages, following Rao (2019) and earlier work [3].'),
    ],
    { 1: 'Central Ground Water Board figures.' },
  );
}
