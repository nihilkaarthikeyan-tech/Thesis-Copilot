/**
 * LaTeX export — ADR-0021.
 *
 * The thesis as a project that compiles as it stands: `main.tex`, `references.bib`, the figures
 * and a note on building it, zipped. It is for the student who will finish in Overleaf, or whose
 * department wants LaTeX source. Like the `.docx` it is a working format, so no compliance gate.
 *
 * Where it departs from the `.docx`, deliberately:
 *
 *  - **Citations are `\parencite` / `\textcite` over `references.bib`**, not the labels citeproc
 *    printed. That is what LaTeX source is for: the style becomes one option to change. The cost
 *    is that biblatex, not our citeproc, formats the list — `main.tex` says so in its first lines
 *    and names the nearest built-in style.
 *  - **LaTeX numbers the chapters, sections, figures and tables** (`\label` / `\ref`), the way a
 *    LaTeX document keeps its numbers right while it is edited.
 *  - **Equations are typeset.** They are the student's own LaTeX, which every other export can
 *    only print as source.
 *
 * What it shares with the `.docx`, deliberately: the same front matter in the template's order,
 * the same certificate and declaration wording, and the same rule that an AI draft the student has
 * not accepted is not part of the thesis (`withoutPendingDrafts`).
 */

import { numberingMap, type TemplateSpec } from '@tc/types';
import JSZip from 'jszip';
import { captionOf, withCaptionsResolved } from './captions.js';
import { footnoteText } from './footnotes.js';
import { gridOf, ruleUnder } from './table-grid.js';
import { type ThesisExportInput, withoutPendingDrafts } from './thesis.js';

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: Node[];
};

export type LatexExportInput = ThesisExportInput & {
  /** Citation node key → the BibTeX key of its source. A node whose source is gone is absent. */
  citeKeys: Readonly<Record<string, string>>;
  /** Citation node key → locator ("12", "pp. 3–4"), printed as the citation's postnote. */
  locators?: Readonly<Record<string, string | null>>;
  /** The cited sources as BibTeX, keyed as `citeKeys` names them. */
  bibtex: string;
  /** biblatex's nearest built-in style to the thesis's own. */
  bibStyle: 'authoryear' | 'numeric';
  /** The style the editor uses, named in the note at the top of `main.tex`. */
  styleLabel: string;
  /** `YYYY-MM-DD`, for the header comment. */
  exportedOn: string;
};

export type LatexFile = { path: string; data: string | Uint8Array };

const SPECIALS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '%': '\\%',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
};

/** Text as LaTeX prints it: the ten characters that mean something to TeX, escaped. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#%_^~]/g, (c) => SPECIALS[c] ?? c);
}

const textOf = (node: Node | undefined): string =>
  !node ? '' : node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

/** A figure's file name in the project, from its type. */
function figurePath(chapter: number, file: number, type: 'png' | 'jpg' | 'gif'): string {
  return `figures/chapter-${chapter}-${file}.${type}`;
}

/** One chapter's cross-reference targets as LaTeX labels: `fig:3.2`, `tab:3.1`. */
function labelFor(kind: 'figure' | 'table', chapter: number, index: number): string {
  return `${kind === 'figure' ? 'fig' : 'tab'}:${chapter}.${index}`;
}

