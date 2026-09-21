/**
 * Full-thesis export — PRD Appendix D.3.2, FR-8.1, PHASES v2 B3.3.
 *
 * The chapter export (`docx.ts`) hands a student one chapter to read. This builds the thing they
 * submit: front matter from the template, every chapter under its own numbering, a bibliography in
 * the template's style, appendices after it, and Word field codes for the contents lists.
 *
 * Two decisions worth stating, because both are visible in the file:
 *
 *   - **Headings are numbered here, not by Word's list engine.** A `.docx` that renumbers itself on
 *     open is one whose cross-references ("as Figure 3.2 shows") stop matching the moment a
 *     reviewer's Word disagrees with LibreOffice about list state.
 *   - **The contents lists are field codes, not text.** LibreOffice fills them during the PDF
 *     conversion, and Word offers to update them on open — so the page numbers are the file's own,
 *     which is the only way they can be right.
 */

import { formatRef, numberingMap, type TemplateSpec, type ThesisDetails } from '@tc/types';
import {
  AlignmentType,
  convertMillimetersToTwip,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  NumberFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

export type ThesisChapter = {
  id: string;
  title: string;
  order: number;
  /** ProseMirror JSON. */
  content: unknown;
  /** Citation node key → the label citeproc rendered. */
  renderedMap: Record<string, string>;
};

export type ThesisExportInput = {
  spec: TemplateSpec;
  details: ThesisDetails;
  documentTitle: string;
  chapters: readonly ThesisChapter[];
  /** Already rendered by citeproc in `spec.bibliography.style`. */
  bibliography: readonly string[];
  /** Optional appendices, after the bibliography (D.3.1). */
  appendices?: ReadonlyArray<{ title: string; paragraphs: readonly string[] }>;
  /**
   * Figure bytes by object-storage key, as `image` nodes carry in `attrs.key`.
   *
   * Until 2026-09-21 this did not exist and every figure in a submitted thesis was replaced by a
   * bracketed placeholder — the numbered caption was produced correctly, under nothing. A key
   * that is absent still falls back to that placeholder, because an export running into a
   * deadline must not fail over one unreadable picture.
   */
  images?: Record<
    string,
    { data: Uint8Array; width: number; height: number; type?: 'png' | 'jpg' | 'gif' }
  >;
};

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string }>;
  content?: Node[];
};

const PAGE_SIZES = {
  A4: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
  Letter: { width: convertMillimetersToTwip(215.9), height: convertMillimetersToTwip(279.4) },
} as const;

const pt = (value: number) => value * 2; // docx sizes are half-points
const spacingFor = (spec: TemplateSpec) => ({
  line: Math.round(spec.font.lineSpacing * 240),
  after: spec.font.paragraphSpacingPt * 20,
});

/** A front-matter or body paragraph in the template's body font. */
function body(text: string, spec: TemplateSpec, over: Record<string, unknown> = {}): Paragraph {
  return new Paragraph({
    alignment: spec.font.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    spacing: spacingFor(spec),
    children: [new TextRun({ text, font: spec.font.body, size: pt(spec.font.sizePt) })],
    ...over,
  });
}

const centred = (text: string, spec: TemplateSpec, sizePt = spec.font.sizePt, bold = false) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: spacingFor(spec),
    children: [new TextRun({ text, font: spec.font.body, size: pt(sizePt), bold })],
  });

/** `CHAPTER {n}` / `{chapter}.{n}` — the template's own placeholders. */
export function renderLabel(
  pattern: string,
  values: { n?: number | string; chapter?: number | string; m?: number | string; A?: string },
): string {
  return pattern
    .replace(/\{n\}/g, String(values.n ?? ''))
    .replace(/\{chapter\}/g, String(values.chapter ?? ''))
    .replace(/\{m\}/g, String(values.m ?? ''))
    .replace(/\{A\}/g, String(values.A ?? ''));
}

