/**
 * The outline tree — PRD §10.7.2, FR-3.3, FR-3.4 and PHASES 3.1.
 *
 * FR-3.3 is the constraint that matters here: for Path B, generation "maps the paper's sections
 * onto thesis chapters and lists what is missing rather than inventing structure". So these tests
 * are mostly about what the outline does *not* say when the paper does not say it.
 */

import { describe, expect, it } from 'vitest';
import { emptyExtraction, type PaperExtraction } from '../src/extraction.js';
import {
  DEFAULT_CHAPTER_TITLE,
  findOutlineNode,
  firstChapterOutline,
  type OutlineNode,
  outlineNodeId,
  outlineSchema,
  readOutline,
  scopeWithSection,
  sectionUnderHeading,
  walkOutline,
} from '../src/outline.js';

const extraction = (over: Partial<PaperExtraction> = {}): PaperExtraction => ({
  ...emptyExtraction(),
  ...over,
});

const node = (id: string, children: OutlineNode[] = []): OutlineNode => ({
  id,
  title: `Node ${id}`,
  scopeNote: '',
  children,
});

describe('outlineSchema (§10.7.2)', () => {
  it('accepts the shape the PRD specifies', () => {
    const parsed = outlineSchema.safeParse([
      {
        id: '1-introduction',
        title: 'Introduction',
        scopeNote: 'Sets up the problem.',
        subTheme: 'adoption',
        mappedFromPaperSection: '1. Introduction',
        children: [{ id: '1-1-context', title: 'Context', scopeNote: '', children: [] }],
      },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('reads a stored outline and treats anything invalid as empty', () => {
    expect(readOutline([{ id: 'a', title: 'A', scopeNote: '', children: [] }])).toHaveLength(1);
    // `DocumentMemory.outline` starts as `[]` and can hold anything a bad migration left behind.
    expect(readOutline(null)).toEqual([]);
    expect(readOutline({ not: 'an array' })).toEqual([]);
    expect(readOutline([{ title: 'no id' }])).toEqual([]);
  });
});

describe('walking the tree', () => {
  it('flattens depth-first, the order the outline renders in', () => {
    const tree = [node('a', [node('a1'), node('a2', [node('a2i')])]), node('b')];
    expect(walkOutline(tree).map((n) => n.id)).toEqual(['a', 'a1', 'a2', 'a2i', 'b']);
  });

  it('finds a node at any depth', () => {
    const tree = [node('a', [node('a1', [node('deep')])])];
    expect(findOutlineNode(tree, 'deep')?.id).toBe('deep');
    expect(findOutlineNode(tree, 'missing')).toBeUndefined();
  });
});

describe('outlineNodeId', () => {
  it('is stable for the same heading, so Chapter.outlineNodeId keeps pointing at it', () => {
    expect(outlineNodeId('1. Introduction', 0)).toBe(outlineNodeId('1. Introduction', 0));
    expect(outlineNodeId('1. Introduction', 0)).toBe('1-1-introduction');
  });

  it('still produces an id for a heading with no usable characters', () => {
    expect(outlineNodeId('§§§', 2)).toBe('3');
  });
});

describe('firstChapterOutline (PHASES 3.1, FR-3.3)', () => {
  it('takes the title and scope note from the paper’s first section', () => {
    const outline = firstChapterOutline(
      extraction({
        sections: [
          { heading: '1. Introduction', summary: 'Sets out why rooftop solar uptake is low.' },
          { heading: '2. Method', summary: 'A survey of 312 households.' },
        ],
      }),
    );

    expect(outline.title).toBe('1. Introduction');
    expect(outline.scopeNote).toBe('Sets out why rooftop solar uptake is low.');
    // FR-3.3: the mapping is recorded, so the student can see where a chapter came from.
    expect(outline.mappedFromPaperSection).toBe('1. Introduction');
  });

  it('skips the reference list, which is not a chapter', () => {
    const outline = firstChapterOutline(
      extraction({
        sections: [
          { heading: 'References', summary: '' },
          { heading: 'Discussion', summary: 'What the numbers mean.' },
        ],
      }),
    );
    expect(outline.title).toBe('Discussion');
  });

  it('skips the abstract, which is front matter and not a chapter', () => {
    // A real paper's `sections` almost always starts with "Abstract"; naming the student's first
    // thesis chapter "Abstract" is worse than the neutral default.
    const outline = firstChapterOutline(
      extraction({
        sections: [
          { heading: 'Abstract', summary: 'We survey 312 households.' },
          { heading: '1. Introduction', summary: 'Why uptake is low.' },
        ],
      }),
    );
    expect(outline.title).toBe('1. Introduction');
  });

  it.each([
    'Abstract',
    'Keywords',
    'Highlights',
    'Acknowledgements',
    'Acknowledgments',
    'Author Contributions',
    'Funding',
    'Conflicts of Interest',
    'Appendix A',
    'Supplementary Material',
  ])('treats %s as front or back matter, not a chapter', (heading) => {
    const outline = firstChapterOutline(
      extraction({
        sections: [
          { heading, summary: 'x' },
          { heading: 'Discussion', summary: 'y' },
        ],
      }),
    );
    expect(outline.title).toBe('Discussion');
  });

  it.each(['References', 'Bibliography', 'Works Cited', 'literature cited'])(
    'skips a section headed %s',
    (heading) => {
      const outline = firstChapterOutline(
        extraction({
          sections: [
            { heading, summary: 'x' },
            { heading: 'Results', summary: 'y' },
          ],
        }),
      );
      expect(outline.title).toBe('Results');
    },
  );

  it('falls back to the abstract when the section has no summary', () => {
    const outline = firstChapterOutline(
      extraction({
        abstract: 'We survey 312 households across three districts.',
        sections: [{ heading: 'Introduction', summary: '' }],
      }),
    );
    expect(outline.scopeNote).toBe('We survey 312 households across three districts.');
  });

  it('uses a neutral default rather than inventing a chapter when there is no paper', () => {
    const outline = firstChapterOutline(null, 'Barriers to rooftop solar adoption');

    expect(outline.title).toBe(DEFAULT_CHAPTER_TITLE);
    // FR-3.3 forbids inventing structure, so the scope note only restates the student's own title.
    expect(outline.scopeNote).toBe('Introduces the thesis: Barriers to rooftop solar adoption.');
    expect(outline.mappedFromPaperSection).toBeUndefined();
  });

  it('says nothing at all when there is neither a paper nor a title', () => {
    const outline = firstChapterOutline(null);
    expect(outline.title).toBe(DEFAULT_CHAPTER_TITLE);
    expect(outline.scopeNote).toBe('');
  });

  it('produces a node that validates against §10.7.2', () => {
    const outline = firstChapterOutline(
      extraction({ sections: [{ heading: 'Introduction', summary: 'A summary.' }] }),
    );
    expect(outlineSchema.safeParse([outline]).success).toBe(true);
  });
});

describe('the section under the cursor (fix list A21)', () => {
  const chapter: OutlineNode = {
    id: 'c2',
    title: 'Literature review',
    scopeNote: 'What is known about uptake.',
    children: [
      { id: 's1', title: '2.1 Cost barriers', scopeNote: 'Price and credit.', children: [] },
      {
        id: 's2',
        title: 'Civil engineering constraints',
        scopeNote: 'Water supply.',
        children: [{ id: 's3', title: 'Canal schedules', scopeNote: 'Timing.', children: [] }],
      },
      { id: 's4', title: 'Policy', scopeNote: '', children: [] },
    ],
  };

  it('matches a heading on its words, whatever its number and punctuation', () => {
    expect(sectionUnderHeading(chapter, '2.3 Cost barriers.')?.id).toBe('s1');
    expect(sectionUnderHeading(chapter, 'COST BARRIERS')?.id).toBe('s1');
    expect(sectionUnderHeading(chapter, 'Civil engineering constraints')?.id).toBe('s2');
    expect(sectionUnderHeading(chapter, 'ii. Canal schedules')?.id).toBe('s3');
  });

  it('finds nothing for the chapter heading, an unknown heading or no heading', () => {
    expect(sectionUnderHeading(chapter, 'Literature review')).toBeUndefined();
    expect(sectionUnderHeading(chapter, 'Methods')).toBeUndefined();
    expect(sectionUnderHeading(chapter, undefined)).toBeUndefined();
    expect(sectionUnderHeading(undefined, 'Policy')).toBeUndefined();
  });

  it('adds the section note after the chapter note, and only when there is one', () => {
    const s1 = sectionUnderHeading(chapter, 'Cost barriers');
    expect(scopeWithSection('What is known.', s1)).toBe(
      'What is known.\nThis section, "2.1 Cost barriers": Price and credit.',
    );
    expect(scopeWithSection(null, s1)).toBe('This section, "2.1 Cost barriers": Price and credit.');
    expect(scopeWithSection('What is known.', sectionUnderHeading(chapter, 'Policy'))).toBe(
      'What is known.',
    );
    expect(scopeWithSection(null, undefined)).toBeNull();
  });
});