/** A URL `\href` can take: http(s) or mailto only, with TeX's specials escaped. */
function safeUrl(href: unknown): string | null {
  if (typeof href !== 'string' || !/^(https?:|mailto:)/i.test(href)) return null;
  return href.replace(/\\/g, '%5C').replace(/([#%{}])/g, '\\$1');
}

type ChapterContext = {
  input: LatexExportInput;
  chapter: number;
  /** refId → its number within the chapter, from the same walk the editor numbers with. */
  numbers: ReturnType<typeof numberingMap>;
  figures: LatexFile[];
  /**
   * Figures numbered as `numberTargets` numbers them — in document order, at any depth except
   * inside a table — so a `\ref` resolves to the number the editor showed.
   */
  figureCount: { n: number };
  /** Every figure file, numbered or not, for unique names in `figures/`. */
  fileCount: { n: number };
};

function inline(nodes: readonly Node[], ctx: ChapterContext): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        let text = escapeLatex(node.text ?? '');
        for (const mark of node.marks ?? []) {
          if (mark.type === 'bold') text = `\\textbf{${text}}`;
          else if (mark.type === 'italic') text = `\\emph{${text}}`;
          else if (mark.type === 'underline') text = `\\uline{${text}}`;
          else if (mark.type === 'strike') text = `\\sout{${text}}`;
          else if (mark.type === 'superscript') text = `\\textsuperscript{${text}}`;
          else if (mark.type === 'subscript') text = `\\textsubscript{${text}}`;
          else if (mark.type === 'code') text = `\\texttt{${text}}`;
          else if (mark.type === 'link') {
            const url = safeUrl(mark.attrs?.href);
            if (url) text = `\\href{${url}}{${text}}`;
          }
          // `provenance` and `commentAnchor` are the editor's own bookkeeping; they do not print.
        }
        out += text;
        break;
      }
      case 'citation': {
        const key = String(node.attrs?.key ?? '');
        const bibKey = ctx.input.citeKeys[key];
        if (!bibKey) {
          // The source was removed from the library. Visible, as in every other export.
          out += '\\textbf{(source missing)}';
          break;
        }
        const locator = ctx.input.locators?.[key];
        const post = locator ? `[${escapeLatex(locator)}]` : '';
        const command = node.attrs?.role === 'narrative' ? 'textcite' : 'parencite';
        out += `\\${command}${post}{${bibKey}}`;
        break;
      }
      case 'crossRef': {
        const refId = typeof node.attrs?.refId === 'string' ? node.attrs.refId : '';
        const kind = node.attrs?.kind === 'table' ? ('table' as const) : ('figure' as const);
        const target = ctx.numbers.get(refId);
        out += target
          ? `${kind === 'figure' ? '\\figurename' : '\\tablename'}~\\ref{${labelFor(kind, ctx.chapter, target.index)}}`
          : `\\textbf{[${kind === 'figure' ? 'Figure' : 'Table'} --- deleted]}`;
        break;
      }
      case 'mathInline': {
        const latex = String(node.attrs?.latex ?? '').trim();
        if (latex) out += `\\(${latex}\\)`;
        break;
      }
      case 'needsSourceNote':
        out += `\\textbf{[NEEDS SOURCE: ${escapeLatex(String(node.attrs?.text ?? ''))}]}`;
        break;
      case 'footnote':
        out += `\\footnote{${escapeLatex(footnoteText(node))}}`;
        break;
      case 'hardBreak':
        out += '\\newline{}';
        break;
      default:
        if (node.content) out += inline(node.content, ctx);
    }
  }
  return out;
}

/** The picture, as `\includegraphics`, or a visible box where a file could not be used. */
function graphic(node: Node, ctx: ChapterContext): string {
  const storageKey =
    (typeof node.attrs?.key === 'string' && node.attrs.key) ||
    (typeof node.attrs?.src === 'string' ? node.attrs.src : '');
  const image = ctx.input.images?.[storageKey];
  const alt = escapeLatex(String(node.attrs?.alt ?? 'figure'));
  if (!image) return `\\fbox{[${alt} --- the image could not be read]}`;
  const type = image.type ?? 'png';
  ctx.fileCount.n += 1;
  const path = figurePath(ctx.chapter, ctx.fileCount.n, type);
  ctx.figures.push({ path, data: image.data });
  // pdfLaTeX reads PNG and JPEG, not GIF. The file is in the project; it needs converting.
  if (type === 'gif') return `\\fbox{[${alt} --- convert ${path} to PNG to include it]}`;
  // The size the `.docx` gives it (points, already fitted to the column), and never wider than
  // the column here: keepaspectratio fits it inside both bounds, so a small figure stays small.
  // Stretching every figure to the line width blew a 1-inch logo up to a page.
  const height = Math.max(1, Math.round(image.height));
  return `\\includegraphics[width=\\linewidth,height=${height}pt,keepaspectratio]{${path}}`;
}

