/**
 * Chat beyond the library, the pure half — ADR-0060.
 *
 * Which search results become A.4 passages, what they are called, and what grounding does with
 * them. The service wiring (the unit, the refund, the setting) is `chat-beyond-api.spec.ts`.
 */

import { approxTokens, buildChatRequest, CHAT, postProcessChat } from '@tc/ai';
import { ACTION_PROFILES } from '@tc/config';
import { describe, expect, it } from 'vitest';
import {
  BEYOND,
  beyondFilters,
  beyondNote,
  beyondSettingOf,
  passagesFromWebResults,
  readingStep,
  searchingStep,
  shortRefOf,
  trimAbstract,
} from '../src/modules/assist/beyond-library.js';
import type { WebResult } from '../src/modules/assist/web-scope.service.js';

const ABSTRACT =
  'We surveyed 412 households in Karnataka about rooftop solar. Upfront cost was the most ' +
  'reported barrier, followed by uncertainty about net-metering approval times.';

function result(over: Partial<WebResult> = {}): WebResult {
  return {
    title: 'Barriers to rooftop solar adoption among Indian households',
    abstract: ABSTRACT,
    year: 2022,
    venue: 'Energy Policy',
    doi: '10.1016/j.enpol.2022.1',
    citationCount: 30,
    isPreprint: false,
    openAccess: true,
    inLibrary: false,
    via: 'openalex',
    reference: {
      raw: 'Barriers to rooftop solar. Energy Policy. 2022',
      doi: '10.1016/j.enpol.2022.1',
    },
    ...over,
  };
}

describe('which results become passages', () => {
  it('takes only records with an abstract the index returned', () => {
    const { passages, papers } = passagesFromWebResults([
      result({ title: 'No abstract', abstract: null }),
      result({ title: 'Blank abstract', abstract: '   ' }),
      result({ title: 'Placeholder', abstract: 'Abstract not available.' }),
      result({ title: 'Real one' }),
    ]);
    expect(passages).toHaveLength(1);
    expect(papers.get(passages[0]?.id ?? '')?.title).toBe('Real one');
    // The passage is the abstract itself, nothing added.
    expect(passages[0]?.text).toBe(ABSTRACT);
  });

  it('keeps at most eight, A.4’s own top-K, in the search’s order', () => {
    const many = Array.from({ length: 20 }, (_, i) => result({ title: `Paper ${i}` }));
    const { passages, papers } = passagesFromWebResults(many);
    expect(BEYOND.maxPapers).toBe(CHAT.topK);
    expect(passages).toHaveLength(8);
    expect([...papers.values()].map((p) => p.title)).toEqual(
      Array.from({ length: 8 }, (_, i) => `Paper ${i}`),
    );
  });

  it('numbers the ids from one, namespaced away from library chunk ids', () => {
    const { passages } = passagesFromWebResults([result(), result({ title: 'Second' })]);
    expect(passages.map((p) => p.id)).toEqual(['Sweb1#cabstract', 'Sweb2#cabstract']);
  });

  it('marks each paper with whether it is already in the library', () => {
    const { passages, papers } = passagesFromWebResults([
      result({ title: 'Mine', inLibrary: true }),
      result({ title: 'Not mine', inLibrary: false }),
    ]);
    expect(passages.map((p) => papers.get(p.id)?.inLibrary)).toEqual([true, false]);
    // What `POST /sources/resolve` takes travels with it, so Add needs nothing else.
    expect(papers.get('Sweb2#cabstract')?.reference.doi).toBe('10.1016/j.enpol.2022.1');
  });

  it('applies the student’s year, citation and preprint filters, not journal citedness', () => {
    const { passages } = passagesFromWebResults(
      [
        result({ title: 'Old', year: 2001 }),
        result({ title: 'Preprint', isPreprint: true }),
        result({ title: 'Uncited', citationCount: 0 }),
        result({ title: 'Kept' }),
      ],
      beyondFilters({
        yearFrom: 2010,
        excludePreprints: true,
        minCitations: 5,
        minJournalCitedness: 3,
      }),
    );
    expect(passages.map((p) => p.shortRef)).toEqual(['Kept, 2022']);
    expect(beyondFilters({ minJournalCitedness: 3 })).toEqual({});
  });
});

