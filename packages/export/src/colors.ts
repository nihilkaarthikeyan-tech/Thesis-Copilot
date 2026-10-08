/**
 * Text colour, highlight and the contents block in every export (Jenni build plan R28, ADR-0119).
 *
 * The editor stores a colour by palette name (`@tc/types` `TEXT_COLORS`, `HIGHLIGHT_COLORS`), and
 * each name prints in one colour chosen for white paper: the theme the student writes in does not
 * change the file. In the `.docx` a highlight is Word's own highlight of that hue, so Word's Text
 * Highlight Colour button takes it off again; the HTML and LaTeX use the lighter tint the editor's
 * light theme shows.
 */

import {
  colorsOf,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_PRINT,
  type HighlightColor,
  TEXT_COLOR_PRINT,
  TEXT_COLORS,
  type TextColor,
} from '@tc/types';

type MarkLike = { type?: string; attrs?: Record<string, unknown> };
type NodeLike = { type?: string; attrs?: Record<string, unknown>; content?: NodeLike[] };

/** `TextRun` options for a text node's colour and highlight; empty when it has neither. */
export function docxColors(marks: readonly MarkLike[] | undefined): {
  color?: string;
  highlight?: (typeof HIGHLIGHT_PRINT)[HighlightColor]['word'];
} {
  const { color, highlight } = colorsOf(marks);
  return {
    ...(color ? { color: TEXT_COLOR_PRINT[color] } : {}),
    ...(highlight ? { highlight: HIGHLIGHT_PRINT[highlight].word } : {}),
  };
}

/** Already-escaped HTML wrapped in its colour and highlight. */
export function htmlColors(html: string, marks: readonly MarkLike[] | undefined): string {
  const { color, highlight } = colorsOf(marks);
  let out = html;
  if (highlight) out = `<mark class="hl-${highlight}">${out}</mark>`;
  if (color) out = `<span class="ink-${color}">${out}</span>`;
  return out;
}

/** The HTML export's rules for each colour. */
export const HTML_COLOR_CSS = [
  ...TEXT_COLORS.map((name: TextColor) => `.ink-${name} { color: #${TEXT_COLOR_PRINT[name]}; }`),
  ...HIGHLIGHT_COLORS.map(
    (name: HighlightColor) =>
      `mark.hl-${name} { background: #${HIGHLIGHT_PRINT[name].hex}; color: inherit; }`,
  ),
].join('\n');

/**
 * LaTeX that `ulem` can take as an argument. `ulem` (underline, strike-through, and the highlighter
 * below) reads its argument word by word and stops the compile at `\textsubscript{…}` or
 * `\textsuperscript{…}` — so an underlined `CO₂`, which `escapeLatex` writes as
 * `CO\textsubscript{2}`, failed the whole build. Inside an `\mbox` each is one unit. Proved with
 * pdfLaTeX (TeX Live 2026) on 2026-10-08.
 */
export function ulemSafe(latex: string): string {
  const open = /\\text(?:sub|super)script\{/g;
  let out = '';
  let from = 0;
  for (let match = open.exec(latex); match; match = open.exec(latex)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < latex.length && depth > 0) {
      const c = latex[end];
      if (c === '\\') {
        end += 2; // an escaped character, `\{` say, is not a brace
        continue;
      }
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      end += 1;
    }
    out += `${latex.slice(from, match.index)}\\mbox{${latex.slice(match.index, end)}}`;
    from = end;
    open.lastIndex = end;
  }
  return out + latex.slice(from);
}

/**
 * Already-marked LaTeX in its highlight: round the bold, italic, underline and strike-through, so
 * the colour is drawn first and every one of them — a strike-through line too — shows on top of it.
 */
export function latexHighlight(latex: string, marks: readonly MarkLike[] | undefined): string {
  const { highlight } = colorsOf(marks);
  return highlight ? `\\tchl{tchl${highlight}}{${ulemSafe(latex)}}` : latex;
}

export function latexTextColor(latex: string, marks: readonly MarkLike[] | undefined): string {
  const { color } = colorsOf(marks);
  return color ? `\\textcolor{tcink${color}}{${latex}}` : latex;
}

/**
 * The preamble lines the colours need: `xcolor`, the palette, and `\tchl`, a highlighter built on
 * `ulem` (already loaded for underline and strike-through). `ulem` draws its mark before the word
 * and the word over it, so a thick coloured rule sits behind the text, and it breaks across lines
 * as ordinary text does — no extra package, and pdfLaTeX and XeLaTeX both take it.
 */
export const LATEX_COLOR_PREAMBLE: readonly string[] = [
  '\\usepackage{xcolor}',
  ...TEXT_COLORS.map(
    (name: TextColor) => `\\definecolor{tcink${name}}{HTML}{${TEXT_COLOR_PRINT[name]}}`,
  ),
  ...HIGHLIGHT_COLORS.map(
    (name: HighlightColor) => `\\definecolor{tchl${name}}{HTML}{${HIGHLIGHT_PRINT[name].hex}}`,
  ),
  // `\tchl{colour}{text}`: `\ULon` reads the text and closes the group itself, as `\uline` does.
  '\\newcommand{\\tchl}[1]{\\bgroup\\markoverwith{\\textcolor{#1}{\\rule[-0.55ex]{2pt}{2.6ex}}}\\ULon}',
];

/** Whether the content holds a contents block anywhere (the editor's "/" Table of contents). */
export function hasContentsBlock(content: unknown): boolean {
  const walk = (node: NodeLike | undefined): boolean =>
    Boolean(node) &&
    (node?.type === 'tableOfContents' || (node?.content ?? []).some((child) => walk(child)));
  return walk(content as NodeLike | undefined);
}
