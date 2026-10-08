/**
 * A chapter's saved content drawn as plain, unchangeable HTML (2026-09-29), for an administrator
 * reading a thesis. No editor is mounted: there is nothing to type into, and nothing that could
 * save. Every node the editor writes is drawn; anything unknown falls back to its text. The
 * `thesis-editor` class gives it the editor's own typography (`app/editor.css`).
 */

import { isHighlightColor, isTextColor } from '@tc/types';
import katex from 'katex';
import type { ReactNode } from 'react';
import 'katex/dist/katex.min.css';

/** KaTeX's HTML for an equation, or the source when it cannot be drawn. */
function typeset(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, output: 'html' });
  } catch {
    return latex;
  }
}

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Mark[];
  content?: Node[];
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function withMarks(text: string, marks: Mark[] | undefined, key: string): ReactNode {
  let out: ReactNode = text;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = <strong>{out}</strong>;
        break;
      case 'italic':
        out = <em>{out}</em>;
        break;
      case 'underline':
        out = <u>{out}</u>;
        break;
      case 'strike':
        out = <s>{out}</s>;
        break;
      case 'subscript':
        out = <sub>{out}</sub>;
        break;
      case 'superscript':
        out = <sup>{out}</sup>;
        break;
      case 'code':
        out = <code>{out}</code>;
        break;
      // R28 (ADR-0119): by palette name, in the theme's shade, as the editor draws them.
      case 'highlight':
        out = (
          <mark
            className="tc-hl"
            data-color={isHighlightColor(mark.attrs?.color) ? mark.attrs?.color : 'yellow'}
          >
            {out}
          </mark>
        );
        break;
      case 'textColor':
        if (isTextColor(mark.attrs?.color)) {
          out = (
            <span className="tc-ink" data-text-color={mark.attrs?.color}>
              {out}
            </span>
          );
        }
        break;
      case 'link':
        out = (
          <a href={str(mark.attrs?.href)} rel="noreferrer noopener" target="_blank">
            {out}
          </a>
        );
        break;
      default:
        break;
    }
  }
  return <span key={key}>{out}</span>;
}

/** The headings a contents block lists, outside any pending draft (as `tocEntries` in `@tc/ui`). */
function headingsIn(root: Node): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = [];
  const textOf = (node: Node): string =>
    node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');
  const walk = (node: Node) => {
    if (node.type === 'draftBlock') return;
    if (node.type === 'heading') {
      const text = textOf(node).replace(/\s+/g, ' ').trim();
      if (text) out.push({ level: Number(node.attrs?.level) || 2, text });
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(root);
  return out;
}

function render(node: Node, key: string, labels: Record<string, string>, root: Node): ReactNode {
  const kids = () =>
    (node.content ?? []).map((child, i) => render(child, `${key}.${i}`, labels, root));
  switch (node.type) {
    case 'doc':
      return <>{kids()}</>;
    case 'text':
      return withMarks(node.text ?? '', node.marks, key);
    case 'paragraph':
      return <p key={key}>{kids()}</p>;
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 1), 4);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      return <Tag key={key}>{kids()}</Tag>;
    }
    case 'bulletList':
      return <ul key={key}>{kids()}</ul>;
    case 'orderedList':
      return <ol key={key}>{kids()}</ol>;
    case 'listItem':
      return <li key={key}>{kids()}</li>;
    case 'blockquote':
      return <blockquote key={key}>{kids()}</blockquote>;
    case 'hardBreak':
      return <br key={key} />;
    case 'horizontalRule':
      return <hr key={key} />;
    case 'tableOfContents':
      return (
        <div key={key} className="tc-toc">
          <p className="tc-toc-title">Contents</p>
          <ol className="tc-toc-list">
            {headingsIn(root).map((entry, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: headings in document order.
                key={i}
                className="tc-toc-entry"
                data-level={Math.min(Math.max(entry.level, 1), 3)}
              >
                {entry.text}
              </li>
            ))}
          </ol>
        </div>
      );
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{kids()}</code>
        </pre>
      );
    case 'table':
      return (
        <div key={key} className="overflow-x-auto">
          <table>
            <tbody>{kids()}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr key={key}>{kids()}</tr>;
    case 'tableHeader':
      return <th key={key}>{kids()}</th>;
    case 'tableCell':
      return <td key={key}>{kids()}</td>;
    case 'image': {
      const caption = str(node.attrs?.caption) || str(node.attrs?.title) || str(node.attrs?.alt);
      return (
        <figure key={key}>
          {/* biome-ignore lint/performance/noImgElement: a signed link to the student's own file */}
          <img src={str(node.attrs?.src)} alt={str(node.attrs?.alt) || caption || 'Figure'} />
          {caption ? <figcaption>{caption}</figcaption> : null}
        </figure>
      );
    }
    case 'citation': {
      const label = labels[str(node.attrs?.sourceId)] ?? 'citation';
      const locator = str(node.attrs?.locator);
      return (
        <span key={key} className="text-accent">
          ({label}
          {locator ? `, ${locator}` : ''})
        </span>
      );
    }
    case 'footnote':
      return (
        <sup key={key} title={str(node.attrs?.text)} className="text-accent">
          [note: {str(node.attrs?.text)}]
        </sup>
      );
    case 'crossRef':
      return (
        <span key={key} className="text-muted">
          [{str(node.attrs?.kind) || 'figure'}]
        </span>
      );
    case 'mathInline':
      // Typeset, as the student sees it (ADR-0045); KaTeX's own markup, from the stored source.
      return (
        <span
          key={key}
          className="math-inline"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output from our own LaTeX source
          dangerouslySetInnerHTML={{ __html: typeset(str(node.attrs?.latex), false) }}
        />
      );
    case 'mathBlock':
      return (
        <div
          key={key}
          className="math-block my-2 text-center"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output from our own LaTeX source
          dangerouslySetInnerHTML={{ __html: typeset(str(node.attrs?.latex), true) }}
        />
      );
    default:
      return node.content ? <div key={key}>{kids()}</div> : node.text ? node.text : null;
  }
}

export function ReadOnlyChapter({
  content,
  citeLabels,
}: {
  content: unknown;
  citeLabels: Record<string, string>;
}) {
  return (
    <div className="thesis-editor" data-testid="admin-read-only-chapter">
      {render((content ?? {}) as Node, 'c', citeLabels, (content ?? {}) as Node)}
    </div>
  );
}
