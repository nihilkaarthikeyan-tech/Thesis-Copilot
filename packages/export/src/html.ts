/**
 * HTML export — ADR-0021.
 *
 * The thesis as one self-contained web page: figures inlined, equations as MathML (which every
 * current browser draws with no script and no font download), citations exactly as the editor
 * shows them, each linked to its entry in a reference list in the thesis's own style. For reading
 * on a phone, sending to someone without Word, or putting online — a working format like the
 * `.docx`, so no compliance gate.
 *
 * It follows the `.docx` builder's structure on purpose: the template's front matter in its
 * order, the same certificate and declaration wording, headings numbered by the template's
 * patterns, and no AI draft the student has not accepted (`withoutPendingDrafts`).
 */

import { formatRef, numberingMap } from '@tc/types';
import katex from 'katex';
import { captionOf, withCaption, withCaptionsResolved } from './captions.js';
import { printCitation } from './clusters.js';
import { footnoteText } from './footnotes.js';
import { spanOf } from './table-grid.js';
import {
  renderLabel,
  type ThesisChapter,
  type ThesisExportInput,
  withoutPendingDrafts,
} from './thesis.js';

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: Node[];
};

export type HtmlExportInput = Omit<ThesisExportInput, 'bibliography'> & {
  /** In the style's own order, each with the source it describes, so a citation can link to it. */
  bibliography: ReadonlyArray<{ sourceId: string; text: string }>;
  /** Citation node key → the source it cites. */
  citeSources?: Readonly<Record<string, string>>;
  /** The document's language (§2.2), for `<html lang>`. */
  language?: string;
  /** `YYYY-MM-DD`, for the footer. */
  exportedOn: string;
};

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

const textOf = (node: Node | undefined): string =>
  !node ? '' : node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

/** Only links a reader can follow safely: http(s) and mailto. Anything else prints as text. */
function safeHref(href: unknown): string | null {
  return typeof href === 'string' && /^(https?:|mailto:)/i.test(href) ? escapeHtml(href) : null;
}

/** The student's LaTeX as MathML. A mistake in it shows as the source, in the error colour. */
function math(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, { output: 'mathml', throwOnError: false, displayMode });
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' } as const;

type ChapterContext = {
  input: HtmlExportInput;
  chapter: number;
  /** Citation node key → the label the editor shows. */
  renderedMap: Readonly<Record<string, string>>;
  /** R40 (ADR-0117): citations side by side, printed once as one citation. */
  clusters: ThesisChapter['citationClusters'];
  numbers: ReturnType<typeof numberingMap>;
  /** Numbered as `numberTargets` numbers them: document order, not inside tables. */
  figureCount: { n: number };
  tableCount: { n: number };
  heading: { h2: number; h3: number };
  /** For the lists of figures and tables. */
  figures: Array<{ id: string; caption: string }>;
  tables: Array<{ id: string; caption: string }>;
  /** Footnotes: numbered across the thesis, listed per chapter. */
  noteCount: { n: number };
  notes: Array<{ n: number; text: string }>;
};

