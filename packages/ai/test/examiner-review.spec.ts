/**
 * Examiner review — ADR-0056. How a chapter the student wrote is read into sections of sentences,
 * and what each section's examiner input holds.
 *
 * Pinned: the positions are exact (a flag that lands a few characters off highlights the wrong
 * words); a pending AI draft is never reviewed or counted (FR-4.10); a citation whose passage
 * cannot be read is taken out rather than judged against nothing; and the request is metered as
 * `EXAMINER_REVIEW`, not as the chapter build it borrows the prompt from.
 */

import { disciplineProfile } from '@tc/config';
import { describe, expect, it } from 'vitest';
import {
  buildExaminerReviewRequest,
  EXAMINER_REVIEW,
  examinerSchema,
  mockExaminerFor,
  ownSentenceCount,
  postProcessExaminer,
  reviewChapter,
  sectionInput,
} from '../src/index.js';

const text = (t: string) => ({ type: 'text', text: t });
const cite = (sourceId: string | null, chunkId: string | null) => ({
  type: 'citation',
  attrs: { key: `k-${sourceId}`, sourceId, chunkId },
});
const heading = (level: number, t: string) => ({
  type: 'heading',
  attrs: { level },
  content: [text(t)],
});
const para = (...content: unknown[]) => ({ type: 'paragraph', content });

const FIRST = 'Solar drying removes moisture using solar heat in an enclosed cabinet ';
const SECOND = '. Open drying loses an estimated fifth of the catch to spoilage.';

const chapter = {
  type: 'doc',
  content: [
    heading(1, 'Literature review'),
    para(text(FIRST), cite('S1', 'K1'), text(SECOND)),
    heading(2, 'Drying kinetics'),
    para(
      text('Moisture ratio falls exponentially with drying time in thin layers '),
      cite('S2', null),
      text('.'),
    ),
    {
      type: 'draftBlock',
      attrs: { draftId: 'd1', status: 'pending' },
      content: [
        heading(2, 'Drafted'),
        para(text('This AI draft sentence must never be reviewed by the examiner at all.')),
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [para(text('Temperature controls the rate of moisture diffusion strongly.'))],
        },
      ],
    },
    heading(2, 'Summary'),
    para(text('The chapter has shown that solar drying reduces spoilage losses.')),
  ],
};

describe('reviewChapter', () => {
  it('splits at the headings and keeps the student’s own sentences only', () => {
    const review = reviewChapter(chapter, 'Chapter 2');
    expect(review.sections.map((s) => s.title)).toEqual([
      'Literature review',
      'Drying kinetics',
      'Summary',
    ]);
    expect(review.sections.map((s) => s.isSummary)).toEqual([false, false, true]);
    const all = review.sections.flatMap((s) => s.sentences.map((x) => x.plain));
    expect(all.some((s) => s.includes('AI draft'))).toBe(false);
    expect(all).toContain('Temperature controls the rate of moisture diffusion strongly.');
  });

  it('gives each sentence the exact ProseMirror range it occupies', () => {
    const review = reviewChapter(chapter);
    const [first, second] = review.sections[0]?.sentences ?? [];
    // The heading "Literature review" is 17 characters: positions 0–19. The paragraph opens at 19,
    // its text at 20, the citation atom right after FIRST, and the full stop after the atom.
    const citationAt = 20 + FIRST.length;
    expect(first?.from).toBe(20);
    expect(first?.to).toBe(citationAt + 2);
    expect(first?.marked).toBe(`${FIRST}{{cite:c0}}.`);
    expect(first?.plain).toBe(`${FIRST.trim()}.`);
    expect(first?.citations).toEqual([0]);
    expect(second?.from).toBe(citationAt + 3);
    expect(second?.to).toBe(20 + FIRST.length + 1 + SECOND.length);
    expect(second?.citations).toEqual([]);
  });

  it('counts positions through a pending draft and a list it does not read', () => {
    const review = reviewChapter(chapter);
    const listSentence = review.sections[1]?.sentences[1];
    const content = chapter.content;
    // Everything before the list, by ProseMirror's node sizes.
    const size = (node: unknown): number => {
      const n = node as { type: string; text?: string; content?: unknown[] };
      if (n.type === 'text') return n.text?.length ?? 0;
      if (n.type === 'citation') return 1;
      return 2 + (n.content ?? []).reduce<number>((sum, c) => sum + size(c), 0);
    };
    const listAt = content.slice(0, 5).reduce((sum, node) => sum + size(node), 0);
    // bulletList, listItem and paragraph each open one position before the text.
    expect(listSentence?.from).toBe(listAt + 3);
    expect((listSentence?.to ?? 0) - (listSentence?.from ?? 0)).toBe(
      'Temperature controls the rate of moisture diffusion strongly.'.length,
    );
  });

  it('a chapter without subheadings is one section', () => {
    const review = reviewChapter(
      {
        type: 'doc',
        content: [
          para(text('One sentence that is long enough to count here. And another one as well.')),
        ],
      },
      'Introduction',
    );
    expect(review.sections).toHaveLength(1);
    expect(review.sections[0]?.title).toBe('Introduction');
  });

  it('sends at most eight sections, joining the smallest neighbours first', () => {
    const many = {
      type: 'doc',
      content: Array.from({ length: 12 }, (_, i) => [
        heading(2, `Part ${i + 1}`),
        para(
          text(
            `Section ${i + 1} opens with a sentence long enough. It closes with another one here.`,
          ),
        ),
      ]).flat(),
    };
    const review = reviewChapter(many);
    expect(review.sections).toHaveLength(EXAMINER_REVIEW.maxSections);
    expect(review.omittedSections).toBe(0);
    expect(review.sections.reduce((n, s) => n + s.sentences.length, 0)).toBe(24);
  });

  it('sends a very long section in parts, and says what it left out', () => {
    const sentences = Array.from(
      { length: 9 * EXAMINER_REVIEW.maxSentencesPerSection + 3 },
      (_, i) => `Sentence number ${i + 1} is long enough to be counted.`,
    ).join(' ');
    const review = reviewChapter({ type: 'doc', content: [para(text(sentences))] }, 'Long');
    expect(review.sections).toHaveLength(EXAMINER_REVIEW.maxSections);
    expect(review.sections[1]?.title).toBe('Long (part 2)');
    expect(review.omittedSections).toBe(2);
    expect(review.omittedSentences).toBe(EXAMINER_REVIEW.maxSentencesPerSection + 3);
  });
});