function blocks(nodes: readonly Node[], ctx: ChapterContext, inTable = false): string[] {
  const out: string[] = [];
  const { spec } = ctx.input;
  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const level = Number(node.attrs?.level ?? 2);
        // Level 1 is the chapter's own title, already the `\chapter`.
        if (level <= 1) break;
        const command = level === 2 ? 'section' : level === 3 ? 'subsection' : 'subsubsection';
        out.push(`\\${command}{${escapeLatex(textOf(node).trim())}}`);
        break;
      }
      case 'paragraph': {
        const text = inline(node.content ?? [], ctx).trim();
        if (text) out.push(text);
        break;
      }
      case 'blockquote':
        out.push(
          ['\\begin{quote}', ...blocks(node.content ?? [], ctx, inTable), '\\end{quote}'].join(
            '\n',
          ),
        );
        break;
      case 'bulletList':
      case 'orderedList': {
        const env = node.type === 'orderedList' ? 'enumerate' : 'itemize';
        const items = (node.content ?? []).map(
          (item) => `\\item ${blocks(item.content ?? [], ctx, inTable).join('\n\n')}`,
        );
        out.push([`\\begin{${env}}`, ...items, `\\end{${env}}`].join('\n'));
        break;
      }
      case 'codeBlock':
        // Verbatim takes the text as it is; only its own end marker could break out of it.
        out.push(
          `\\begin{verbatim}\n${textOf(node).replace(/\\end\{verbatim\}/g, '\\end {verbatim}')}\n\\end{verbatim}`,
        );
        break;
      case 'mathBlock': {
        const latex = String(node.attrs?.latex ?? '').trim();
        if (latex) out.push(`\\[\n${latex}\n\\]`);
        break;
      }
      case 'image': {
        const body = graphic(node, ctx);
        // A figure inside a table cell is part of the table, not a numbered figure of its own —
        // and `numberTargets` does not count it either.
        if (inTable) {
          out.push(body);
          break;
        }
        ctx.figureCount.n += 1;
        const index = ctx.figureCount.n;
        const caption = `\\caption{${escapeLatex(captionOf(node))}}`;
        const label = `\\label{${labelFor('figure', ctx.chapter, index)}}`;
        const lines =
          spec.captions.figure.position === 'above'
            ? [caption, label, body]
            : [body, caption, label];
        out.push(['\\begin{figure}[htbp]', '\\centering', ...lines, '\\end{figure}'].join('\n'));
        break;
      }
      case 'table':
        out.push(table(node, ctx));
        break;
      case 'draftBlock':
        // Removed before this runs (`withoutPendingDrafts`); here only as a statement of intent.
        break;
      default:
        if (node.content) out.push(...blocks(node.content, ctx, inTable));
    }
  }
  return out;
}

