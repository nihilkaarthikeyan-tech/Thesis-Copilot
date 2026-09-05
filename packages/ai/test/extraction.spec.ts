/**
 * PHASES 1-W2 task 2.3 — the A.5 extraction builder: the ≤ 3-part split, the merge rule, Zod
 * validation and the single retry on invalid JSON.
 */

import { emptyExtraction, type PaperExtraction } from '@tc/types';
import { describe, expect, it } from 'vitest';
import {
  buildExtractionRequest,
  buildExtractionUserMessage,
  ExtractionFailed,
  type ExtractionPart,
  extractPaper,
  findReferenceSection,
  mergeExtractions,
  splitForExtraction,
} from '../src/extraction.js';
import { MockLlmProvider } from '../src/providers/mock.js';
import { type LlmProvider, LlmValidationError } from '../src/types.js';

const body = (label: string, paragraphs = 40): string =>
  Array.from(
    { length: paragraphs },
    (_, i) => `${label} paragraph ${i}. It reports the measured adoption rate in the districts.`,
  ).join('\n\n');

const paper = (): string =>
  [
    'Solar adoption in rural Karnataka',
    '',
    'Abstract',
    'We survey 312 households.',
    '',
    '1. Introduction',
    body('intro'),
    '',
    '2. Method',
    body('method'),
    '',
    'References',
    '[1] Kumar, A. (2021). Solar adoption. Energy Policy.',
    '[2] Rao, B. (2019). Wind siting. Renewable Energy.',
  ].join('\n');

describe('findReferenceSection', () => {
  it('finds a plain heading', () => {
    const text = 'Body text.\nReferences\n[1] Kumar.';
    expect(text.slice(findReferenceSection(text) ?? 0)).toBe('References\n[1] Kumar.');
  });

  it.each([
    'References',
    'REFERENCES',
    'Bibliography',
    '5. References',
    'Works Cited',
    'Reference List',
  ])('recognises "%s"', (heading) => {
    const text = `Body.\n${heading}\n[1] Kumar.`;
    expect(findReferenceSection(text)).not.toBeNull();
  });

  it('takes the last heading, so a table of contents does not win', () => {
    const text = 'References\nBody text here.\nReferences\n[1] Kumar.';
    expect(text.slice(findReferenceSection(text) ?? 0)).toBe('References\n[1] Kumar.');
  });

  it('returns null when a paper has no reference heading', () => {
    expect(findReferenceSection('Just body text with no list.')).toBeNull();
  });

  it('does not match a sentence that mentions references', () => {
    expect(findReferenceSection('We removed references to prior work.')).toBeNull();
  });
});

describe('splitForExtraction', () => {
  it('keeps a short paper in one part', () => {
    const parts = splitForExtraction(paper());
    expect(parts).toHaveLength(1);
    expect(parts[0]?.hasReferences).toBe(true);
  });

  it('splits at the reference heading so the list arrives whole', () => {
    const parts = splitForExtraction(paper(), 500);
    expect(parts.length).toBeGreaterThanOrEqual(2);

    const referencePart = parts.find((p) => p.hasReferences);
    expect(referencePart).toBeDefined();
    // The whole list is in one part; A.5 forbids guessing at truncated entries.
    expect(referencePart?.text).toContain('[1] Kumar');
    expect(referencePart?.text).toContain('[2] Rao');
    expect(parts.filter((p) => p.hasReferences)).toHaveLength(1);
  });

  it('never exceeds three parts, as A.5 requires', () => {
    const huge = [body('a', 4000), 'References', '[1] Kumar, A. (2021).'].join('\n');
    const parts = splitForExtraction(huge, 5_000);
    expect(parts.length).toBeLessThanOrEqual(3);
    expect(parts.filter((p) => p.hasReferences)).toHaveLength(1);
  });

  it('puts references in the tail when the paper has no reference heading', () => {
    const parts = splitForExtraction(body('x', 200), 1_000);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.hasReferences).toBe(false);
    expect(parts[1]?.hasReferences).toBe(true);
  });

  it('cuts on a paragraph boundary, not mid-sentence', () => {
    const parts = splitForExtraction(body('x', 200), 2_000);
    for (const part of parts.slice(0, -1)) {
      expect(part.text.trimEnd().endsWith('.')).toBe(true);
    }
  });

  it('numbers the parts in order and loses no text', () => {
    const text = paper();
    const parts = splitForExtraction(text, 500);
    expect(parts.map((p) => p.index)).toEqual(parts.map((_, i) => i));
    expect(parts.map((p) => p.text).join('')).toBe(text);
  });
});

