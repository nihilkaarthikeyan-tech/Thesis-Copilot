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

import type { CitationCluster } from '@tc/citations';
import { formatRef, type NumberedTarget } from '@tc/types';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
  Math as WordMath,
} from 'docx';
import { captionOf } from './captions.js';
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
  /**
   * R40 (ADR-0117): citations side by side, rendered as one — printed once, at the first node:
   * "(Kumar, 2021; Rao, 2020)" where the file used to read "(Kumar, 2021)(Rao, 2020)".
   */
  citationClusters?: readonly CitationCluster[];
  /** Bibliography lines, already formatted and sorted by the citation layer. */
  bibliography?: readonly string[];
  /**
   * Images by object-storage key. Absent keys become a placeholder line, never a broken file.
   *
   * `width`/`height` are points in the document, not the file's pixels — `fitToColumn` in
   * `image-size.ts` does that conversion. `type` must match the actual bytes.
   */
  images?: Record<
    string,
    { data: Uint8Array; width: number; height: number; type?: 'png' | 'jpg' | 'gif' }
  >;
  /**
   * PHASES v2 W10.5: number the headings ("3.2 Method"). The numbers are computed here rather
   * than left to Word's list engine, because a `.docx` that renumbers itself when opened is a
   * `.docx` whose cross-references in the student's own text stop matching.
   */
  numberHeadings?: boolean;
  /** The chapter's position in the thesis, so its headings number from it. Defaults to 1. */
  chapterNumber?: number;
  /** ADR-0029: a note style — each citation is a footnote holding its note (`renderedMap`). */
  noteStyle?: boolean;
  /**
   * Figure and table numbers by `refId`, for resolving cross-references.
   *
   * Built by `numberingMap` over this same document — the function the editor's node view also
   * uses. Two implementations of "figures are numbered in document order" would be one
   * implementation and one bug, and the student would learn about it from their examiner.
   */
  refTargets?: ReadonlyMap<string, NumberedTarget>;
  /** ADR-0055: plain (the default), linked to the bibliography, or Word citation fields. */
  citationLinks?: CitationLinksInput;
};

/** Running heading counters for one export (H2 within the chapter, H3 within the H2). */
type HeadingCounter = { h2: number; h3: number };

function headingNumber(level: number, counter: HeadingCounter, chapter: number): string {
  if (level <= 1) return `${chapter}`;
  if (level === 2) {
    counter.h2 += 1;
    counter.h3 = 0;
    return `${chapter}.${counter.h2}`;
  }
  counter.h3 += 1;
  return `${chapter}.${counter.h2}.${counter.h3}`;
}

const HEADING = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

/**
 * An equation, as a Word equation (2026-09-25, `word-math.ts`).
 *
 * Until then it was the LaTeX source in a monospace run, which was at least not silence: until
 * 2026-09-21 an equation was not in the exported file at all. Anything `latexToWordMath` cannot
 * map faithfully — a matrix, invalid LaTeX — still falls back to that source, visibly untypeset.
 */
function mathRun(node: PmNode, display = false): TextRun | WordMath {
  const latex = String(node.attrs?.latex ?? '');
  const math = latexToWordMath(latex, display);
  return math ? new WordMath({ children: math }) : new TextRun({ text: latex, font: 'Consolas' });
}