function table(node: Node, ctx: ChapterContext): string {
  const { spec } = ctx.input;
  // Laid out on its real grid so a merged cell keeps every other column where it belongs.
  const grid = gridOf(node);
  const { columns } = grid;
  // A wide cell spans several `X` columns; `p{}` of their joint width lets its text wrap.
  const wide = (span: number) => `|p{\\dimexpr\\linewidth*${span}/${columns}-2\\tabcolsep\\relax}|`;
  const body = grid.rows.map((row, r) => {
    const cells: string[] = [];
    for (const slot of row) {
      if (slot.kind === 'right') continue;
      if (slot.kind === 'empty') {
        cells.push('');
        continue;
      }
      if (slot.kind === 'below') {
        // The rows a tall cell reaches into still name its columns, empty.
        if (slot.lead)
          cells.push(
            slot.colspan > 1 ? `\\multicolumn{${slot.colspan}}{${wide(slot.colspan)}}{}` : '',
          );
        continue;
      }
      const text = blocks(slot.cell.content ?? [], ctx, true).join(' \\par ');
      let out = slot.cell.type === 'tableHeader' && text ? `\\textbf{${text}}` : text;
      if (slot.rowspan > 1) out = `\\multirow{${slot.rowspan}}{=}{${out}}`;
      if (slot.colspan > 1) out = `\\multicolumn{${slot.colspan}}{${wide(slot.colspan)}}{${out}}`;
      cells.push(out);
    }
    return `${cells.join(' & ')} \\\\ ${ruleUnder(grid, r)}`;
  });
  // The index the editor gave this table, so `\ref` and the caption agree with the screen.
  const refId =
    (typeof node.attrs?.refId === 'string' && node.attrs.refId) ||
    (typeof node.attrs?.key === 'string' ? node.attrs.key : '');
  const index = ctx.numbers.get(refId)?.index;
  const caption = `\\caption{${escapeLatex(captionOf(node))}}`;
  const label = index ? `\\label{${labelFor('table', ctx.chapter, index)}}` : '';
  const tabular = [
    `\\begin{tabularx}{\\linewidth}{|${'X|'.repeat(columns)}}`,
    '\\hline',
    ...body,
    '\\end{tabularx}',
  ].join('\n');
  const lines =
    spec.captions.table.position === 'above'
      ? [caption, label, tabular]
      : [tabular, caption, label];
  return ['\\begin{table}[htbp]', '\\centering', ...lines.filter(Boolean), '\\end{table}'].join(
    '\n',
  );
}

/** `CHAPTER {n}` → `CHAPTER \thechapter`, with the literal text escaped. */
function latexPattern(pattern: string, values: Record<string, string>): string {
  const parts = pattern.split(/(\{[a-zA-Z]+\})/);
  return parts
    .map((part) => {
      const name = /^\{([a-zA-Z]+)\}$/.exec(part)?.[1];
      return name && values[name] !== undefined ? values[name] : escapeLatex(part);
    })
    .join('');
}

function spacing(lineSpacing: number): string {
  if (lineSpacing <= 1.05) return '\\singlespacing';
  if (Math.abs(lineSpacing - 1.5) < 0.05) return '\\onehalfspacing';
  if (Math.abs(lineSpacing - 2) < 0.05) return '\\doublespacing';
  return `\\setstretch{${lineSpacing}}`;
}

function fontPackages(spec: TemplateSpec): string[] {
  const body = spec.font.body.toLowerCase();
  if (/times/.test(body)) {
    return [
      '\\ifPDFTeX',
      '  \\usepackage[utf8]{inputenc}',
      '  \\usepackage[T1]{fontenc}',
      `  \\usepackage{newtxtext} % ${escapeLatex(spec.font.body)}, as the template asks`,
      '\\else',
      '  \\usepackage{fontspec}',
      `  \\setmainfont{TeX Gyre Termes} % ${escapeLatex(spec.font.body)}, as the template asks`,
      '\\fi',
    ];
  }
  if (/arial|helvetica/.test(body)) {
    return [
      '\\ifPDFTeX',
      '  \\usepackage[utf8]{inputenc}',
      '  \\usepackage[T1]{fontenc}',
      `  \\usepackage{helvet} % ${escapeLatex(spec.font.body)}, as the template asks`,
      '\\else',
      '  \\usepackage{fontspec}',
      '  \\setmainfont{TeX Gyre Heros}',
      '\\fi',
      '\\renewcommand{\\familydefault}{\\sfdefault}',
    ];
  }
  return [
    '\\ifPDFTeX',
    '  \\usepackage[utf8]{inputenc}',
    '  \\usepackage[T1]{fontenc}',
    '\\else',
    '  \\usepackage{fontspec}',
    '\\fi',
    `% The template names ${escapeLatex(spec.font.body)}; set it with \\setmainfont under XeLaTeX.`,
  ];
}

