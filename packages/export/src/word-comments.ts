/**
 * Comments in the `.docx` (Jenni build plan R27, ADR-0121): the export dialog's "Include comments".
 *
 * A guide's comment is anchored by the words it quotes (`Comment.quotedText`), drawn over the text
 * as a decoration rather than stored in it (ADR-0017). Here each open comment becomes a Word
 * comment over the paragraph or heading that holds those words — the first one, in its chapter —
 * with its replies under it (ADR-0109). A comment whose words are no longer in the chapter is put on
 * the chapter's title line, so none is lost. Like footnotes, the state is keyed on the export's
 * input object (`notesFor`).
 */

import type { ParagraphChild } from 'docx';
import { CommentRangeEnd, CommentRangeStart, CommentReference, Paragraph, TextRun } from 'docx';

export type ExportComment = {
  id: string;
  /** The chapter it was left on; null for a comment on the whole thesis. */
  chapterId: string | null;
  author: string;
  date: Date;
  quotedText: string | null;
  body: string;
  replies: ReadonlyArray<{ author: string; body: string; date: Date }>;
};

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

type Plan = {
  /** Word's comment number for each comment. */
  numbers: Map<string, number>;
  /** The block each comment is placed on, and the comments left for each chapter's title. */
  onBlock: WeakMap<object, number[]>;
  onTitle: Map<string, number[]>;
  /** Comments with no chapter, put on the first chapter's title. */
  loose: number[];
};

const plans = new WeakMap<object, Plan>();

const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const textOf = (node: Node): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

/**
 * Places every comment once, before the file is written: on the first paragraph or heading of its
 * chapter that holds the words it quotes, else on the chapter's title.
 */
export function planComments(
  owner: object,
  comments: readonly ExportComment[] | undefined,
  chapters: ReadonlyArray<{ id: string; content: unknown }>,
): void {
  const plan: Plan = { numbers: new Map(), onBlock: new WeakMap(), onTitle: new Map(), loose: [] };
  for (const [index, comment] of (comments ?? []).entries()) {
    plan.numbers.set(comment.id, index + 1);
  }
  for (const comment of comments ?? []) {
    const n = plan.numbers.get(comment.id) ?? 0;
    const chapter = chapters.find((c) => c.id === comment.chapterId);
    if (!chapter) {
      plan.loose.push(n);
      continue;
    }
    const quoted = squash(comment.quotedText ?? '');
    // The chapter's own title (a level-1 heading) is printed by the exporters themselves; a
    // comment on it goes to the title line below.
    const blocks = ((chapter.content as Node | undefined)?.content ?? []).filter(
      (block) =>
        block.type === 'paragraph' ||
        (block.type === 'heading' && Number(block.attrs?.level ?? 2) > 1),
    );
    const at = quoted ? blocks.find((block) => squash(textOf(block)).includes(quoted)) : undefined;
    if (at) {
      plan.onBlock.set(at, [...(plan.onBlock.get(at) ?? []), n]);
    } else {
      plan.onTitle.set(chapter.id, [...(plan.onTitle.get(chapter.id) ?? []), n]);
    }
  }
  plans.set(owner, plan);
}

function wrap(children: ParagraphChild[], numbers: readonly number[]): ParagraphChild[] {
  if (numbers.length === 0) return children;
  return [
    ...numbers.map((n) => new CommentRangeStart(n)),
    ...children,
    ...numbers.map((n) => new CommentRangeEnd(n)),
    ...numbers.map((n) => new TextRun({ children: [new CommentReference(n)] })),
  ];
}

/** A block's runs, inside the comments placed on it. */
export function withBlockComments(
  owner: object,
  block: object,
  children: ParagraphChild[],
): ParagraphChild[] {
  return wrap(children, plans.get(owner)?.onBlock.get(block) ?? []);
}

/** A chapter title's runs, inside the comments left for it (and, on the first, the loose ones). */
export function withTitleComments(
  owner: object,
  chapterId: string,
  first: boolean,
  children: ParagraphChild[],
): ParagraphChild[] {
  const plan = plans.get(owner);
  if (!plan) return children;
  return wrap(children, [...(plan.onTitle.get(chapterId) ?? []), ...(first ? plan.loose : [])]);
}

/** The `comments` option of the `Document`: each comment with its replies, in Word's terms. */
export function wordComments(
  owner: object,
  comments: readonly ExportComment[] | undefined,
):
  | {
      children: Array<{
        id: number;
        author: string;
        initials: string;
        date: Date;
        children: Paragraph[];
      }>;
    }
  | undefined {
  const plan = plans.get(owner);
  if (!plan || !comments || comments.length === 0) return undefined;
  return {
    children: comments.map((comment) => ({
      id: plan.numbers.get(comment.id) ?? 0,
      author: comment.author,
      initials: initials(comment.author),
      date: comment.date,
      children: [
        ...(comment.quotedText
          ? [
              new Paragraph({
                children: [new TextRun({ text: `“${comment.quotedText}”`, italics: true })],
              }),
            ]
          : []),
        new Paragraph({ children: [new TextRun(comment.body)] }),
        ...comment.replies.map(
          (reply) =>
            new Paragraph({
              children: [
                new TextRun({ text: `${reply.author}: `, bold: true }),
                new TextRun(reply.body),
              ],
            }),
        ),
      ],
    })),
  };
}

function initials(author: string): string {
  const name = author.split('@')[0] ?? author;
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return (parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'C').slice(0, 3);
}