function runsFrom(nodes: readonly PmNode[], options: ExportOptions): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  const renderedMap = options.renderedMap ?? {};

  for (const [index, node] of nodes.entries()) {
    if (node.type === 'footnote') {
      runs.push(footnoteRun(options, node));
      continue;
    }
    if (node.type === 'citation') {
      // R40 (ADR-0117): a cluster prints once, at its first node; its other nodes print nothing.
      const print = printCitation(nodes, index, renderedMap, options.citationClusters);
      if (print.kind === 'skip') continue;
      // An unresolved citation is marked rather than silently dropped.
      const label = print.label ?? '(source missing)';
      const links = citationLinksFor(options);
      if (options.noteStyle) {
        // ADR-0029: in a note style the citation is a footnote holding its note.
        runs.push(
          footnoteRun(
            options,
            { attrs: { text: label } },
            undefined,
            // ADR-0055: in a linked export the note links to its bibliography entry.
            links.mode === 'plain'
              ? undefined
              : noteChildren(print.nodes, label, links, (text) => new TextRun({ text })),
          ),
        );
        continue;
      }
      // ADR-0055: plain text, a link to the entry, or a Word `CITATION` field — the same label.
      runs.push(citationChild(print.nodes, label, links, (text) => new TextRun({ text })));
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
    if (node.type === 'crossRef') {
      // Resolved from the same `numberTargets` the editor's node view uses, so the number in the
      // submitted file is the number the student saw. A reference whose target was deleted prints
      // a visible gap rather than a plausible number — see `formatRef`.
      const refId = typeof node.attrs?.refId === 'string' ? node.attrs.refId : '';
      const kind = node.attrs?.kind === 'table' ? ('table' as const) : ('figure' as const);
      runs.push(
        new TextRun({
          text: formatRef(options.refTargets?.get(refId), options.chapterNumber ?? 1, kind),
        }),
      );
      continue;
    }
    if (node.type === 'mathInline') {
      runs.push(mathRun(node));
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
  context: { listLevel?: number; ordered?: boolean; counter?: HeadingCounter } = {},
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];

  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 2);
      const runs = runsFrom(node.content ?? [], options);
      if (options.numberHeadings && context.counter && level > 1) {
        const number = headingNumber(level, context.counter, options.chapterNumber ?? 1);
        runs.unshift(new TextRun({ text: `${number} ` }));
      }
      out.push(
        {
          paragraph: new Paragraph({
            heading: HEADING[level as 1 | 2 | 3] ?? HeadingLevel.HEADING_3,
            children: runs,
          }),
        }.paragraph,
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

    case 'mathBlock':
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [mathRun(node, true)] }));
      break;

    case 'image': {
      // The node carries both. `key` is the stable object-storage path; `src` is a signed URL
      // that expires. This looked up by `src` alone, which could only ever miss — the link is
      // re-signed every time the chapter is opened, so it never matches the key the caller
      // collected. `src` stays as the fallback for documents written before figures had keys.
      const key =
        typeof node.attrs?.key === 'string' && node.attrs.key
          ? node.attrs.key
          : typeof node.attrs?.src === 'string'
            ? node.attrs.src
            : '';
      const image = options.images?.[key];
      if (image) {
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                // Was hardcoded to 'png'. Word reads the part's declared type, so a JPEG
                // announced as a PNG is a figure that does not render in the file a student
                // submits — and the export itself would look like it had worked.
                type: image.type ?? 'png',
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
      // The caption the student wrote, never the uploaded file's name.
      const caption = captionOf(node);
      if (caption) {
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: caption, italics: true, size: 20 })],
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
      return new TableCell({
        children: blocks.length > 0 ? blocks : [new Paragraph('')],
        // Word fills the continuation cells of a tall cell itself.
        ...docxSpans(cell),
      });
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
  const counter: HeadingCounter = { h2: 0, h3: 0 };
  const chapterNumber = options.chapterNumber ?? 1;
  const body: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun(options.numberHeadings ? `${chapterNumber}. ${options.title}` : options.title),
      ],
    }),
    ...(root.content ?? []).flatMap((node) => paragraphsFrom(node, options, { counter })),
  ];

  const bibliography = options.bibliography ?? [];
  if (bibliography.length > 0) {
    body.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('References')] }),
      ...bibliography.map(
        (entry, index) =>
          new Paragraph({
            // ADR-0055: a bookmark for the citations to link to, or the `BIBLIOGRAPHY` field.
            children: bibliographyEntryChildren(
              index,
              bibliography.length,
              new TextRun(entry),
              citationLinksFor(options),
            ),
            indent: { left: 720, hanging: 720 },
          }),
      ),
    );
  }

  const document = new Document({
    footnotes: notesFor(options).entries,
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

  // ADR-0055: the parts `docx` cannot write (a no-op for plain citations).
  return finishCitationLinks(await Packer.toBuffer(document), citationLinksFor(options));
}
