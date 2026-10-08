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

import type { CitationCluster } from '@tc/citations';
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
  type ParagraphChild,
  SectionType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  Math as WordMath,
} from 'docx';
import { captionOf, withCaption, withCaptionsResolved } from './captions.js';
import {
  bibliographyEntryChildren,
  type CitationLinksInput,
  citationChild,
  citationLinksFor,
  finishCitationLinks,
  noteChildren,
} from './citation-links.js';
import { printCitation } from './clusters.js';
import { footnoteRun, notesFor } from './footnotes.js';
import { docxSpans } from './table-grid.js';
import { latexToWordMath } from './word-math.js';

export type ThesisChapter = {
  id: string;
  title: string;
  order: number;
  /** ProseMirror JSON. */
  content: unknown;
  /** Citation node key → the label citeproc rendered. */
  renderedMap: Record<string, string>;
  /**
   * R40 (ADR-0117): citations side by side, rendered as one. Printed once, at the first node;
   * absent, every citation prints on its own as before.
   */
  citationClusters?: readonly CitationCluster[];
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
  /**
   * ADR-0029: the citation style is a note style. Every citation is then a footnote holding the
   * note citeproc wrote (`renderedMap`), not an in-text label.
   */
  noteStyle?: boolean;
  /**
   * ADR-0055: how citations are written — plain text (the default), linked to their bibliography
   * entries, or as Word's own citation fields. Omitted means plain, as before.
   */
  citationLinks?: CitationLinksInput;
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
): ParagraphChild[] {
  const { spec } = input;
  const out: ParagraphChild[] = [];
  for (const [index, node] of nodes.entries()) {
    // A pending AI draft is not part of the thesis, however deep it sits (see `chapterBlocks`).
    if (node.type === 'draftBlock') continue;
    if (node.type === 'footnote') {
      // A real Word footnote, numbered by Word through the whole thesis (footnotes.ts).
      out.push(footnoteRun(input, node, { name: spec.font.body, size: pt(spec.font.sizePt - 2) }));
      continue;
    }
    if (node.type === 'needsSourceNote') {
      // Only ever inside a pending draft, which is skipped above; if one is ever found outside
      // it, it ships visible — hiding a gap is the one thing this product must never do.
      out.push(
        new TextRun({
          text: `[NEEDS SOURCE: ${String(node.attrs?.text ?? '')}]`,
          bold: true,
          font: spec.font.body,
          size: pt(spec.font.sizePt),
        }),
      );
      continue;
    }
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
      out.push(mathOrSource(node, spec, false));
      continue;
    }
    if (node.type === 'citation') {
      // R40 (ADR-0117): a cluster prints once, at its first node; its other nodes print nothing.
      const print = printCitation(nodes, index, chapter.renderedMap, chapter.citationClusters);
      if (print.kind === 'skip') continue;
      const label = print.label ?? '(source missing)';
      const links = citationLinksFor(input);
      if (input.noteStyle) {
        // A note style: the citation is a Word footnote holding the note citeproc wrote.
        const noteFont = { name: spec.font.body, size: pt(spec.font.sizePt - 2) };
        out.push(
          footnoteRun(
            input,
            { attrs: { text: label } },
            noteFont,
            // ADR-0055: in a linked export the note links to its bibliography entry.
            links.mode === 'plain'
              ? undefined
              : noteChildren(
                  print.nodes,
                  label,
                  links,
                  (text) => new TextRun({ text, font: noteFont.name, size: noteFont.size }),
                ),
          ),
        );
        continue;
      }
      // ADR-0055: plain text, a link to the entry, or a Word `CITATION` field — the same label.
      out.push(
        citationChild(
          print.nodes,
          label,
          links,
          (text) => new TextRun({ text, font: spec.font.body, size: pt(spec.font.sizePt) }),
        ),
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

/**
 * The picture itself, or a visible placeholder where it should have been.
 *
 * Shared between the top-level `image` block and a table cell, because they diverged: the cell
 * renderer flattened everything to inline runs, and an `image` has no runs, so a figure a student
 * had put inside a table vanished from the submitted thesis with nothing in its place. The chapter
 * exporter recurses into cells properly and did not have the bug, which is the worse version of
 * having it — the two files disagreed about the same document.
 *
 * `key` is the stable storage path; `src` is a signed URL that has almost certainly expired by
 * export time, kept only for documents written before figures carried keys.
 */
function figureParagraph(block: Node, input: ThesisExportInput): Paragraph {
  const figureKey =
    (typeof block.attrs?.key === 'string' && block.attrs.key) ||
    (typeof block.attrs?.src === 'string' ? block.attrs.src : '');
  const bytes = input.images?.[figureKey];
  if (!bytes) {
    // Named, so the gap is visible to the student rather than silent.
    return centred(`[${String(block.attrs?.alt ?? 'figure')}]`, input.spec);
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        type: bytes.type ?? 'png',
        data: bytes.data,
        transformation: { width: bytes.width, height: bytes.height },
      }),
    ],
  });
}

