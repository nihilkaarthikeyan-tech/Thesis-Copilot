/**
 * ADR-0074, the pure half: which found papers join a thin library's passages, what the student is
 * told while it works, and that the prompt marks them. No database, no network, no model.
 */

import { buildChatRequest, CHAT, chatUserMessage, postProcessChat } from '@tc/ai';
import { CHAT_RESEARCH } from '@tc/retrieval';
import { describe, expect, it } from 'vitest';
import {
  keptStep,
  queryStep,
  readStep,
  researchCandidates,
  researchNote,
  researchPassages,
  shouldResearch,
  thinStep,
} from '../src/modules/assist/chat-research.js';
import type { WebResult } from '../src/modules/assist/web-scope.service.js';

function result(i: number, over: Partial<WebResult> = {}): WebResult {
  return {
    title: `Household rooftop solar finance study ${i}`,
    abstract: `Study ${i} surveyed rural households in India. Upfront cost and the lack of credit were the barriers most often reported by non-adopters.`,
    matchedPassage: null,
    year: 2020 + i,
    venue: 'Energy Policy',
    doi: `10.1000/fin.${i}`,
    citationCount: 5,
    isPreprint: false,
    openAccess: true,
    inLibrary: false,
    via: 'openalex',
    reference: { raw: `Household rooftop solar finance study ${i}`, doi: `10.1000/fin.${i}` },
    ...over,
  };
}

describe('researchPassages', () => {
  it('keeps only on-topic papers not already in the library, best first, as search passages', () => {
    const built = researchPassages(
      [
        { result: result(1), cosine: 0.62 },
        { result: result(2), cosine: 0.81 },
        { result: result(3), cosine: 0.59 }, // under the measured line
        { result: result(4, { inLibrary: true }), cosine: 0.9 }, // the library speaks for it
      ],
      {},
    );
    expect(built.passages.map((p) => p.shortRef)).toEqual([
      'Household rooftop solar finance study…, 2022',
      'Household rooftop solar finance study…, 2021',
    ]);
    expect(built.passages.every((p) => p.origin === 'search')).toBe(true);
    expect(built.passages.map((p) => p.id)).toEqual(['Sweb1#cabstract', 'Sweb2#cabstract']);
    expect(built.papers.get('Sweb1#cabstract')?.doi).toBe('10.1000/fin.2');
  });

  it(`takes at most ${CHAT_RESEARCH.maxAbstracts}`, () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ result: result(i), cosine: 0.7 }));
    expect(researchPassages(many, {}).passages).toHaveLength(CHAT_RESEARCH.maxAbstracts);
  });

  it("applies the student's year filter to found papers too", () => {
    const built = researchPassages(
      [
        { result: result(1), cosine: 0.7 },
        { result: result(5), cosine: 0.7 },
      ],
      { yearFrom: 2024 },
    );
    expect(built.passages).toHaveLength(1);
    expect(built.papers.get('Sweb1#cabstract')?.year).toBe(2025);
  });
});

describe('researchCandidates', () => {
  it('reads only papers with an abstract that are not in the library, at most the budget', () => {
    const list = [
      result(1, { abstract: null }),
      result(2, { abstract: 'Abstract not available.' }),
      result(3, { inLibrary: true }),
      ...Array.from({ length: 40 }, (_, i) => result(10 + i)),
    ];
    const kept = researchCandidates(list);
    expect(kept).toHaveLength(CHAT_RESEARCH.maxCandidates);
    expect(kept[0]?.title).toBe('Household rooftop solar finance study 10');
  });
});