describe('what a passage is called', () => {
  it('is the start of the title and the year — a search result has no authors to name', () => {
    expect(shortRefOf('Barriers to rooftop solar adoption among Indian households', 2022)).toBe(
      'Barriers to rooftop solar adoption…, 2022',
    );
    expect(shortRefOf('Short title', null)).toBe('Short title');
  });

  it('cuts a long abstract at a sentence end', () => {
    const long = `${'A sentence of the abstract. '.repeat(100)}`;
    const cut = trimAbstract(long);
    expect(cut.length).toBeLessThanOrEqual(BEYOND.maxAbstractChars);
    expect(cut.endsWith('.')).toBe(true);
  });
});

describe('grounding over abstracts (§10.6, unchanged)', () => {
  it('keeps a citation of a passage sent and strips one that was not', () => {
    const { passages } = passagesFromWebResults([result()]);
    const processed = postProcessChat(
      'Cost is the main barrier {{cite:Sweb1#cabstract}}, and policy too {{cite:Sweb7#cabstract}}.',
      passages.map((p) => p.id),
    );
    expect(processed.cited).toEqual(['Sweb1#cabstract']);
    expect(processed.hallucinated).toEqual(['Sweb7#cabstract']);
    expect(processed.text).not.toContain('Sweb7');
  });

  it('rescues a bare id the model wrote the way the passage list shows it', () => {
    const { passages } = passagesFromWebResults([result()]);
    const processed = postProcessChat(
      'Cost dominates (Sweb1#cabstract).',
      passages.map((p) => p.id),
    );
    expect(processed.cited).toEqual(['Sweb1#cabstract']);
  });
});

describe('cost: one fast chat call priced as any question', () => {
  it('eight abstracts at the cap fit inside the input CHAT is priced at', () => {
    const longest = 'x'.repeat(BEYOND.maxAbstractChars - 1).replace(/x{80}/g, 'Words here. ');
    const eight = Array.from({ length: 8 }, (_, i) =>
      result({ title: `A long paper title number ${i}`, abstract: longest }),
    );
    const { passages } = passagesFromWebResults(eight);
    const request = buildChatRequest({
      memoryBlock: '',
      question: 'q'.repeat(2_000),
      history: [],
      passages,
      filters: {},
      userId: 'u',
      documentId: 'd',
    });
    const userTokens = approxTokens(String(request.messages.at(-1)?.content ?? ''));
    expect(userTokens).toBeLessThanOrEqual(ACTION_PROFILES.CHAT.inputTokens);
  });
});

describe('what the student is told', () => {
  it('names the steps', () => {
    expect(searchingStep(['OpenAlex', 'Semantic Scholar'])).toBe(
      'Searching OpenAlex, Semantic Scholar…',
    );
    expect(readingStep(8)).toBe('Reading 8 abstracts');
    expect(readingStep(1)).toBe('Reading 1 abstract');
  });

  it('says under the answer where it came from', () => {
    expect(beyondNote(8, 8)).toBe(
      'From the abstracts of 8 papers not in your library — add the ones you use.',
    );
    expect(beyondNote(8, 6)).toBe(
      'From the abstracts of 8 papers, 6 not in your library — add the ones you use.',
    );
  });

  it('asks first until the student chooses', () => {
    expect(beyondSettingOf(null)).toBe('ask');
    expect(beyondSettingOf({})).toBe('ask');
    expect(beyondSettingOf({ searchBeyondLibrary: 'on' })).toBe('on');
    expect(beyondSettingOf({ searchBeyondLibrary: 'off' })).toBe('off');
    expect(beyondSettingOf({ searchBeyondLibrary: 'sometimes' })).toBe('ask');
  });
});
