/**
 * "Ask about what I have written" — the document scope for chat (2026-09-21).
 *
 * Chat has always answered from the *library*: the student's uploaded sources, retrieved by
 * embedding. That is the grounded half of the product and it is not changing. But a competitor
 * audit made the gap obvious — a student cannot ask anything about their own draft, and "what
 * have I already said about adoption barriers?" is a question people actually have while writing.
 *
 * Deliberately **not** embedded or indexed. The student's chapters are a few tens of thousands of
 * words, they change on every keystroke, and an index of them would be stale before it was
 * written. Passing the text directly is both simpler and more correct — and it costs no embedding
 * call, which matters at the Voyage rate limit.
 *
 * The passages are shaped exactly like retrieved ones so the prompt builder, the grounding strip
 * and the citation resolver all treat them identically. What differs is what they *are*: chapters
 * carry no `sourceId`, so nothing here is citable, and `postProcessChat` will strip any citation
 * the model invents against them. That is the right outcome — a claim about your own draft is not
 * a citation, and the bibliography must never gain an entry pointing at the thesis itself.
 */

import type { RetrievedPassage } from '@tc/retrieval';
import { docToText } from '@tc/retrieval';

/**
 * How much of the student's own writing one question may see.
 *
 * A thesis is far larger than a prompt. Rather than silently dropping the later chapters, each
 * chapter contributes a bounded slice and the caller is told how many were included, so the reply
 * can say what it looked at instead of quietly answering from half the document.
 */
export const DOCUMENT_SCOPE = {
  /** Characters per chapter. ~1,500 words, which covers a typical chapter's opening argument. */
  charsPerChapter: 9_000,
  /** Chapters per question, longest-first by relevance to the question. */
  maxChapters: 6,
} as const;

export type ChapterText = {
  id: string;
  title: string;
  order: number;
  content: unknown;
};

/**
 * A crude relevance order: how many of the question's words the chapter contains.
 *
 * Not embeddings, on purpose. This picks which chapters to include when a thesis has more than
 * `maxChapters` of them, and word overlap is enough to prefer the methods chapter for a question
 * about methods. Using the embedding provider here would spend a Voyage call per chapter, per
 * question, to order text that is about to be sent in full anyway.
 */
export function rankChapters(chapters: readonly ChapterText[], question: string): ChapterText[] {
  const terms = new Set(
    question
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3),
  );
  if (terms.size === 0) return [...chapters].sort((a, b) => a.order - b.order);

  const scored = chapters.map((chapter) => {
    const haystack = `${chapter.title} ${docToText(chapter.content)}`.toLowerCase();
    let hits = 0;
    for (const term of terms) if (haystack.includes(term)) hits += 1;
    return { chapter, hits };
  });
  // Ties keep document order, so an unmatched question reads the thesis from the beginning
  // rather than in whatever order the database returned.
  return scored
    .sort((a, b) => b.hits - a.hits || a.chapter.order - b.chapter.order)
    .map((s) => s.chapter);
}

/** The student's own chapters as passages, ready for the same prompt the library scope uses. */
export function passagesFromChapters(
  chapters: readonly ChapterText[],
  question: string,
): RetrievedPassage[] {
  return rankChapters(chapters, question)
    .slice(0, DOCUMENT_SCOPE.maxChapters)
    .map((chapter) => {
      const text = docToText(chapter.content).trim();
      return {
        // Namespaced so it can never collide with a real `S<sourceId>#c<chunkId>`, and so a
        // citation against it is obviously not a source when it reaches the grounding strip.
        id: `D#${chapter.id}`,
        shortRef: chapter.title,
        page: null,
        text: text.slice(0, DOCUMENT_SCOPE.charsPerChapter),
        sourceId: '',
        chunkId: '',
        // The library scope earns these from a vector search. Here every passage is included
        // because the student asked about this document, so relevance is not in question — and
        // `isOffTopic` is skipped for the same reason rather than fed a fabricated number.
        score: 1,
        cosine: 1,
      };
    })
    .filter((passage) => passage.text.length > 0);
}