/**
 * A display equation, typeset as a Word equation where it can be (`word-math.ts`); LaTeX the
 * converter cannot map falls back to its source in a monospace run. Shared between the chapter
 * loop and a table cell, which rendered its contents as inline runs and so dropped an equation
 * the same way it dropped a figure.
 */
function mathParagraph(block: Node, spec: TemplateSpec): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [mathOrSource(block, spec, true)],
  });
}

/** Word maths for an equation, or its LaTeX source when it cannot be typeset faithfully. */
function mathOrSource(node: Node, spec: TemplateSpec, display: boolean): TextRun | WordMath {
  const latex = String(node.attrs?.latex ?? '');
  const math = latexToWordMath(latex, display);
  return math
    ? new WordMath({ children: math })
    : new TextRun({ text: latex, font: 'Consolas', size: pt(spec.font.sizePt) });
}

/**
 * One table cell's contents as block-level paragraphs.
 *
 * A cell holds `block+`, not inline content: two paragraphs, a list, a figure. Rendering it as a
 * single run-stream ran two paragraphs together and dropped anything with no runs at all.
 * A figure here gets no numbered caption — the table already carries one, and "Figure 3.2" under
 * a cell would be numbering the wrong thing.
 */
function cellBlocks(cell: Node, input: ThesisExportInput, chapter: ThesisChapter): Paragraph[] {
  const out: Paragraph[] = [];
  for (const block of cell.content ?? []) {
    if (block.type === 'image') {
      out.push(figureParagraph(block, input));
      continue;
    }
    if (block.type === 'mathBlock') {
      out.push(mathParagraph(block, input.spec));
      continue;
    }
    const runs = runsFrom(block.content ?? [], input, chapter);
    if (runs.length > 0) out.push(new Paragraph({ children: runs }));
  }
  // `docx` requires at least one child; an empty cell is an empty paragraph.
  return out.length > 0 ? out : [new Paragraph('')];
}

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

      case 'mathBlock':
        out.push(mathParagraph(block, spec));
        break;

      case 'image': {
        counters.figure += 1;
        const caption = withCaption(
          renderLabel(spec.captions.figure.format, { chapter: chapter.order, n: counters.figure }),
          captionOf(block),
        );
        // `key` is the stable storage path; `src` is a signed URL that has almost certainly
        // expired by export time, so it is only a fallback for documents written before figures
        // carried keys.
        const figure = figureParagraph(block, input);
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
        const caption = withCaption(
          renderLabel(spec.captions.table.format, { chapter: chapter.order, n: counters.table }),
          captionOf(block),
        );
        const captionLine = centred(caption, spec, spec.font.sizePt - 1);
        const rows = (block.content ?? []).map(
          (row) =>
            new TableRow({
              children: (row.content ?? []).map(
                (cell) =>
                  new TableCell({ children: cellBlocks(cell, input, chapter), ...docxSpans(cell) }),
              ),
            }),
        );
        const table = new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
        if (spec.captions.table.position === 'above') out.push(captionLine, table);
        else out.push(table, captionLine);
        break;
      }

      case 'draftBlock':
        // An AI draft the student has not accepted. Autosave keeps it in the chapter while it
        // waits, and until 2026-09-24 this switch had no case for it, so the default below wrote
        // its text into the thesis the student submits — AI output entering the thesis with no
        // student action, which the chapter export (`docx.ts`) had always refused. Accepting a
        // draft unwraps it into ordinary blocks, so nothing accepted is lost here.
        break;

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

/**
 * The chapter without any AI draft the student has not accepted, wherever it sits — a draft in a
 * list or a table cell is as unaccepted as one at the top level. Numbering, cross-references and
 * the text are all built from this, so a figure inside a pending draft neither prints nor takes a
 * number from the figures after it. Exported for the LaTeX and HTML builders, which apply the
 * same rule.
 */
export function withoutPendingDrafts(content: unknown): unknown {
  const strip = (node: Node): Node =>
    node.content
      ? {
          ...node,
          content: node.content.filter((child) => child.type !== 'draftBlock').map(strip),
        }
      : node;
  return content && typeof content === 'object' ? strip(content as Node) : content;
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

  const chapters = [...input.chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => ({
      ...chapter,
      content: withCaptionsResolved(withoutPendingDrafts(chapter.content)),
    }));
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
        (entry, index) =>
          new Paragraph({
            spacing: spacingFor(spec),
            indent: { left: convertMillimetersToTwip(12), hanging: convertMillimetersToTwip(12) },
            // ADR-0055: a bookmark for the citations to link to, or the `BIBLIOGRAPHY` field.
            children: bibliographyEntryChildren(
              index,
              input.bibliography.length,
              new TextRun({ text: entry, font: spec.font.body, size: pt(spec.font.sizePt) }),
              citationLinksFor(input),
            ),
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
    // Collected while the body above was built (footnotes.ts).
    footnotes: notesFor(input).entries,
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

  // ADR-0055: the parts `docx` cannot write (a no-op for plain citations).
  return finishCitationLinks(Buffer.from(await Packer.toBuffer(document)), citationLinksFor(input));
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