describe('buildExtractionRequest', () => {
  it('uses the Strong tier, temperature 0 and the A.5 output budget', () => {
    const request = buildExtractionRequest({ userId: 'u1', filename: 'p01.pdf', partText: 'text' });
    expect(request.tier).toBe('strong');
    expect(request.temperature).toBe(0);
    expect(request.maxTokens).toBe(4_000);
    expect(request.action).toBe('EXTRACT');
  });

  it('carries the A.0 preamble and the A.5 task block verbatim', () => {
    const request = buildExtractionRequest({ userId: 'u1', filename: 'p01.pdf', partText: 'text' });
    expect(request.system.cached).toContain('You are the writing engine inside Thesis Copilot');
    expect(request.system.cached).toContain('Task: read the full text of an academic paper');
    expect(request.system.cached).toContain('Copy reference strings exactly as they appear');
    // Not cached (A.5): there is no volatile half to keep out of the cache.
    expect(request.system.volatile).toBeUndefined();
  });

  it('wraps the text in the A.5 user message', () => {
    expect(buildExtractionUserMessage('p01.pdf', 'BODY')).toBe(
      '<paper filename="p01.pdf">BODY</paper>',
    );
  });
});

describe('mergeExtractions', () => {
  const part = (index: number, hasReferences: boolean): ExtractionPart => ({
    text: '',
    hasReferences,
    index,
  });

  const withValues = (over: Partial<PaperExtraction>): PaperExtraction => ({
    ...emptyExtraction(),
    ...over,
  });

  it('takes scalars from the first part that has them', () => {
    const merged = mergeExtractions([
      {
        part: part(0, false),
        extraction: withValues({
          title: 'Real title',
          abstract: 'Real abstract',
          methodology: 'Surveyed households.',
        }),
      },
      {
        part: part(1, true),
        extraction: withValues({ title: 'Reference-page artefact', abstract: 'wrong' }),
      },
    ]);
    expect(merged.title).toBe('Real title');
    expect(merged.abstract).toBe('Real abstract');
    expect(merged.methodology).toBe('Surveyed households.');
  });

  it('takes references ONLY from the part holding the reference list', () => {
    const merged = mergeExtractions([
      {
        part: part(0, false),
        // A body part that quoted a citation must not contribute a reference.
        extraction: withValues({ references: [{ raw: 'A stray in-text citation (Kumar 2021)' }] }),
      },
      {
        part: part(1, true),
        extraction: withValues({
          references: [{ raw: '[1] Kumar, A. (2021).' }, { raw: '[2] Rao, B. (2019).' }],
        }),
      },
    ]);
    expect(merged.references.map((r) => r.raw)).toEqual([
      '[1] Kumar, A. (2021).',
      '[2] Rao, B. (2019).',
    ]);
  });

  it('concatenates lists and de-duplicates terms and sections', () => {
    const merged = mergeExtractions([
      {
        part: part(0, false),
        extraction: withValues({
          objectives: ['Measure adoption'],
          terminology: [{ term: 'Adoption', definition: 'first use' }],
          sections: [{ heading: '1. Introduction', summary: 'Sets up.' }],
          findings: [{ claim: 'Cost is the barrier' }],
        }),
      },
      {
        part: part(1, true),
        extraction: withValues({
          objectives: ['Measure adoption', 'Compare districts'],
          terminology: [{ term: 'adoption', definition: 'duplicate, different case' }],
          sections: [{ heading: '1. Introduction', summary: 'duplicate' }],
          findings: [{ claim: 'Awareness is high' }],
        }),
      },
    ]);
    expect(merged.objectives).toEqual(['Measure adoption', 'Compare districts']);
    expect(merged.terminology).toHaveLength(1);
    expect(merged.sections).toHaveLength(1);
    expect(merged.findings).toHaveLength(2);
  });

  it('merges parts in index order regardless of the order they arrive', () => {
    const merged = mergeExtractions([
      { part: part(1, true), extraction: withValues({ title: 'second' }) },
      { part: part(0, false), extraction: withValues({ title: 'first' }) },
    ]);
    expect(merged.title).toBe('first');
  });
});

