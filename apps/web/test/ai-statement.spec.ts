/**
 * The AI use statement builder (ADR-0148). Pinned: every number in the text is the stored count;
 * a feature with no recorded use is not mentioned; what the record cannot tell is said; Hindi
 * comes from the catalogue; an empty thesis gets an honest statement; and nothing in either
 * language talks about detection (PRD §12.3).
 */
import { type AiStatementFacts, emptyAiStatementFeatures } from '@tc/types';
import { describe, expect, it } from 'vitest';
import {
  buildAiStatement,
  chapterTable,
  featureSentences,
  paragraphsFromText,
  statementToText,
  tableAsParagraphs,
} from '../src/lib/ai-statement';

function facts(over: Partial<AiStatementFacts> = {}): AiStatementFacts {
  return {
    documentTitle: 'Rooftop solar in Karnataka',
    documentLanguage: 'en',
    createdOn: '2026-09-01',
    from: '2026-09-02',
    to: '2026-10-09',
    features: {
      ...emptyAiStatementFeatures(),
      suggestions: 40,
      drafting: 3,
      edits: 5,
      citations: 7,
      literatureSearch: 2,
    },
    suggestions: { shown: 40, kept: 12 },
    drafts: { shown: 3, accepted: 2 },
    words: { total: 10_000, aiUnedited: 1_500, aiEdited: 500, own: 8_000 },
    chapters: [
      {
        title: 'Introduction',
        order: 1,
        total: 4_000,
        aiUnedited: 500,
        aiEdited: 100,
        own: 3_400,
        actions: 20,
      },
      {
        title: 'Literature review',
        order: 2,
        total: 6_000,
        aiUnedited: 1_000,
        aiEdited: 400,
        own: 4_600,
        actions: 23,
      },
    ],
    sources: { total: 30, autoAdded: 4, cited: 18 },
    ...over,
  };
}

describe('buildAiStatement', () => {
  const statement = buildAiStatement(facts(), 'en');
  const text = statement.paragraphs.join('\n');

  it('opens in the first person with the title and the recorded date range', () => {
    expect(statement.paragraphs[0]).toBe(
      'In preparing this thesis, “Rooftop solar in Karnataka”, I used Thesis Copilot, a writing tool with AI features, between 2 September 2026 and 9 October 2026.',
    );
  });

  it('names only the features the record shows used, with their counts', () => {
    const features = statement.paragraphs[1] ?? '';
    expect(features).toContain(
      'It offered 40 sentence suggestions while I wrote, of which I kept 12',
    );
    expect(features).toContain('draft 3 sections');
    expect(features).toContain('accepted 2 of those drafts');
    expect(features).toContain('edit commands on passages I had selected 5 times');
    expect(features).toContain('suggested citations from my library 7 times');
    expect(features).toContain('2 literature searches');
    // Unused: no proofreading, chat, research, builds, examiner review or viva.
    expect(features).not.toContain('proofreading');
    expect(features).not.toContain('questions about my thesis');
    expect(features).not.toContain('deep research');
    expect(features).not.toContain('build');
    expect(features).not.toContain('examiner');
    expect(features).not.toContain('viva');
    expect(features).not.toContain('coherence');
  });

  it('gives the share of the text from the stored word counts, with the edited figure as a floor', () => {
    expect(text).toContain(
      'Of the 10,000 words in the thesis as it stands, 2,000 (20%) began as AI text I accepted; of those I have since edited at least 500 (25% of that text). The remaining 8,000 words (80%) are recorded as my own writing.',
    );
  });

  it('says what the record cannot tell: pasted text, and edits counted only where touched', () => {
    expect(text).toContain('cannot tell text I pasted in from outside from text I typed');
    expect(text).toContain('the edited figure is a floor');
  });

  it('says how sources were added, from the library counts', () => {
    expect(text).toContain('held 30 sources, of which 18 are cited');
    expect(text).toContain('4 were added by Thesis Copilot on its own');
  });

  it('says that every AI sentence was reviewed and accepted by the student', () => {
    expect(text).toContain('No AI text entered the thesis without my action');
    expect(text).toContain('I accepted, edited or rejected each one');
    expect(text).toContain('full responsibility');
  });

  it('never talks about detection, in either language', () => {
    for (const language of ['en', 'hi'] as const) {
      const all = statementToText(buildAiStatement(facts(), language, { table: true }));
      expect(all.toLowerCase()).not.toMatch(/detect|humani[sz]e|plagiar/);
    }
  });

  it('has no table unless asked for', () => {
    expect(statement.table).toBeNull();
    const withTable = buildAiStatement(facts(), 'en', { table: true });
    expect(withTable.table?.rows).toEqual([
      ['Introduction', '4,000', '600', '100', '3,400', '20'],
      ['Literature review', '6,000', '1,400', '400', '4,600', '23'],
      ['Total', '10,000', '2,000', '500', '8,000', '43'],
    ]);
  });
});

