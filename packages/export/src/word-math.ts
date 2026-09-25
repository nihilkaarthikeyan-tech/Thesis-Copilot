/**
 * Equations as Word equations (2026-09-25).
 *
 * Until now the `.docx` and PDF printed an equation as its LaTeX source in a monospace font —
 * "\frac{a}{b}" where the reader expected a fraction. Word's own equation format (OMML) is what
 * `docx`'s `Math*` classes write, and there is no LaTeX parser between the two, so this goes the
 * long way round: KaTeX, which already typesets the web page, turns the student's LaTeX into
 * MathML with every symbol resolved to its character, and the MathML tree maps onto `docx`'s
 * fraction, radical, script, limit and bracket builders almost one to one.
 *
 * What does not map — a matrix, an enclosure — returns null, and the caller prints the LaTeX as
 * before. A wrong equation in a submitted thesis is worse than a visibly untypeset one.
 */

import {
  type MathComponent,
  MathFraction,
  MathLimitLower,
  MathLimitUpper,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
} from 'docx';
import katex from 'katex';

type El = { tag: string; attrs: Record<string, string>; children: Array<El | string> };

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITY[body.toLowerCase()] ?? whole;
  });

/** A small parser for the well-formed XML KaTeX writes. Not a general XML parser. */
export function parseXml(xml: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [] };
  const stack: El[] = [root];
  const token = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (let m = token.exec(xml); m; m = token.exec(xml)) {
    const parent = stack[stack.length - 1] as El;
    if (m[5] !== undefined) {
      const text = decode(m[5]);
      if (text.trim()) parent.children.push(text);
      continue;
    }
    const [, closing, tag = '', rawAttrs = '', selfClosing] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attrs[a[1] as string] = decode(a[2] ?? '');
    }
    const el: El = { tag, attrs, children: [] };
    parent.children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

class Unsupported extends Error {}

/** KaTeX's accent characters → the combining mark that puts the same accent on a letter. */
const COMBINING: Record<string, string> = {
  ˉ: '̄', // \bar
  '¯': '̄',
  ˆ: '̂', // \hat
  '^': '̂',
  '˜': '̃', // \tilde
  '~': '̃',
  '˙': '̇', // \dot
  '¨': '̈', // \ddot
  ˇ: '̌', // \check
  '´': '́', // \acute
  '`': '̀', // \grave
  '→': '⃗', // \vec
  '⃗': '⃗',
};

/** Accent characters LibreOffice's OMML import rejects, and what to print above instead. */
const SAFE_ACCENT: Record<string, string> = { ˉ: '‾', '¯': '‾' };

const elements = (el: El) => el.children.filter((c): c is El => typeof c !== 'string');
const textOf = (el: El): string =>
  el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

/** One MathML element as Word maths. Throws `Unsupported` for what has no faithful mapping. */
function convert(el: El): MathComponent[] {
  const kids = elements(el);
  const arg = (i: number) => convert(kids[i] ?? { tag: 'mrow', attrs: {}, children: [] });
  switch (el.tag) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'mphantom':
      return kids.flatMap(convert);
    case 'semantics':
      // The presentation tree; the TeX annotation after it is for search, not display.
      return kids[0] ? convert(kids[0]) : [];
    case 'annotation':
    case 'mspace':
      return [];
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext': {
      const text = textOf(el);
      return text ? [new MathRun(text)] : [];
    }
    case 'mfrac':
      return [new MathFraction({ numerator: arg(0), denominator: arg(1) })];
    case 'msqrt':
      return [new MathRadical({ children: kids.flatMap(convert) })];
    case 'mroot':
      return [new MathRadical({ children: arg(0), degree: arg(1) })];
    case 'msub':
      return [new MathSubScript({ children: arg(0), subScript: arg(1) })];
    case 'msup':
      return [new MathSuperScript({ children: arg(0), superScript: arg(1) })];
    case 'msubsup':
      return [new MathSubSuperScript({ children: arg(0), subScript: arg(1), superScript: arg(2) })];
    // Limits under and over — a sum's bounds, an accent. Not in `docx`'s MathComponent union,
    // though they are what OMML uses for exactly this.
    case 'munder':
      return [new MathLimitLower({ children: arg(0), limit: arg(1) }) as unknown as MathComponent];
    case 'mover': {
      // An accent on one letter is that letter with a combining accent — x̄, x̂, v⃗ — which is how
      // Word writes it too. A wider base keeps the accent above it as a limit, with the one
      // character LibreOffice's importer cannot take (KaTeX's macron, U+02C9) swapped for the
      // overline: that single character failed the whole PDF conversion (2026-09-25).
      const base = kids[0];
      const accent = kids[1] ? textOf(kids[1]) : '';
      const combining = COMBINING[accent];
      if (el.attrs.accent === 'true' && base && combining && /^m[in]$/.test(base.tag)) {
        const letter = textOf(base);
        if ([...letter].length === 1) return [new MathRun(`${letter}${combining}`)];
      }
      const limit = accent in SAFE_ACCENT ? [new MathRun(SAFE_ACCENT[accent] as string)] : arg(1);
      return [new MathLimitUpper({ children: arg(0), limit }) as unknown as MathComponent];
    }
    case 'munderover':
      return [
        new MathLimitUpper({
          children: [
            new MathLimitLower({ children: arg(0), limit: arg(1) }) as unknown as MathComponent,
          ],
          limit: arg(2),
        }) as unknown as MathComponent,
      ];
    default:
      // mtable (matrices, aligned), menclose, merror…: printed as LaTeX by the caller instead.
      throw new Unsupported(el.tag);
  }
}

/** The equation as Word maths, or null when it should be printed as its LaTeX source. */
export function latexToWordMath(latex: string, display = false): MathComponent[] | null {
  const source = latex.trim();
  if (!source) return null;
  let html: string;
  try {
    html = katex.renderToString(source, {
      output: 'mathml',
      throwOnError: true,
      displayMode: display,
    });
  } catch {
    return null; // not valid LaTeX: the student sees their source, as before
  }
  const find = (el: El): El | null => {
    if (el.tag === 'math') return el;
    for (const child of elements(el)) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  const math = find(parseXml(html));
  if (!math) return null;
  try {
    const out = convert(math);
    return out.length > 0 ? out : null;
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}