function inline(nodes: readonly Node[], ctx: ChapterContext): string {
  let out = '';
  for (const [index, node] of nodes.entries()) {
    switch (node.type) {
      case 'text': {
        let text = escapeHtml(node.text ?? '');
        for (const mark of node.marks ?? []) {
          if (mark.type === 'bold') text = `<strong>${text}</strong>`;
          else if (mark.type === 'italic') text = `<em>${text}</em>`;
          else if (mark.type === 'underline') text = `<u>${text}</u>`;
          else if (mark.type === 'strike') text = `<s>${text}</s>`;
          else if (mark.type === 'superscript') text = `<sup>${text}</sup>`;
          else if (mark.type === 'subscript') text = `<sub>${text}</sub>`;
          else if (mark.type === 'code') text = `<code>${text}</code>`;
          else if (mark.type === 'link') {
            const href = safeHref(mark.attrs?.href);
            if (href) text = `<a href="${href}" rel="noopener noreferrer">${text}</a>`;
          }
        }
        out += text;
        break;
      }
      case 'citation': {
        // R40 (ADR-0117): a cluster prints once, at its first node; its other nodes print nothing.
        const print = printCitation(nodes, index, ctx.renderedMap, ctx.clusters);
        if (print.kind === 'skip') break;
        const key = String(node.attrs?.key ?? '');
        const label = print.label;
        if (ctx.input.noteStyle) {
          // ADR-0029: a note style's citation is a footnote holding its note.
          ctx.noteCount.n += 1;
          const n = ctx.noteCount.n;
          ctx.notes.push({ n, text: label ?? '(source missing)' });
          out += `<sup class="footnote-ref"><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>`;
          break;
        }
        if (!label) {
          out += '<strong class="missing">(source missing)</strong>';
          break;
        }
        // A cluster has one label, so it links to its first source's entry, as the .docx does.
        const sourceId = ctx.input.citeSources?.[key];
        out += sourceId
          ? `<a class="citation" href="#ref-${escapeHtml(sourceId)}">${escapeHtml(label)}</a>`
          : `<span class="citation">${escapeHtml(label)}</span>`;
        break;
      }
      case 'crossRef': {
        const refId = typeof node.attrs?.refId === 'string' ? node.attrs.refId : '';
        const kind = node.attrs?.kind === 'table' ? ('table' as const) : ('figure' as const);
        const target = ctx.numbers.get(refId);
        const text = escapeHtml(formatRef(target, ctx.chapter, kind));
        out += target
          ? `<a href="#${kind === 'figure' ? 'fig' : 'tab'}-${ctx.chapter}-${target.index}">${text}</a>`
          : `<strong class="missing">${text}</strong>`;
        break;
      }
      case 'mathInline': {
        const latex = String(node.attrs?.latex ?? '').trim();
        if (latex) out += math(latex, false);
        break;
      }
      case 'needsSourceNote':
        out += `<strong class="missing">[NEEDS SOURCE: ${escapeHtml(String(node.attrs?.text ?? ''))}]</strong>`;
        break;
      case 'footnote': {
        // Numbered through the whole thesis; the notes are listed at the end of their chapter.
        ctx.noteCount.n += 1;
        const n = ctx.noteCount.n;
        ctx.notes.push({ n, text: footnoteText(node) });
        out += `<sup class="footnote-ref"><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>`;
        break;
      }
      case 'hardBreak':
        out += '<br>';
        break;
      default:
        if (node.content) out += inline(node.content, ctx);
    }
  }
  return out;
}

function picture(node: Node, ctx: ChapterContext): string {
  const storageKey =
    (typeof node.attrs?.key === 'string' && node.attrs.key) ||
    (typeof node.attrs?.src === 'string' ? node.attrs.src : '');
  const image = ctx.input.images?.[storageKey];
  const alt = escapeHtml(String(node.attrs?.alt ?? ''));
  if (!image) return `<p class="missing">[${alt || 'figure'} — the image could not be read]</p>`;
  const type = image.type ?? 'png';
  const data = Buffer.from(image.data).toString('base64');
  return `<img src="data:${MIME[type]};base64,${data}" alt="${alt}" width="${Math.round(image.width)}" height="${Math.round(image.height)}">`;
}