describe('the edge cases', () => {
  it('an empty thesis: nothing used, no text, no sources — and says so, without a date range', () => {
    const empty = buildAiStatement(
      facts({
        features: emptyAiStatementFeatures(),
        suggestions: { shown: 0, kept: 0 },
        drafts: { shown: 0, accepted: 0 },
        words: { total: 0, aiUnedited: 0, aiEdited: 0, own: 0 },
        chapters: [],
        sources: { total: 0, autoAdded: 0, cited: 0 },
        from: null,
        to: null,
      }),
      'en',
      { table: true },
    );
    const text = empty.paragraphs.join('\n');
    expect(text).toContain('Its record shows no use of those features');
    expect(text).toContain('The thesis has no text yet');
    expect(text).toContain('No sources were added');
    expect(text).not.toContain('between');
    expect(text).not.toContain('No AI text entered');
    expect(empty.table).toBeNull();
  });

  it('suggestions shown but none kept says so, rather than claiming a share', () => {
    const none = buildAiStatement(
      facts({
        features: { ...emptyAiStatementFeatures(), suggestions: 9 },
        suggestions: { shown: 9, kept: 0 },
        words: { total: 300, aiUnedited: 0, aiEdited: 0, own: 300 },
      }),
      'en',
    );
    const text = none.paragraphs.join('\n');
    expect(text).toContain(
      'It offered 9 sentence suggestions while I wrote, and I kept none of them.',
    );
    expect(text).toContain('None of the 300 words in the thesis as it stands began as AI text');
  });

  it('every source added by the student reads as such', () => {
    const own = buildAiStatement(facts({ sources: { total: 12, autoAdded: 0, cited: 12 } }), 'en');
    expect(own.paragraphs.join('\n')).toContain('I added every one myself');
  });

  it('a thesis used without a recorded date range opens without one', () => {
    const noDates = buildAiStatement(facts({ from: null, to: null }), 'en');
    expect(noDates.paragraphs[0]).toBe(
      'In preparing this thesis, “Rooftop solar in Karnataka”, I used Thesis Copilot, a writing tool with AI features.',
    );
  });

  it('the one-off features read without a count', () => {
    const sentences = featureSentences(
      facts({ features: { ...emptyAiStatementFeatures(), litReviewBuild: 1, chapterBuild: 2 } }),
      'en',
    );
    expect(sentences).toEqual([
      'I had it build 2 chapters whole from my library, delivered as drafts section by section, each of which I accepted, edited or discarded.',
      'I had it build the literature review whole, delivered as drafts theme by theme, each of which I accepted, edited or discarded.',
    ]);
  });
});

describe('Hindi', () => {
  const hi = buildAiStatement(facts(), 'hi', { table: true });

  it('comes from the Hindi catalogue, with the same numbers', () => {
    expect(hi.title).toBe('AI टूल के उपयोग पर विवरण');
    expect(hi.paragraphs[0]).toContain('Rooftop solar in Karnataka');
    expect(hi.paragraphs[0]).toContain('Thesis Copilot');
    expect(hi.paragraphs[1]).toContain('40');
    expect(hi.paragraphs[1]).toContain('12');
    expect(hi.paragraphs.join('\n')).toContain('10,000');
    expect(hi.paragraphs.join('\n')).toContain('20%');
    expect(hi.table?.header[0]).toBe('अध्याय');
    expect(hi.table?.rows.at(-1)?.[0]).toBe('कुल');
  });

  it('has as many paragraphs as the English', () => {
    expect(hi.paragraphs).toHaveLength(
      buildAiStatement(facts(), 'en', { table: true }).paragraphs.length,
    );
  });
});

describe('text in and out', () => {
  it('statementToText puts the title first and the table as lines', () => {
    const out = statementToText(buildAiStatement(facts(), 'en', { table: true }));
    expect(out.startsWith('Statement on the use of AI tools\n\n')).toBe(true);
    expect(out).toContain('Chapter | Words | Began as AI text');
    expect(out).toContain('Total | 10,000 | 2,000');
  });

  it('paragraphsFromText splits on blank lines only and drops empties', () => {
    expect(paragraphsFromText('One\nstill one.\n\n\nTwo.\n\n  \n')).toEqual([
      'One still one.',
      'Two.',
    ]);
  });

  it('tableAsParagraphs names each cell by its column, for an export of paragraphs only', () => {
    const table = chapterTable(facts(), 'en');
    expect(table && tableAsParagraphs(table)[0]).toBe(
      'Introduction: Words 4,000; Began as AI text 600; Of which edited since 100; Own writing 3,400; AI suggestions and drafts 20.',
    );
  });
});
