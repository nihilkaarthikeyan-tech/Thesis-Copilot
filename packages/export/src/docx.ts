/**
 * Plain `.docx` export — PRD FR-8.1, PHASES 4.7.
 *
 *   "headings, paragraphs, lists, tables, images, citations rendered in current style,
 *    bibliography appended."
 *
 * The input is the chapter's ProseMirror JSON, which is the only place the document really lives
 * (Appendix B.2). Citations are inline atoms carrying ids, not text, so the label comes from the
 * same rendered map the editor shows — the exported file says exactly what the student saw.
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';

type PmMark = { type?: string; attrs?: Record<string, unknown> };
type PmNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: PmMark[];
  content?: PmNode[];
};

export type ExportOptions = {
  /** Chapter title, used as the document's heading 1. */
  title: string;
  /** Citation node key → rendered label, e.g. "(Kumar et al., 2021)". */
  renderedMap?: Record<string, string>;
  /** Bibliography lines, already formatted and sorted by the citation layer. */
  bibliography?: readonly string[];
  /** Images by object-storage key. Absent keys become a placeholder line, never a broken file. */
  images?: Record<string, { data: Uint8Array; width: number; height: number }>;
};

const HEADING = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

/** A citation renders as its label; an unresolved one is marked rather than silently dropped. */
function citationLabel(node: PmNode, renderedMap: Record<string, string>): string {
  const key = typeof node.attrs?.key === 'string' ? node.attrs.key : '';
  return renderedMap[key] ?? '(source missing)';
}

function runsFrom(nodes: readonly PmNode[], options: ExportOptions): TextRun[] {
  const runs: TextRun[] = [];
  const renderedMap = options.renderedMap ?? {};

  for (const node of nodes) {
    if (node.type === 'citation') {
      runs.push(new TextRun({ text: citationLabel(node, renderedMap) }));
      continue;
    }
    if (node.type === 'needsSourceNote') {
      // A gap the student never resolved. It ships visible, because hiding it would be the one
      // thing this product must never do.
      runs.push(
        new TextRun({ text: `[NEEDS SOURCE: ${String(node.attrs?.text ?? '')}]`, bold: true }),
      );
      continue;
    }
    if (node.type === 'hardBreak') {
      runs.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (typeof node.text !== 'string') continue;

    const marks = new Set((node.marks ?? []).map((mark) => mark.type));
    runs.push(
      new TextRun({
        text: node.text,
        bold: marks.has('bold'),
        italics: marks.has('italic'),
        underline: marks.has('underline') ? {} : undefined,
        strike: marks.has('strike'),
        superScript: marks.has('superscript'),
        subScript: marks.has('subscript'),
      }),
    );
  }
  return runs;
}

function paragraphsFrom(
  node: PmNode,
  options: ExportOptions,
  context: { listLevel?: number; ordered?: boolean } = {},
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];

  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 2);
      out.push(
        new Paragraph({
          heading: HEADING[level as 1 | 2 | 3] ?? HeadingLevel.HEADING_3,
          children: runsFrom(node.content ?? [], options),
        }),
      );
      break;
    }

    case 'paragraph':
      out.push(
        new Paragraph({
          children: runsFrom(node.content ?? [], options),
          ...(context.listLevel !== undefined
            ? {
                bullet: context.ordered ? undefined : { level: context.listLevel },
                numbering: context.ordered
                  ? { reference: 'ordered', level: context.listLevel }
                  : undefined,
              }
            : {}),
        }),
      );
      break;

    case 'blockquote':
      for (const child of node.content ?? []) {
        out.push(
          new Paragraph({
            children: runsFrom(child.content ?? [], options),
            indent: { left: 720 },
          }),
        );
      }
      break;

    case 'codeBlock':
      out.push(
        new Paragraph({
          children: [new TextRun({ text: textOf(node), font: 'Consolas' })],
        }),
      );
      break;

    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList';
      const level = (context.listLevel ?? -1) + 1;
      for (const item of node.content ?? []) {
        for (const child of item.content ?? []) {
          out.push(...paragraphsFrom(child, options, { listLevel: level, ordered }));
        }
      }
      break;
    }

    case 'table':
      out.push(tableFrom(node, options));
      break;

    case 'image': {
      const key = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
      const image = options.images?.[key];
      if (image) {
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: 'png',
                data: image.data,
                transformation: { width: image.width, height: image.height },
              }),
            ],
          }),
        );
      } else {
        // A missing image must not corrupt the file; the student sees where it was.
        out.push(new Paragraph({ children: [new TextRun({ text: '[image]', italics: true })] }));
      }
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
      if (alt) {
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: alt, italics: true, size: 20 })],
          }),
        );
      }
      break;
    }

    case 'draftBlock':
      // An unaccepted draft is not part of the thesis. Exporting it would put text the student
      // never approved into the file they submit.
      break;

    default:
      for (const child of node.content ?? []) {
        out.push(...paragraphsFrom(child, options, context));
      }
  }

  return out;
}

function tableFrom(node: PmNode, options: ExportOptions): Table {
  const rows = (node.content ?? []).map((row) => {
    const cells = (row.content ?? []).map((cell) => {
      const blocks = (cell.content ?? []).flatMap((child) =>
        paragraphsFrom(child, options).filter(
          (item): item is Paragraph => item instanceof Paragraph,
        ),
      );
      return new TableCell({ children: blocks.length > 0 ? blocks : [new Paragraph('')] });
    });
    return new TableRow({
      children: cells.length > 0 ? cells : [new TableCell({ children: [new Paragraph('')] })],
    });
  });
  return new Table({
    rows:
      rows.length > 0
        ? rows
        : [new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] })],
  });
}

function textOf(node: PmNode): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(textOf).join('');
}

/**
 * Builds the `.docx`. The bibliography is appended under its own heading, which is where FR-8.1
 * puts it and where an examiner expects it.
 */
export async function chapterToDocx(doc: unknown, options: ExportOptions): Promise<Buffer> {
  const root = (doc ?? {}) as PmNode;
  const body: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(options.title)] }),
    ...(root.content ?? []).flatMap((node) => paragraphsFrom(node, options)),
  ];

  const bibliography = options.bibliography ?? [];
  if (bibliography.length > 0) {
    body.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('References')] }),
      ...bibliography.map(
        (entry) =>
          new Paragraph({ children: [new TextRun(entry)], indent: { left: 720, hanging: 720 } }),
      ),
    );
  }

  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: 'decimal' as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [{ children: body }],
  });

  return Packer.toBuffer(document);
}