describe('ownSentenceCount', () => {
  it('counts neither a pending draft nor a fragment', () => {
    expect(ownSentenceCount(chapter)).toBe(5);
    expect(
      ownSentenceCount({
        type: 'doc',
        content: [heading(1, 'Title'), para(text('Too short.'))],
      }),
    ).toBe(0);
  });
});

describe('sectionInput', () => {
  it('numbers the passages it can read and takes out a citation it cannot', () => {
    const review = reviewChapter(chapter);
    const passageFor = (c: { sourceId: string | null; chunkId: string | null }) =>
      c.chunkId === 'K1' ? { key: 'K1', text: 'Cabinet dryers retain heat.' } : null;
    const first = sectionInput(review.sections[0] as never, review.citations, passageFor);
    expect(first.passages).toEqual([{ id: 'P1', text: 'Cabinet dryers retain heat.' }]);
    expect(first.sentences[0]?.id).toBe('s1');
    expect(first.sentences[0]?.text).toBe(`${FIRST}{{cite:P1}}.`);

    const second = sectionInput(review.sections[1] as never, review.citations, passageFor);
    expect(second.passages).toEqual([]);
    expect(second.sentences[0]?.text).toBe(
      'Moisture ratio falls exponentially with drying time in thin layers.',
    );
  });
});

describe('buildExaminerReviewRequest', () => {
  it('is the examiner’s request, metered as EXAMINER_REVIEW, and the mock reads it', () => {
    const review = reviewChapter(chapter);
    const input = sectionInput(review.sections[0] as never, review.citations, () => null);
    const discipline = disciplineProfile(null);
    const pitfalls = [
      { code: 'X-1', wrong: 'Open drying loses an estimated fifth', correct: 'It varies by site.' },
    ];
    const request = buildExaminerReviewRequest({
      discipline,
      paradigm: 'experimental',
      degree: 'PhD',
      section: { id: 'sec1', title: 'Literature review', purpose: '', isSummary: false },
      sentences: input.sentences.map(({ id, text: t }) => ({ id, text: t })),
      entities: [],
      passages: input.passages,
      terminology: [],
      pitfalls,
      userId: 'u',
      documentId: 'd',
    });
    expect(request.action).toBe('EXAMINER_REVIEW');
    expect(request.tier).toBe('strong');
    const result = examinerSchema.parse(mockExaminerFor(request));
    const { issues } = postProcessExaminer(result, {
      sentences: input.sentences,
      pitfalls,
      discipline,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.sentenceId).toBe('s2');
    expect(issues[0]?.severity).toBe('blocking');
  });
});