describe('the steps', () => {
  it('say what is happening in plain words, with what another language needs', () => {
    expect(
      thinStep({ best: 0.8, onTopic: 8, sources: 3, thin: true, reason: 'few-sources' }),
    ).toEqual({
      id: 'research',
      text: 'Your library has 3 papers on this, so I am searching the literature too…',
      params: { papers: 3 },
    });
    expect(
      thinStep({ best: 0.8, onTopic: 2, sources: 1, thin: true, reason: 'few-passages' }).text,
    ).toBe('Your library has 1 paper on this, so I am searching the literature too…');
    expect(
      queryStep(['OpenAlex', 'PubMed', 'arXiv'], 'financial barriers rooftop solar').text,
    ).toBe('Searching OpenAlex, PubMed and arXiv for: financial barriers rooftop solar…');
    expect(queryStep(['OpenAlex'], 'q').text).toBe('Searching OpenAlex for: q…');
    expect(readStep(8).text).toBe('Reading 8 abstracts…');
    expect(keptStep(3, 8).text).toBe('3 of 8 are on your question');
    expect(keptStep(0, 5).text).toMatch(/answering from your library$/);
  });

  it('the line under the answer names both kinds of source', () => {
    expect(researchNote(3, 4)).toBe(
      'From 3 papers in your library and the abstracts of 4 found by a search, not in your library — add the ones you use.',
    );
  });
});

describe('the request', () => {
  const library = Array.from({ length: 8 }, (_, i) => ({
    id: `S${i + 1}#c1`,
    shortRef: `Lib ${i + 1}`,
    page: null,
    text: `Library passage ${i + 1}.`,
  }));
  const found = researchPassages(
    [1, 2, 3].map((i) => ({ result: result(i), cosine: 0.7 })),
    {},
  ).passages;
  const input = {
    memoryBlock: '',
    question: 'What are the financial barriers?',
    history: [],
    passages: [...library, ...found],
    filters: {},
    userId: 'u',
    documentId: 'd',
  };

  it('sends the library and the found abstracts, the found ones marked origin="search"', () => {
    const message = chatUserMessage({ ...input, maxPassages: CHAT.researchTopK });
    expect(message.match(/<passage /g)).toHaveLength(11);
    expect(message.match(/origin="search"/g)).toHaveLength(3);
    expect(message).toContain('<passage id="Sweb1#cabstract"');
  });

  it('without the research budget it is still A.4’s eight', () => {
    expect(chatUserMessage(input).match(/<passage /g)).toHaveLength(CHAT.topK);
  });

  it('is on the tier it is given (AI_CHAT_TIER), fast when none is given', () => {
    expect(buildChatRequest({ ...input, tier: 'strong' }).tier).toBe('strong');
    expect(buildChatRequest(input).tier).toBe('fast');
  });

  it('a citation of anything not sent is stripped and counted, found papers included', () => {
    const ids = [...library, ...found].map((p) => p.id);
    const out = postProcessChat(
      '### Cost\nUpfront cost {{cite:Sweb2#cabstract}}. Credit {{cite:Sweb9#cabstract}}. Trust {{cite:S1#c1}}.',
      ids,
    );
    expect(out.cited).toEqual(['Sweb2#cabstract', 'S1#c1']);
    expect(out.hallucinated).toEqual(['Sweb9#cabstract']);
    expect(out.text.startsWith('### Cost\n')).toBe(true);
  });
});

describe('shouldResearch (row 39, 2026-10-05)', () => {
  const thin = { best: 0.7, onTopic: 2, sources: 1, thin: true, reason: 'few-sources' as const };
  const full = { best: 0.8, onTopic: 8, sources: 5, thin: false, reason: null };

  it('"Ask first" searches only a thin library; "On" searches every question; "Off" never', () => {
    expect(shouldResearch(thin, 'ask', 0)).toBe(true);
    expect(shouldResearch(full, 'ask', 0)).toBe(false);
    expect(shouldResearch(full, 'on', 0)).toBe(true);
    expect(shouldResearch(thin, 'off', 0)).toBe(false);
  });

  it('papers named with @ are the whole ground, whatever the setting', () => {
    expect(shouldResearch(thin, 'on', 2)).toBe(false);
  });

  it('the step says why: thin, or the setting', () => {
    expect(thinStep(full).text).toBe(
      'Your library has 5 papers on this; searching the literature too, as your settings ask…',
    );
    expect(thinStep(full).params).toEqual({ papers: 5, always: 1 });
    expect(thinStep(thin).params).toEqual({ papers: 1 });
  });
});
