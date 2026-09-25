/**
 * Which parts of the thesis a viva question set is written from (ADR-0030).
 *
 * The whole thesis does not fit in one request and would not be worth the tokens if it did: an
 * examiner reads it all but asks about a handful of places. So the passages are paragraphs spread
 * evenly across the chapters — every chapter is examinable, none dominates — each cut to a length
 * a question can be about. Pure, so the choice is testable without a model.
 */

import { VIVA, type VivaPassage } from '@tc/ai';
import { blocksOf } from '@tc/retrieval';

export type ThesisPassage = VivaPassage & {
  chapterId: string;
  /** Where the paragraph's text sits in the chapter, for "show me where". */
  from: number;
  to: number;
};

type ChapterIn = { id: string; title: string; order: number; content: unknown };

/**
 * Paragraphs only: not a pending AI draft (FR-4.10: not the student's text yet), a heading, a
 * table or a figure. Lists and quotations are left out too — `blocksOf` joins their items' text
 * with no space between, and a passage the student would not recognise is a poor thing to quote.
 */
const PROSE = new Set(['paragraph']);

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

const cut = (text: string) => {
  const words = wordsOf(text);
  return words.length <= VIVA.passageWords
    ? text
    : `${words.slice(0, VIVA.passageWords).join(' ')}…`;
};

/** Every paragraph long enough to be examined on, chapter by chapter, in order. */
export function prosePassages(chapters: readonly ChapterIn[]): Array<Omit<ThesisPassage, 'id'>> {
  const out: Array<Omit<ThesisPassage, 'id'>> = [];
  for (const chapter of [...chapters].sort((a, b) => a.order - b.order)) {
    for (const block of blocksOf(chapter.content)) {
      if (!PROSE.has(block.type)) continue;
      if (wordsOf(block.text).length < VIVA.minPassageWords) continue;
      out.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        text: block.text,
        // The block's own opening and closing tokens are not text.
        from: block.from + 1,
        to: block.to - 1,
      });
    }
  }
  return out;
}

/** Up to `VIVA.maxPassages`, spread evenly within each chapter and fairly across chapters. */
export function selectVivaPassages(chapters: readonly ChapterIn[]): ThesisPassage[] {
  const all = prosePassages(chapters);
  const byChapter = new Map<string, typeof all>();
  for (const passage of all) {
    const list = byChapter.get(passage.chapterId) ?? [];
    list.push(passage);
    byChapter.set(passage.chapterId, list);
  }
  const groups = [...byChapter.values()];
  const quota = Math.max(1, Math.ceil(VIVA.maxPassages / Math.max(1, groups.length)));
  const picked: typeof all = [];
  for (const group of groups) {
    const k = Math.min(quota, group.length);
    for (let i = 0; i < k; i++) {
      const at = k === 1 ? 0 : Math.round((i * (group.length - 1)) / (k - 1));
      picked.push(group[at] as (typeof all)[number]);
    }
  }
  return picked.slice(0, VIVA.maxPassages).map((passage, i) => ({
    ...passage,
    id: `p${i + 1}`,
    text: cut(passage.text),
  }));
}

const contentWords = (text: string) =>
  new Set((text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((word) => !STOP.has(word)));
const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'were', 'which', 'their', 'there']);

/**
 * The passages an answer should be judged against besides the question's own: the ones sharing
 * the most words with the question and the answer together. Word overlap, not embeddings — the
 * thesis's own terms are what a relevant paragraph and a good answer have in common.
 */
export function relatedPassages(
  own: string,
  questionAndAnswer: string,
  chapters: readonly ChapterIn[],
): Array<Omit<ThesisPassage, 'id'>> {
  const wanted = contentWords(questionAndAnswer);
  const ownStart = own.slice(0, 80);
  return prosePassages(chapters)
    .filter((p) => !p.text.startsWith(ownStart.replace(/…$/, '')))
    .map((p) => {
      let shared = 0;
      for (const word of contentWords(p.text)) if (wanted.has(word)) shared += 1;
      return { passage: p, shared };
    })
    .filter((x) => x.shared >= 2)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, VIVA.relatedPassages)
    .map((x) => ({ ...x.passage, text: cut(x.passage.text) }));
}