function frontMatter(input: LatexExportInput): string[] {
  const { spec, details } = input;
  const out: string[] = [];
  const unnumbered = (title: string) => [
    `\\chapter*{${escapeLatex(title)}}`,
    `\\addcontentsline{toc}{chapter}{${escapeLatex(title)}}`,
  ];
  const paragraphs = (text: string) =>
    text
      .split(/\n+/)
      .map((line) => escapeLatex(line.trim()))
      .filter(Boolean);

  for (const section of spec.frontMatter) {
    switch (section.id) {
      case 'TITLE_PAGE':
        out.push(
          [
            '\\begin{titlepage}',
            '\\centering',
            `{\\large\\bfseries ${escapeLatex(input.documentTitle.toUpperCase())}\\par}`,
            '\\vspace{2em}',
            'A thesis submitted in partial fulfilment of the requirements for the degree of\\par',
            `{\\bfseries ${escapeLatex(details.degree)}\\par}`,
            '\\vspace{1.5em}',
            'by\\par',
            `{\\bfseries ${escapeLatex(details.studentName)}\\par}`,
            details.rollNo ? `(${escapeLatex(details.rollNo)})\\par` : '',
            '\\vspace{1.5em}',
            'under the guidance of\\par',
            `{\\bfseries ${escapeLatex([details.guideDesignation, details.guideName].filter(Boolean).join(' '))}\\par}`,
            '\\vfill',
            `${escapeLatex(details.department.toUpperCase())}\\par`,
            `{\\bfseries ${escapeLatex(details.institution.toUpperCase())}\\par}`,
            `${escapeLatex(details.monthYear)}\\par`,
            '\\end{titlepage}',
          ]
            .filter(Boolean)
            .join('\n'),
        );
        break;
      case 'CERTIFICATE':
        out.push(
          ...unnumbered('Certificate'),
          escapeLatex(
            `This is to certify that the thesis entitled “${input.documentTitle}” submitted by ${details.studentName}${details.rollNo ? ` (${details.rollNo})` : ''} to ${details.institution} is a record of bonafide work carried out under my supervision.`,
          ),
          '\\vspace{3em}',
          `${escapeLatex(`${details.guideName}${details.guideDesignation ? `, ${details.guideDesignation}` : ''}`)}\\par`,
          details.hodName ? `${escapeLatex(`${details.hodName}, Head of Department`)}\\par` : '',
        );
        break;
      case 'DECLARATION':
        out.push(
          ...unnumbered('Declaration'),
          escapeLatex(
            'I declare that this thesis is my own work and that all sources I have used are acknowledged by complete references. Where the work of an AI assistant contributed to the text, it is disclosed in the accompanying AI-usage log.',
          ),
          '\\vspace{3em}',
          `${escapeLatex(details.studentName)}\\par`,
          `${escapeLatex(details.declarationDate)}\\par`,
        );
        break;
      case 'ACKNOWLEDGEMENTS':
        if (!details.acknowledgements.trim()) break;
        out.push(...unnumbered('Acknowledgements'), ...paragraphs(details.acknowledgements));
        break;
      case 'ABSTRACT':
        out.push(...unnumbered('Abstract'), ...paragraphs(details.abstract));
        break;
      case 'TOC':
        out.push('\\tableofcontents');
        break;
      case 'LIST_OF_FIGURES':
        out.push('\\listoffigures');
        break;
      case 'LIST_OF_TABLES':
        out.push('\\listoftables');
        break;
      case 'ABBREVIATIONS': {
        const entries = Object.entries(details.abbreviations);
        if (entries.length === 0) break;
        out.push(
          ...unnumbered('Abbreviations'),
          [
            '\\begin{description}',
            ...entries.map(([short, long]) => `\\item[${escapeLatex(short)}] ${escapeLatex(long)}`),
            '\\end{description}',
          ].join('\n'),
        );
        break;
      }
    }
  }
  return out.filter(Boolean);
}