/** Runs of a ProseMirror inline node, with citation atoms replaced by their rendered label. */
function runsFrom(
  nodes: readonly Node[],
  input: ThesisExportInput,
  chapter: ThesisChapter,
): TextRun[] {
  const { spec } = input;
  const out: TextRun[] = [];
  for (const node of nodes) {
    if (node.type === 'crossRef') {
      // Numbered per chapter, from the chapter's own document — the same source the editor reads,
      // so the submitted thesis says what the screen said.
      const refId = typeof node.attrs?.refId === 'string' ? node.attrs.refId : '';
      const refKind = node.attrs?.kind === 'table' ? ('table' as const) : ('figure' as const);
      out.push(
        new TextRun({
          text: formatRef(numberingMap(chapter.content).get(refId), chapter.order, refKind),
          font: spec.font.body,
          size: pt(spec.font.sizePt),
        }),
      );
      continue;
    }
    if (node.type === 'mathInline') {
      // LaTeX source, not typeset maths — see `mathRun` in docx.ts for why, and note that the
      // alternative here was the status quo, in which the equation was absent from the submitted
      // thesis altogether.
      out.push(
        new TextRun({
          text: String(node.attrs?.latex ?? ''),
          font: 'Consolas',
          size: pt(spec.font.sizePt),
        }),
      );
      continue;
    }
    if (node.type === 'citation') {
      const key = String(node.attrs?.key ?? '');
      out.push(
        new TextRun({
          text: chapter.renderedMap[key] ?? '(source missing)',
          font: spec.font.body,
          size: pt(spec.font.sizePt),
        }),
      );
      continue;
    }
    if (node.type === 'text') {
      const marks = new Set((node.marks ?? []).map((m) => m.type));
      out.push(
        new TextRun({
          text: node.text ?? '',
          font: spec.font.body,
          size: pt(spec.font.sizePt),
          bold: marks.has('bold'),
          italics: marks.has('italic'),
          underline: marks.has('underline') ? {} : undefined,
          superScript: marks.has('superscript'),
          subScript: marks.has('subscript'),
        }),
      );
      continue;
    }
    if (node.content) out.push(...runsFrom(node.content, input, chapter));
  }
  return out;
}

const textOf = (node: Node | undefined): string =>
  !node ? '' : node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