describe('extractPaper', () => {
  const valid: PaperExtraction = {
    ...emptyExtraction(),
    title: 'Solar adoption in rural Karnataka',
    abstract: 'We survey 312 households.',
    references: [{ raw: '[1] Kumar, A. (2021).' }],
  };

  it('calls the Strong tier once per part and merges', async () => {
    const llm = new MockLlmProvider({ responses: [{ value: valid }] });
    const result = await extractPaper(llm, { userId: 'u1', filename: 'p01.pdf', text: paper() });

    expect(result.parts).toBe(1);
    expect(result.retries).toBe(0);
    expect(result.extraction.title).toBe('Solar adoption in rural Karnataka');
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.tier).toBe('strong');
    expect(llm.calls[0]?.action).toBe('EXTRACT');
  });

  it('reports progress per part', async () => {
    const llm = new MockLlmProvider({ responses: [{ value: valid }] });
    const seen: Array<{ index: number; total: number }> = [];
    await extractPaper(llm, {
      userId: 'u1',
      filename: 'p01.pdf',
      text: paper(),
      maxPartChars: 500,
      onPart: (info) => seen.push(info),
    });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).toEqual({ index: 0, total: seen.length });
  });

  /** A provider whose Nth reply is scripted, so the retry path can be driven exactly. */
  const scripted = (replies: readonly unknown[]): LlmProvider => {
    let call = 0;
    return {
      modelIdFor: () => 'mock-strong',
      // Extraction is a structured call; this provider never streams.
      stream: () => {
        throw new Error('not used');
      },
      async complete(request) {
        const raw = replies[Math.min(call++, replies.length - 1)];
        const parsed = request.schema.safeParse(raw);
        if (!parsed.success) {
          throw new LlmValidationError(request.action, parsed.error.issues, JSON.stringify(raw));
        }
        return {
          value: parsed.data,
          usage: { inputTokens: 10, outputTokens: 10 },
          modelId: 'mock-strong',
        };
      },
    };
  };

  it('retries once on invalid output, then succeeds', async () => {
    // First reply is a shape the §10.7.1 schema rejects; the second is good.
    const llm = scripted([{ title: 42 }, valid]);

    const result = await extractPaper(llm, { userId: 'u1', filename: 'p01.pdf', text: paper() });
    expect(result.retries).toBe(1);
    expect(result.extraction.title).toBe('Solar adoption in rural Karnataka');
  });

  it('does not retry when the first reply is valid', async () => {
    const result = await extractPaper(scripted([valid]), {
      userId: 'u1',
      filename: 'p01.pdf',
      text: paper(),
    });
    expect(result.retries).toBe(0);
  });

  it('gives up after the retry and names the part that failed', async () => {
    const llm = scripted([{ title: 42 }, { title: 42 }]);
    await expect(
      extractPaper(llm, { userId: 'u1', filename: 'p01.pdf', text: paper() }),
    ).rejects.toBeInstanceOf(ExtractionFailed);
  });

  it('validates against the §10.7.1 schema, normalising empty strings to absent', async () => {
    const llm = new MockLlmProvider({
      responses: [
        {
          value: {
            ...valid,
            // A.5 tells the model to use "" for anything it cannot find.
            references: [{ raw: '[1] Kumar, A. (2021).', doi: '' }],
            findings: [{ claim: 'Cost is the barrier', evidence: '' }],
          },
        },
      ],
    });
    const { extraction } = await extractPaper(llm, {
      userId: 'u1',
      filename: 'p.pdf',
      text: 'short',
    });
    expect(extraction.references[0]?.doi).toBeUndefined();
    expect(extraction.findings[0]?.evidence).toBeUndefined();
  });
});
