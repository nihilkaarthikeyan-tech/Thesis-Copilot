/**
 * Equations in model output (ADR-0045).
 *
 * The prompts tell the model to write every equation in LaTeX between `$…$` (inline) or `$$…$$`
 * (on its own line). This is the one tokenizer that finds them, mirrored in `@tc/ui`'s
 * `ai-text.ts` for the editor paths (the two packages do not depend on each other; the regex is
 * the shared contract and both test it on the same strings).
 *
 * Inline `$…$` is deliberately narrow — no line break, no leading or trailing space, no digit
 * right after the closing `$` — so "$5 and $10" stays money and only something that looks like
 * mathematics becomes an equation.
 */
export const NOTATION_RE =
  /\{\{cite:([^}]+)\}\}|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\d$])/g;

export type NotationToken =
  | { type: 'text'; text: string }
  | { type: 'cite'; key: string }
  | { type: 'math'; latex: string; display: boolean };

export function tokenizeNotation(text: string): NotationToken[] {
  const out: NotationToken[] = [];
  let last = 0;
  for (const match of text.matchAll(NOTATION_RE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) });
    const [, cite, display1, display2, inline1, inline2] = match;
    if (cite !== undefined) out.push({ type: 'cite', key: cite.trim() });
    else if (display1 !== undefined || display2 !== undefined)
      out.push({ type: 'math', latex: (display1 ?? display2 ?? '').trim(), display: true });
    else out.push({ type: 'math', latex: (inline1 ?? inline2 ?? '').trim(), display: false });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** A block that is one display equation and nothing else. */
export function displayEquationOf(block: string): string | null {
  const m = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])$/.exec(block.trim());
  if (!m) return null;
  const latex = (m[1] ?? m[2] ?? '').trim();
  return latex.length > 0 ? latex : null;
}

/** Strips citation markers and equations down to plain words, for checks that read prose. */
export function withoutNotation(text: string): string {
  return tokenizeNotation(text)
    .map((t) => (t.type === 'text' ? t.text : t.type === 'math' ? ' ' : ''))
    .join('')
    .replace(/[ \t]{2,}/g, ' ');
}