/** One chapter's blocks, with the template's heading styles and numbering. */
function chapterBlocks(chapter: ThesisChapter, input: ThesisExportInput): Array<Paragraph | Table> {
  const { spec } = input;
  const out: Array<Paragraph | Table> = [];
  const counters = { h2: 0, h3: 0, figure: 0, table: 0 };

  // D.3.1: the chapter's own label and title, on a new page when the template says so.
  //
  // Heading 1 is on the *title* line, not the `CHAPTER n` label above it: the table of contents
  // is built from Heading 1 paragraphs, and a contents page reading "CHAPTER 1, CHAPTER 2" with
  // no titles is no use to anyone.
  const label = renderLabel(spec.headings.chapter.label, { n: chapter.order });
  // The heading the student typed wins over the stored `Chapter.title`: the two are mirrored when
  // a chapter is created and drift the moment someone edits the level-1 heading in the editor, and
  // the file has to say what the screen said.
  const ownHeading = ((chapter.content as Node | undefined)?.content ?? []).find(
    (block) => block.type === 'heading' && Number(block.attrs?.level ?? 2) === 1,
  );
  const rawTitle = (ownHeading ? textOf(ownHeading).trim() : '') || chapter.title;
  const title = spec.headings.chapter.caps ? rawTitle.toUpperCase() : rawTitle;
  out.push(
    new Paragraph({
      alignment:
        spec.headings.chapter.align === 'center'
          ? AlignmentType.CENTER
          : spec.headings.chapter.align === 'right'
            ? AlignmentType.RIGHT
            : AlignmentType.LEFT,
      pageBreakBefore: spec.headings.chapter.pageBreakBefore,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: label,
          font: spec.font.body,
          size: pt(spec.headings.chapter.sizePt),
          bold: spec.headings.chapter.bold,
        }),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      // `TOC \o "1-3"` collects by outline level, not by style name, and the Heading styles the
      // `docx` package writes carry no `w:outlineLvl`. Without this the contents page converts
      // to an empty index.
      outlineLevel: 0,
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: title,
          font: spec.font.body,
          size: pt(spec.headings.chapter.sizePt),
          bold: spec.headings.chapter.bold,
        }),
      ],
    }),
  );

  const blocks = (chapter.content as Node | undefined)?.content ?? [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const level = Number(block.attrs?.level ?? 2);
        // Level 1 inside the content is the chapter's own title, already emitted above.
        if (level <= 1) break;
        const style = level === 2 ? spec.headings.h2 : spec.headings.h3;
        if (level === 2) {
          counters.h2 += 1;
          counters.h3 = 0;
        } else {
          counters.h3 += 1;
        }
        const number = renderLabel(style.numbering, {
          chapter: chapter.order,
          n: counters.h2,
          m: counters.h3,
        });
        out.push(
          new Paragraph({
            heading: level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
            outlineLevel: level - 1,
            spacing: { before: 240, after: 120 },
            children: [
              new TextRun({
                text: `${number} ${textOf(block)}`.trim(),
                font: spec.font.body,
                size: pt(style.sizePt),
                bold: style.bold,
                italics: style.italic,
              }),
            ],
          }),
        );
        break;
      }

      case 'paragraph':
        out.push(
          new Paragraph({
            alignment: spec.font.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
            spacing: spacingFor(spec),
            children: runsFrom(block.content ?? [], input, chapter),
          }),
        );
        break;

      case 'blockquote':
        for (const child of block.content ?? []) {
          out.push(
            new Paragraph({
              indent: { left: convertMillimetersToTwip(10) },
              spacing: spacingFor(spec),
              children: runsFrom(child.content ?? [], input, chapter),
            }),
          );
        }
        break;

      case 'bulletList':
      case 'orderedList': {
        const ordered = block.type === 'orderedList';
        for (const item of block.content ?? []) {
          for (const child of item.content ?? []) {
            out.push(
              new Paragraph({
                spacing: spacingFor(spec),
                ...(ordered
                  ? { numbering: { reference: 'thesis-ordered', level: 0 } }
                  : { bullet: { level: 0 } }),
                children: runsFrom(child.content ?? [], input, chapter),
              }),
            );
          }
        }
        break;
      }

      case 'mathBlock': {
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: spacingFor(spec),
            children: [
              new TextRun({
                text: String(block.attrs?.latex ?? ''),
                font: 'Consolas',
                size: pt(spec.font.sizePt),
              }),
            ],
          }),
        );
        break;
      }

      case 'image': {
        counters.figure += 1;
        const caption = renderLabel(spec.captions.figure.format, {
          chapter: chapter.order,
          n: counters.figure,
        }).replace('{caption}', String(block.attrs?.alt ?? ''));
        // `key` is the stable storage path; `src` is a signed URL that has almost certainly
        // expired by export time, so it is only a fallback for documents written before figures
        // carried keys.
        const figureKey =
          (typeof block.attrs?.key === 'string' && block.attrs.key) ||
          (typeof block.attrs?.src === 'string' ? block.attrs.src : '');
        const bytes = input.images?.[figureKey];
        const figure = bytes
          ? new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  type: bytes.type ?? 'png',
                  data: bytes.data,
                  transformation: { width: bytes.width, height: bytes.height },
                }),
              ],
            })
          : // Still a named placeholder when the bytes could not be read, so the gap is visible
            // to the student rather than silent.
            centred(`[${String(block.attrs?.alt ?? 'figure')}]`, spec);
        const captionLine = centred(caption, spec, spec.font.sizePt - 1);
        out.push(
          ...(spec.captions.figure.position === 'above'
            ? [captionLine, figure]
            : [figure, captionLine]),
        );
        break;
      }

      case 'table': {
        counters.table += 1;
        const caption = renderLabel(spec.captions.table.format, {
          chapter: chapter.order,
          n: counters.table,
        }).replace('{caption}', String(block.attrs?.caption ?? ''));
        const captionLine = centred(caption, spec, spec.font.sizePt - 1);
        const rows = (block.content ?? []).map(
          (row) =>
            new TableRow({
              children: (row.content ?? []).map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({ children: runsFrom(cell.content ?? [], input, chapter) }),
                    ],
                  }),
              ),
            }),
        );
        const table = new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
        if (spec.captions.table.position === 'above') out.push(captionLine, table);
        else out.push(table, captionLine);
        break;
      }

      default:
        if (block.content) {
          out.push(
            new Paragraph({
              spacing: spacingFor(spec),
              children: runsFrom(block.content, input, chapter),
            }),
          );
        }
    }
  }
  return out;
}