function pageNumbering(style: string): string {
  switch (style) {
    case 'lowerRoman':
      return '\\pagenumbering{roman}';
    case 'upperRoman':
      return '\\pagenumbering{Roman}';
    case 'none':
      return '\\pagenumbering{gobble}';
    default:
      return '\\pagenumbering{arabic}';
  }
}

function preamble(input: LatexExportInput): string[] {
  const { spec } = input;
  const size = spec.font.sizePt <= 10.5 ? '10pt' : spec.font.sizePt <= 11.5 ? '11pt' : '12pt';
  const paper = spec.page.size === 'Letter' ? 'letterpaper' : 'a4paper';
  const m = spec.page.marginsMm;
  const chapter = spec.headings.chapter;
  const align =
    chapter.align === 'center' ? '\\centering' : chapter.align === 'right' ? '\\raggedleft' : '';
  const chapterLabel = latexPattern(chapter.label, { n: '\\thechapter' });
  const sectionNumber = latexPattern(spec.headings.h2.numbering, {
    chapter: '\\thechapter',
    n: '\\arabic{section}',
  });
  const subsectionNumber = latexPattern(spec.headings.h3.numbering, {
    chapter: '\\thechapter',
    n: '\\arabic{section}',
    m: '\\arabic{subsection}',
  });
  return [
    `% Exported from Thesis Copilot on ${input.exportedOn}.`,
    '%',
    '% Build with pdfLaTeX (or XeLaTeX) and Biber: on Overleaf, upload the .zip as a new project;',
    '% locally, `latexmk -pdf main.tex`. README.txt has the details.',
    '%',
    `% Citations are \\parencite / \\textcite over references.bib. The editor formats them in`,
    `% ${input.styleLabel.replace(/[\r\n]+/g, ' ')}; here biblatex formats them in its built-in`,
    `% "${input.bibStyle}" style, the nearest to it. For the exact style your university requires,`,
    '% change `style=` below, or load its own biblatex style.',
    `\\documentclass[${size},${paper},oneside]{report}`,
    '\\usepackage{iftex}',
    ...fontPackages(spec),
    `\\usepackage[top=${m.top}mm,bottom=${m.bottom}mm,left=${m.left}mm,right=${m.right}mm]{geometry}`,
    '\\usepackage{setspace}',
    spacing(spec.font.lineSpacing),
    `\\setlength{\\parskip}{${spec.font.paragraphSpacingPt}pt}`,
    spec.font.paragraphSpacingPt > 0 ? '\\setlength{\\parindent}{0pt}' : '',
    spec.font.justify ? '' : '\\usepackage{ragged2e}\n\\AtBeginDocument{\\RaggedRight}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{tabularx}',
    '\\usepackage{multirow}',
    // Footnotes number through the whole thesis, as Word and the web page number them.
    '\\counterwithout{footnote}{chapter}',
    '\\usepackage[normalem]{ulem}',
    '\\usepackage{titlesec}',
    `\\titleformat{\\chapter}[display]{\\normalfont${chapter.bold ? '\\bfseries' : ''}\\Large${align}}{${chapterLabel}}{1em}{${chapter.caps ? '\\MakeUppercase' : ''}}`,
    `\\renewcommand{\\thesection}{${sectionNumber}}`,
    `\\renewcommand{\\thesubsection}{${subsectionNumber}}`,
    `\\usepackage[style=${input.bibStyle},backend=biber]{biblatex}`,
    '\\addbibresource{references.bib}',
    '\\usepackage[hidelinks]{hyperref}',
    `\\title{${escapeLatex(input.documentTitle)}}`,
    `\\author{${escapeLatex(input.details.studentName)}}`,
  ].filter(Boolean);
}