function blocks(nodes: readonly Node[], ctx: ChapterContext, inTable = false): string {
  const { spec } = ctx.input;
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const level = Number(node.attrs?.level ?? 2);
        if (level <= 1) break;
        const style = level === 2 ? spec.headings.h2 : spec.headings.h3;
        if (level === 2) {
          ctx.heading.h2 += 1;
          ctx.heading.h3 = 0;
        } else {
          ctx.heading.h3 += 1;
        }
        const number = renderLabel(style.numbering, {
          chapter: ctx.chapter,
          n: ctx.heading.h2,
          m: ctx.heading.h3,
        });
        const id = `sec-${ctx.chapter}-${ctx.heading.h2}${level === 3 ? `-${ctx.heading.h3}` : ''}`;
        const tag = level === 2 ? 'h2' : 'h3';
        out += `<${tag} id="${id}"><span class="number">${escapeHtml(number)}</span> ${escapeHtml(textOf(node).trim())}</${tag}>\n`;
        break;
      }
      case 'paragraph': {
        const text = inline(node.content ?? [], ctx).trim();
        if (text) out += `<p>${text}</p>\n`;
        break;
      }
      case 'blockquote':
        out += `<blockquote>\n${blocks(node.content ?? [], ctx, inTable)}</blockquote>\n`;
        break;
      case 'bulletList':
      case 'orderedList': {
        const tag = node.type === 'orderedList' ? 'ol' : 'ul';
        const items = (node.content ?? [])
          .map((item) => `<li>${blocks(item.content ?? [], ctx, inTable).trim()}</li>`)
          .join('\n');
        out += `<${tag}>\n${items}\n</${tag}>\n`;
        break;
      }
      case 'codeBlock':
        out += `<pre><code>${escapeHtml(textOf(node))}</code></pre>\n`;
        break;
      case 'mathBlock': {
        const latex = String(node.attrs?.latex ?? '').trim();
        if (latex) out += `<div class="equation">${math(latex, true)}</div>\n`;
        break;
      }
      case 'image': {
        const img = picture(node, ctx);
        if (inTable) {
          out += img;
          break;
        }
        ctx.figureCount.n += 1;
        const caption = withCaption(
          renderLabel(spec.captions.figure.format, { chapter: ctx.chapter, n: ctx.figureCount.n }),
          captionOf(node),
        );
        const id = `fig-${ctx.chapter}-${ctx.figureCount.n}`;
        ctx.figures.push({ id, caption });
        const figcaption = `<figcaption>${escapeHtml(caption)}</figcaption>`;
        out +=
          spec.captions.figure.position === 'above'
            ? `<figure id="${id}">${figcaption}${img}</figure>\n`
            : `<figure id="${id}">${img}${figcaption}</figure>\n`;
        break;
      }
      case 'table': {
        ctx.tableCount.n += 1;
        const caption = withCaption(
          renderLabel(spec.captions.table.format, { chapter: ctx.chapter, n: ctx.tableCount.n }),
          captionOf(node),
        );
        const id = `tab-${ctx.chapter}-${ctx.tableCount.n}`;
        ctx.tables.push({ id, caption });
        const rows = (node.content ?? [])
          .map((row) => {
            const cells = (row.content ?? [])
              .map((cell) => {
                const tag = cell.type === 'tableHeader' ? 'th' : 'td';
                const { colspan, rowspan } = spanOf(cell);
                const spans = `${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`;
                return `<${tag}${spans}>${blocks(cell.content ?? [], ctx, true).trim()}</${tag}>`;
              })
              .join('');
            return `<tr>${cells}</tr>`;
          })
          .join('\n');
        const figcaption = `<figcaption>${escapeHtml(caption)}</figcaption>`;
        const tableHtml = `<table>\n${rows}\n</table>`;
        out +=
          spec.captions.table.position === 'above'
            ? `<figure class="table" id="${id}">${figcaption}${tableHtml}</figure>\n`
            : `<figure class="table" id="${id}">${tableHtml}${figcaption}</figure>\n`;
        break;
      }
      case 'draftBlock':
        // Removed before this runs (`withoutPendingDrafts`); here only as a statement of intent.
        break;
      default:
        if (node.content) out += blocks(node.content, ctx, inTable);
    }
  }
  return out;
}