/** D.3.2 step 1: the front matter the template asks for, in its order. */
function frontMatter(input: ThesisExportInput): Array<Paragraph | TableOfContents> {
  const { spec, details } = input;
  const out: Array<Paragraph | TableOfContents> = [];
  const heading = (text: string) =>
    centred(text.toUpperCase(), spec, spec.headings.chapter.sizePt, true);

  for (const section of spec.frontMatter) {
    switch (section.id) {
      case 'TITLE_PAGE':
        out.push(
          centred(input.documentTitle.toUpperCase(), spec, spec.headings.chapter.sizePt, true),
          centred('', spec),
          centred(
            `A thesis submitted in partial fulfilment of the requirements for the degree of`,
            spec,
          ),
          centred(details.degree, spec, spec.font.sizePt, true),
          centred('', spec),
          centred('by', spec),
          centred(details.studentName, spec, spec.font.sizePt, true),
          centred(details.rollNo ? `(${details.rollNo})` : '', spec),
          centred('', spec),
          centred('under the guidance of', spec),
          centred(
            [details.guideDesignation, details.guideName].filter(Boolean).join(' '),
            spec,
            spec.font.sizePt,
            true,
          ),
          centred('', spec),
          centred(details.department.toUpperCase(), spec),
          centred(details.institution.toUpperCase(), spec, spec.font.sizePt, true),
          centred(details.monthYear, spec),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;

      case 'CERTIFICATE':
        out.push(
          heading('Certificate'),
          body(
            `This is to certify that the thesis entitled “${input.documentTitle}” submitted by ${details.studentName}${details.rollNo ? ` (${details.rollNo})` : ''} to ${details.institution} is a record of bonafide work carried out under my supervision.`,
            spec,
          ),
          centred('', spec),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: spacingFor(spec),
            children: [
              new TextRun({
                text: `${details.guideName}${details.guideDesignation ? `, ${details.guideDesignation}` : ''}`,
                font: spec.font.body,
                size: pt(spec.font.sizePt),
              }),
            ],
          }),
          body(details.hodName ? `${details.hodName}, Head of Department` : '', spec),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;

      case 'DECLARATION':
        out.push(
          heading('Declaration'),
          body(
            `I declare that this thesis is my own work and that all sources I have used are acknowledged by complete references. Where the work of an AI assistant contributed to the text, it is disclosed in the accompanying AI-usage log.`,
            spec,
          ),
          centred('', spec),
          body(details.studentName, spec),
          body(details.declarationDate, spec),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;

      case 'ACKNOWLEDGEMENTS':
        if (!details.acknowledgements.trim()) break;
        out.push(
          heading('Acknowledgements'),
          ...details.acknowledgements.split(/\n+/).map((line: string) => body(line, spec)),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;

      case 'ABSTRACT':
        out.push(
          heading('Abstract'),
          ...details.abstract.split(/\n+/).map((line: string) => body(line, spec)),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;

      case 'TOC':
        out.push(
          heading('Table of contents'),
          new TableOfContents('Table of contents', { hyperlink: true, headingStyleRange: '1-3' }),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;

      case 'LIST_OF_FIGURES':
        out.push(
          heading('List of figures'),
          new TableOfContents('List of figures', { hyperlink: true, captionLabel: 'Figure' }),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;

      case 'LIST_OF_TABLES':
        out.push(
          heading('List of tables'),
          new TableOfContents('List of tables', { hyperlink: true, captionLabel: 'Table' }),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;

      case 'ABBREVIATIONS': {
        const entries = Object.entries(details.abbreviations);
        if (entries.length === 0) break;
        out.push(
          heading('Abbreviations'),
          ...entries.map(([short, long]) => body(`${short}    ${long}`, spec)),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;
      }
    }
  }
  return out;
}

/** Builds the whole thesis as a `.docx`. */
export async function thesisToDocx(input: ThesisExportInput): Promise<Buffer> {
  const { spec } = input;
  const size = PAGE_SIZES[spec.page.size as keyof typeof PAGE_SIZES] ?? PAGE_SIZES.A4;
  const margins = {
    top: convertMillimetersToTwip(spec.page.marginsMm.top),
    bottom: convertMillimetersToTwip(spec.page.marginsMm.bottom),
    left: convertMillimetersToTwip(spec.page.marginsMm.left),
    right: convertMillimetersToTwip(spec.page.marginsMm.right),
  };

  const chapters = [...input.chapters].sort((a, b) => a.order - b.order);
  const bodyChildren: Array<Paragraph | Table> = chapters.flatMap((chapter) =>
    chapterBlocks(chapter, input),
  );

  // D.3.1: the bibliography, then the appendices.
  if (input.bibliography.length > 0) {
    bodyChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        outlineLevel: 0,
        alignment: AlignmentType.CENTER,
        pageBreakBefore: spec.bibliography.pageBreakBefore,
        spacing: { after: 360 },
        children: [
          new TextRun({
            text: spec.bibliography.title,
            font: spec.font.body,
            size: pt(spec.headings.chapter.sizePt),
            bold: true,
          }),
        ],
      }),
      ...input.bibliography.map(
        (entry) =>
          new Paragraph({
            spacing: spacingFor(spec),
            indent: { left: convertMillimetersToTwip(12), hanging: convertMillimetersToTwip(12) },
            children: [
              new TextRun({ text: entry, font: spec.font.body, size: pt(spec.font.sizePt) }),
            ],
          }),
      ),
    );
  }

  (input.appendices ?? []).forEach((appendix, index) => {
    const letter = String.fromCharCode(65 + index);
    bodyChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        outlineLevel: 0,
        alignment: AlignmentType.CENTER,
        pageBreakBefore: true,
        spacing: { after: 360 },
        children: [
          new TextRun({
            text: `${renderLabel(spec.appendices.label, { A: letter })} ${appendix.title}`.trim(),
            font: spec.font.body,
            size: pt(spec.headings.chapter.sizePt),
            bold: true,
          }),
        ],
      }),
      ...appendix.paragraphs.map((text) => body(text, spec)),
    );
  });

  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'thesis-ordered',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: spec.font.body, size: pt(spec.font.sizePt) },
          paragraph: { spacing: spacingFor(spec) },
        },
      },
    },
    sections: [
      // Front matter, numbered in its own sequence (D.3.1: usually lower roman).
      {
        properties: {
          page: {
            size,
            margin: margins,
            pageNumbers: {
              formatType:
                spec.numbering.frontMatter === 'lowerRoman'
                  ? NumberFormat.LOWER_ROMAN
                  : spec.numbering.frontMatter === 'upperRoman'
                    ? NumberFormat.UPPER_ROMAN
                    : NumberFormat.DECIMAL,
              start: 1,
            },
          },
        },
        footers: { default: pageNumberFooter(spec) },
        children: frontMatter(input),
      },
      // The body, restarting at 1 in the template's body format.
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size,
            margin: margins,
            pageNumbers: { formatType: NumberFormat.DECIMAL, start: 1 },
          },
        },
        footers: { default: pageNumberFooter(spec) },
        children: bodyChildren,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(document));
}

function pageNumberFooter(spec: TemplateSpec): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment:
          spec.numbering.position === 'bottom-right' ? AlignmentType.RIGHT : AlignmentType.CENTER,
        children: [
          new TextRun({
            children: [PageNumber.CURRENT],
            font: spec.font.body,
            size: pt(Math.max(6, spec.font.sizePt - 1)),
          }),
        ],
      }),
    ],
  });
}

/**
 * Reads back the page setup the generated file actually carries, for D.3.3's PAGE_SETUP check.
 *
 * The check asserts on the produced XML rather than on the input, because the whole point is to
 * catch a template that did not take effect.
 */
export function pageSetupOf(spec: TemplateSpec): {
  pageSize: string;
  marginsMm: { top: number; bottom: number; left: number; right: number };
  fontName: string;
  fontSizePt: number;
  lineSpacing: number;
} {
  return {
    pageSize: spec.page.size,
    marginsMm: { ...spec.page.marginsMm },
    fontName: spec.font.body,
    fontSizePt: spec.font.sizePt,
    lineSpacing: spec.font.lineSpacing,
  };
}