/** The whole project as files, before zipping — what the tests read. */
export function thesisToLatexFiles(input: LatexExportInput): LatexFile[] {
  const { spec } = input;
  const figures: LatexFile[] = [];
  const chapters = [...input.chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => ({
      ...chapter,
      content: withCaptionsResolved(withoutPendingDrafts(chapter.content)),
    }));

  const body: string[] = [];
  for (const chapter of chapters) {
    const content = chapter.content as Node | undefined;
    // The heading the student typed wins over the stored title, as in the `.docx`.
    const ownHeading = (content?.content ?? []).find(
      (block) => block.type === 'heading' && Number(block.attrs?.level ?? 2) === 1,
    );
    const title = (ownHeading ? textOf(ownHeading).trim() : '') || chapter.title;
    const ctx: ChapterContext = {
      input,
      chapter: chapter.order,
      numbers: numberingMap(chapter.content),
      figures,
      figureCount: { n: 0 },
      fileCount: { n: 0 },
    };
    body.push(
      // The chapter's own number, not LaTeX's running count: the `.docx`, the HTML and every
      // cross-reference use `chapter.order`, so "Figure 3.2" means the same figure in all three.
      `\\setcounter{chapter}{${chapter.order - 1}}`,
      `\\chapter{${escapeLatex(title)}}`,
      `\\label{chap:${chapter.order}}`,
      ...blocks(content?.content ?? [], ctx),
    );
  }

  const appendices = input.appendices ?? [];
  const main = [
    ...preamble(input),
    '',
    '\\begin{document}',
    pageNumbering(spec.numbering.frontMatter),
    ...frontMatter(input),
    '',
    // The page break first: `\pagenumbering` resets the counter on the page being built, which
    // numbered the last front-matter page as page 1.
    '\\clearpage',
    pageNumbering(spec.numbering.body),
    ...body,
    '',
    `\\printbibliography[heading=bibintoc,title={${escapeLatex(spec.bibliography.title)}}]`,
    ...(appendices.length > 0
      ? [
          '\\appendix',
          ...appendices.flatMap((appendix) => [
            `\\chapter{${escapeLatex(appendix.title)}}`,
            ...appendix.paragraphs.map((p) => escapeLatex(p)),
          ]),
        ]
      : []),
    '\\end{document}',
    '',
  ].join('\n\n');

  const readme = [
    `${input.documentTitle}`,
    '',
    `Exported from Thesis Copilot on ${input.exportedOn} as a LaTeX project.`,
    '',
    'Building it',
    '  Overleaf: New Project > Upload Project > choose this .zip. It compiles as it stands.',
    '  On your computer: latexmk -pdf main.tex   (runs pdfLaTeX and Biber as needed)',
    '',
    'What is in it',
    '  main.tex         the thesis: front matter, chapters, reference list',
    '  references.bib   every source the thesis cites, keyed as main.tex cites them',
    '  figures/         the figures, named by chapter and number',
    '',
    'The reference list',
    `  In the editor your citations follow ${input.styleLabel}. Here biblatex formats them in its`,
    `  built-in "${input.bibStyle}" style, the nearest to it, so the two will not match exactly.`,
    "  Change `style=` in main.tex, or load your university's own biblatex style.",
    '',
    'Equations are typeset here from the LaTeX you wrote in the editor. An AI draft you had not',
    'accepted when you exported is not in this project, as it is not in the .docx.',
    '',
  ].join('\n');

  return [
    { path: 'main.tex', data: main },
    { path: 'references.bib', data: input.bibtex },
    { path: 'README.txt', data: readme },
    ...figures,
  ];
}

/** The project as one `.zip`. */
export async function thesisToLatexZip(input: LatexExportInput): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of thesisToLatexFiles(input)) zip.file(file.path, file.data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