const STYLE = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #1b1b1b; font: 17px/1.65 Georgia, 'Times New Roman', serif; }
main { max-width: 44rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
h1, h2, h3 { line-height: 1.25; }
h1 { font-size: 1.6rem; text-align: center; margin: 0.25rem 0 1.5rem; }
h2 { font-size: 1.25rem; margin-top: 2rem; }
h3 { font-size: 1.05rem; margin-top: 1.5rem; }
.number { color: #555; }
.chapter { margin-top: 4rem; }
.chapter-label { text-align: center; letter-spacing: 0.08em; color: #555; margin: 0; }
.title-page { text-align: center; padding: 3rem 0 4rem; border-bottom: 1px solid #ddd; }
.title-page .title { font-size: 1.7rem; font-weight: bold; margin-bottom: 2rem; }
.front { margin-top: 3rem; }
figure { margin: 1.5rem 0; text-align: center; }
figure img { max-width: 100%; height: auto; }
figcaption { font-size: 0.9rem; color: #444; margin: 0.4rem 0; }
ol.footnotes { font-size: 0.85rem; color: #333; border-top: 1px solid #ccc; margin-top: 2rem; padding-top: 0.5rem; }
table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
th, td { border: 1px solid #bbb; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid #ccc; color: #333; }
pre { overflow-x: auto; background: #f5f5f2; padding: 0.75rem; }
.equation { overflow-x: auto; margin: 1rem 0; }
.citation { color: inherit; text-decoration: underline dotted; }
.missing { color: #a33; }
.bibliography { list-style: none; padding: 0; }
.bibliography li { padding-left: 2rem; text-indent: -2rem; margin: 0.5rem 0; }
.bibliography li:target { background: #fff6d6; }
nav ol { padding-left: 1.25rem; }
footer { max-width: 44rem; margin: 0 auto; padding: 1rem; font-size: 0.8rem; color: #777; }
@media print { body { font-size: 12pt; } main { max-width: none; } .chapter { break-before: page; } }
`;

/** The front matter the template asks for, in its order — what the `.docx` builds, as HTML. */
function frontMatter(
  input: HtmlExportInput,
  lists: { figures: string; tables: string; toc: string },
): string {
  const { spec, details } = input;
  const paragraphs = (text: string) =>
    text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('\n');
  const section = (id: string, title: string, body: string) =>
    `<section class="front" id="${id}"><h1>${escapeHtml(title)}</h1>\n${body}\n</section>\n`;

  let out = '';
  for (const part of spec.frontMatter) {
    switch (part.id) {
      case 'TITLE_PAGE':
        out += `<header class="title-page">
<p class="title">${escapeHtml(input.documentTitle)}</p>
<p>A thesis submitted in partial fulfilment of the requirements for the degree of</p>
<p><strong>${escapeHtml(details.degree)}</strong></p>
<p>by</p>
<p><strong>${escapeHtml(details.studentName)}</strong>${details.rollNo ? `<br>(${escapeHtml(details.rollNo)})` : ''}</p>
<p>under the guidance of</p>
<p><strong>${escapeHtml([details.guideDesignation, details.guideName].filter(Boolean).join(' '))}</strong></p>
<p>${escapeHtml(details.department)}<br><strong>${escapeHtml(details.institution)}</strong><br>${escapeHtml(details.monthYear)}</p>
</header>\n`;
        break;
      case 'CERTIFICATE':
        out += section(
          'certificate',
          'Certificate',
          `<p>${escapeHtml(
            `This is to certify that the thesis entitled “${input.documentTitle}” submitted by ${details.studentName}${details.rollNo ? ` (${details.rollNo})` : ''} to ${details.institution} is a record of bonafide work carried out under my supervision.`,
          )}</p>
<p>${escapeHtml(`${details.guideName}${details.guideDesignation ? `, ${details.guideDesignation}` : ''}`)}${details.hodName ? `<br>${escapeHtml(`${details.hodName}, Head of Department`)}` : ''}</p>`,
        );
        break;
      case 'DECLARATION':
        out += section(
          'declaration',
          'Declaration',
          `<p>I declare that this thesis is my own work and that all sources I have used are acknowledged by complete references. Where the work of an AI assistant contributed to the text, it is disclosed in the accompanying AI-usage log.</p>
<p>${escapeHtml(details.studentName)}<br>${escapeHtml(details.declarationDate)}</p>`,
        );
        break;
      case 'ACKNOWLEDGEMENTS':
        if (details.acknowledgements.trim()) {
          out += section(
            'acknowledgements',
            'Acknowledgements',
            paragraphs(details.acknowledgements),
          );
        }
        break;
      case 'ABSTRACT':
        out += section('abstract', 'Abstract', paragraphs(details.abstract));
        break;
      case 'TOC':
        out += section('contents', 'Contents', lists.toc);
        break;
      case 'LIST_OF_FIGURES':
        if (lists.figures) out += section('list-of-figures', 'List of figures', lists.figures);
        break;
      case 'LIST_OF_TABLES':
        if (lists.tables) out += section('list-of-tables', 'List of tables', lists.tables);
        break;
      case 'ABBREVIATIONS': {
        const entries = Object.entries(details.abbreviations);
        if (entries.length > 0) {
          out += section(
            'abbreviations',
            'Abbreviations',
            `<dl>${entries.map(([short, long]) => `<dt>${escapeHtml(short)}</dt><dd>${escapeHtml(long)}</dd>`).join('')}</dl>`,
          );
        }
        break;
      }
    }
  }
  return out;
}

/** The whole thesis as one HTML document. */
export function thesisToHtml(input: HtmlExportInput): string {
  const { spec } = input;
  const chapters = [...input.chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => ({
      ...chapter,
      content: withCaptionsResolved(withoutPendingDrafts(chapter.content)),
    }));

  const figures: ChapterContext['figures'] = [];
  const tables: ChapterContext['tables'] = [];
  const noteCount = { n: 0 };
  const toc: string[] = [];
  let body = '';

  for (const chapter of chapters) {
    const content = chapter.content as Node | undefined;
    const ownHeading = (content?.content ?? []).find(
      (block) => block.type === 'heading' && Number(block.attrs?.level ?? 2) === 1,
    );
    const title = (ownHeading ? textOf(ownHeading).trim() : '') || chapter.title;
    const ctx: ChapterContext = {
      input,
      chapter: chapter.order,
      renderedMap: chapter.renderedMap,
      clusters: chapter.citationClusters,
      numbers: numberingMap(chapter.content),
      figureCount: { n: 0 },
      tableCount: { n: 0 },
      heading: { h2: 0, h3: 0 },
      figures,
      tables,
      noteCount,
      notes: [],
    };
    const inner = blocks(content?.content ?? [], ctx);
    const label = renderLabel(spec.headings.chapter.label, { n: chapter.order });
    const id = `chapter-${chapter.order}`;
    toc.push(`<li><a href="#${id}">${escapeHtml(label)} — ${escapeHtml(title)}</a></li>`);
    const notes =
      ctx.notes.length > 0
        ? `<ol class="footnotes">${ctx.notes
            .map(
              (note) =>
                `<li value="${note.n}" id="fn-${note.n}">${escapeHtml(note.text)} <a href="#fnref-${note.n}" aria-label="Back to the text">↩</a></li>`,
            )
            .join('')}</ol>\n`
        : '';
    body += `<section class="chapter" id="${id}">
<p class="chapter-label">${escapeHtml(label)}</p>
<h1>${escapeHtml(title)}</h1>
${inner}${notes}</section>\n`;
  }

  if (input.bibliography.length > 0) {
    toc.push(`<li><a href="#references">${escapeHtml(spec.bibliography.title)}</a></li>`);
    body += `<section class="chapter" id="references">
<h1>${escapeHtml(spec.bibliography.title)}</h1>
<ul class="bibliography">
${input.bibliography.map((entry) => `<li id="ref-${escapeHtml(entry.sourceId)}">${escapeHtml(entry.text)}</li>`).join('\n')}
</ul>
</section>\n`;
  }

  for (const [i, appendix] of (input.appendices ?? []).entries()) {
    const id = `appendix-${i + 1}`;
    toc.push(`<li><a href="#${id}">${escapeHtml(appendix.title)}</a></li>`);
    body += `<section class="chapter" id="${id}"><h1>${escapeHtml(appendix.title)}</h1>
${appendix.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
</section>\n`;
  }

  const list = (items: Array<{ id: string; caption: string }>) =>
    items.length > 0
      ? `<ol>${items.map((item) => `<li><a href="#${item.id}">${escapeHtml(item.caption)}</a></li>`).join('')}</ol>`
      : '';
  const front = frontMatter(input, {
    toc: `<nav><ol>${toc.join('')}</ol></nav>`,
    figures: list(figures),
    tables: list(tables),
  });

  const lang = escapeHtml(input.language || 'en');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.documentTitle)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${front}${body}</main>
<footer>Exported from Thesis Copilot on ${escapeHtml(input.exportedOn)}.</footer>
</body>
</html>
`;
}
