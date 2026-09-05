/**
 * The template dialect Appendix A is written in — PRD §10.5.
 *
 * The prompt files use a small Handlebars-like subset: `{{path}}`, `{{#each path}}…{{/each}}` with
 * `{{this}}` and field access inside, and `{{#if path}}…{{/if}}`. Rendering them with this rather
 * than rebuilding each prompt as string concatenation is what keeps §0.3 rule 11 honest: the file
 * is the prompt, byte for byte, and the builder only fills the holes it declares.
 *
 * Deliberately not Handlebars itself. Handlebars HTML-escapes `{{x}}` by default, which would turn
 * a student's `<` into `&lt;` inside the prompt, and its helper system is a surface no prompt uses.
 *
 * `<!-- … -->` comments are notes from the PRD author to the builder (A.0.1 carries one explaining
 * how to render the outline) and are dropped: they instruct the code, not the model.
 */

export type TemplateData = Record<string, unknown>;

/** `{{cite:ID}}` is literal model output syntax in every prompt and must survive rendering. */
const LITERAL_TAGS = /^cite:/;

function lookup(path: string, scopes: readonly TemplateData[]): unknown {
  if (path === 'this') return scopes[scopes.length - 1]?.this;
  const [head, ...rest] = path.split('.');
  if (!head) return undefined;

  // Innermost scope first, so a field inside `{{#each}}` shadows one outside it.
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope) continue;
    const inner = scope.this;
    let value: unknown;
    if (inner && typeof inner === 'object' && head in (inner as object)) {
      value = (inner as Record<string, unknown>)[head];
    } else if (head in scope) {
      value = scope[head];
    } else {
      continue;
    }
    for (const key of rest) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  }
  return undefined;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stringify).join(', ');
  return String(value);
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

/**
 * Finds the `{{/tag}}` that closes the block opened at `openEnd`, honouring nesting of the same
 * tag. Returns the index of the closing tag's start and its end.
 */
function findClose(
  source: string,
  tag: string,
  openEnd: number,
): { start: number; end: number } | null {
  const open = new RegExp(`\\{\\{#${tag}\\b[^}]*\\}\\}`, 'g');
  const close = `{{/${tag}}}`;
  let depth = 1;
  let cursor = openEnd;
  for (;;) {
    const nextClose = source.indexOf(close, cursor);
    if (nextClose === -1) return null;
    open.lastIndex = cursor;
    const nextOpen = open.exec(source);
    if (nextOpen && nextOpen.index < nextClose) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth--;
    if (depth === 0) return { start: nextClose, end: nextClose + close.length };
    cursor = nextClose + close.length;
  }
}

function renderWithScopes(source: string, scopes: TemplateData[]): string {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const open = source.indexOf('{{', i);
    if (open === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, open);

    const close = source.indexOf('}}', open);
    if (close === -1) {
      out += source.slice(open);
      break;
    }
    const tag = source.slice(open + 2, close).trim();
    const afterTag = close + 2;

    if (tag.startsWith('#each ')) {
      const path = tag.slice(6).trim();
      const block = findClose(source, 'each', afterTag);
      if (!block) throw new Error(`Unclosed {{#each ${path}}}`);
      const body = source.slice(afterTag, block.start);
      const items = lookup(path, scopes);
      if (Array.isArray(items)) {
        for (const item of items) {
          out += renderWithScopes(body, [...scopes, { this: item }]);
        }
      }
      i = block.end;
      continue;
    }

    if (tag.startsWith('#if ')) {
      const path = tag.slice(4).trim();
      const block = findClose(source, 'if', afterTag);
      if (!block) throw new Error(`Unclosed {{#if ${path}}}`);
      const body = source.slice(afterTag, block.start);
      if (truthy(lookup(path, scopes))) out += renderWithScopes(body, scopes);
      i = block.end;
      continue;
    }

    if (tag.startsWith('/')) {
      // A stray close tag with no matching open: leave it visible rather than swallow it.
      out += source.slice(open, afterTag);
      i = afterTag;
      continue;
    }

    if (LITERAL_TAGS.test(tag)) {
      out += source.slice(open, afterTag);
      i = afterTag;
      continue;
    }

    out += stringify(lookup(tag, scopes));
    i = afterTag;
  }

  return out;
}

/** Drops `<!-- … -->` and any trailing spaces the comment sat on. */
function stripComments(source: string): string {
  return source.replace(/[ \t]*<!--[\s\S]*?-->/g, '');
}

/**
 * Renders a prompt template. Blank lines left behind by an `{{#if}}` or `{{#each}}` that produced
 * nothing are collapsed, because A.0.1's `{{#if styleProfile}}` sits on its own line and a memory
 * block with no style profile should not carry an empty line where it would have been.
 */
export function renderTemplate(source: string, data: TemplateData): string {
  const rendered = renderWithScopes(stripComments(source), [data]);
  return rendered.replace(/\n{3,}/g, '\n\n');
}
