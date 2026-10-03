/**
 * Draft mode — PRD A.2, FR-4.4, §10.7.3, PHASES 4.2.
 *
 * Draft writes hundreds of words at once, so the failure that matters is not a bad sentence but a
 * page of fluent prose citing nothing, in a document that will be examined. Most of these tests
 * are about what the pipeline refuses to produce.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDraftRequest,
  canDraft,
  countDraftWords,
  DRAFT,
  type DraftSection,
  draftResultSchema,
  draftToProseMirror,
  draftUserMessage,
  postProcessDraft,
} from '../src/builder/draft.js';
import { buildMemoryBlock } from '../src/builder/memory.js';
import { fixtureMemory } from './_memory-fixture.js';

const passages = [
  { id: 'S1#c1', shortRef: 'Kumar 2021', page: 7, text: 'Upfront cost was the main barrier.' },
  { id: 'S2#c1', shortRef: 'Rao 2019', page: null, text: 'Awareness was rarely mentioned.' },
];

const section: DraftSection = {
  outlineNodeId: '2-literature',
  title: 'Literature review',
  scopeNote: 'What is known about household adoption barriers.',
  children: [
    { title: 'Cost barriers', scopeNote: 'What the evidence says about price.' },
    { title: 'Awareness and trust', scopeNote: 'Whether information campaigns worked.' },
  ],
};

const input = {
  memoryBlock: buildMemoryBlock(fixtureMemory).text,
  section,
  passages,
  tier: 'strong' as const,
  userId: 'u',
  documentId: 'd',
};

describe('the A.2 request', () => {
  it('uses A.2’s parameters and the tier it was given', () => {
    const request = buildDraftRequest(input);
    expect(request.action).toBe('DRAFT');
    expect(request.tier).toBe('strong');
    expect(request.maxTokens).toBe(1_200);
    expect(request.temperature).toBe(0.5);
  });

  it('falls back to the Fast tier when the flag says so (PHASES 4.9)', () => {
    expect(buildDraftRequest({ ...input, tier: 'fast' }).tier).toBe('fast');
  });

  it('puts the target word count in the cached block', () => {
    const cached = buildDraftRequest({ ...input, targetWords: 800 }).system.cached;
    expect(cached).toContain('800 words');
    // Two lengths mean two cached prefixes, which is right: the instruction really did change.
    expect(cached).not.toBe(buildDraftRequest({ ...input, targetWords: 400 }).system.cached);
  });

  it('carries the outline’s subheadings, which the model may not add to', () => {
    const message = draftUserMessage(input);
    expect(message).toContain('- Cost barriers: What the evidence says about price.');
    expect(message).toContain('- Awareness and trust: Whether information campaigns worked.');
    expect(message).toContain('<passage id="S1#c1" source="Kumar 2021" page="7">');
  });

  it('includes the student’s prior writing only when there is some', () => {
    expect(draftUserMessage(input)).not.toContain('student_prior_writing');
    expect(draftUserMessage({ ...input, paperExcerpt: 'We surveyed 312 households.' })).toContain(
      'student_prior_writing',
    );
  });
});

describe('canDraft (FR-4.4 AC: refuse with no sources)', () => {
  it('refuses when nothing was retrieved', () => {
    // Writing anyway would produce the single most damaging output this product could make.
    expect(canDraft([])).toBe(false);
    expect(canDraft(passages)).toBe(true);
  });
});

describe('A.2 post-processing', () => {
  it('pulls out the needs-source notes and removes the markers from the prose', () => {
    const markdown = [
      'Cost dominated the responses {{cite:S1#c1}}.',
      '',
      '[[NEEDS SOURCE: subsidy uptake by tenure]]',
      '',
      'Awareness was rarely mentioned {{cite:S2#c1}}.',
    ].join('\n');

    const { result } = postProcessDraft(markdown, passages, 500);
    expect(result.needsSource).toEqual(['subsidy uptake by tenure']);
    // The editor renders these as amber notes from `needsSource`, not as literal text.
    expect(result.markdown).not.toContain('NEEDS SOURCE');
    expect(result.markdown).toContain('Cost dominated');
    expect(result.markdown).toContain('Awareness was rarely mentioned');
  });

  it('strips a citation the model invented and counts it', () => {
    const { result, hallucinated } = postProcessDraft(
      'A claim {{cite:S9#c9}}. Another {{cite:S1#c1}}.',
      passages,
      500,
    );
    expect(hallucinated).toEqual(['S9#c9']);
    expect(result.citations.map((c) => c.key)).toEqual(['S1#c1']);
    expect(result.markdown).not.toContain('S9#c9');
  });

  it('marks a draft SHORT below 60% of target', () => {
    const short = postProcessDraft(
      'Ten words here only, nothing more to say at all.',
      passages,
      500,
    );
    expect(short.short).toBe(true);
    const full = postProcessDraft(`${'word '.repeat(400)}`, passages, 500);
    expect(full.short).toBe(false);
  });

  it('records a passage cited more than three times without rewriting the draft', () => {
    const markdown = `${'A claim {{cite:S1#c1}}. '.repeat(4)}`;
    const { overused } = postProcessDraft(markdown, passages, 500);
    // A.2 sets the limit; silently deleting the fourth citation would leave a claim uncited,
    // which is worse than an over-cited one.
    expect(overused).toEqual(['S1#c1']);
  });

  it('counts words of prose, not markers or headings', () => {
    expect(countDraftWords('### Cost barriers\n\nOne two three {{cite:S1#c1}}.')).toBe(5);
    expect(countDraftWords('[[NEEDS SOURCE: nothing]]')).toBe(0);
  });

  it('produces a §10.7.3 DraftResult', () => {
    const { result } = postProcessDraft('A claim {{cite:S1#c1}}.', passages, 500);
    expect(draftResultSchema.safeParse(result).success).toBe(true);
  });
});

describe('draftToProseMirror (A.2: DRAFT provenance)', () => {
  const resolve = (key: string) =>
    key === 'S1#c1' ? { sourceId: 'src-1', chunkId: 'chunk-1' } : null;

  it('turns "###" into a level-3 heading and blank lines into paragraphs', () => {
    const nodes = draftToProseMirror('### Cost barriers\n\nCost dominated.', 'draft-1', resolve);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
    expect(nodes[1]).toMatchObject({ type: 'paragraph' });
  });

  it('marks every run of text with DRAFT provenance and the draft id', () => {
    const nodes = draftToProseMirror('Cost dominated.', 'draft-1', resolve);
    const text = (nodes[0] as { content: Array<{ marks: Array<{ attrs: unknown }> }> }).content[0];
    expect(text?.marks?.[0]?.attrs).toEqual({ kind: 'DRAFT', actionId: 'draft-1' });
  });

  it('turns a resolvable citation into a node carrying the real ids', () => {
    const nodes = draftToProseMirror('Cost dominated {{cite:S1#c1}}.', 'draft-1', resolve);
    const content = (nodes[0] as { content: Array<Record<string, unknown>> }).content;
    const citation = content.find((node) => node.type === 'citation');
    // ADR-0045: a fresh node key, never the request-local passage id.
    expect(citation?.attrs).toMatchObject({ sourceId: 'src-1', chunkId: 'chunk-1' });
    expect(String((citation?.attrs as { key?: string } | undefined)?.key)).toMatch(/^c_/);
  });

  it('reports each node key against the prompt key it came from, uniquely', () => {
    const seen: Array<[string, string]> = [];
    const nodes = draftToProseMirror(
      'One {{cite:S1#c1}}.\n\nTwo {{cite:S1#c1}}.',
      'draft-1',
      resolve,
      (nodeKey, promptKey) => seen.push([nodeKey, promptKey]),
    );
    expect(nodes).toHaveLength(2);
    expect(seen.map(([, p]) => p)).toEqual(['S1#c1', 'S1#c1']);
    expect(seen[0]?.[0]).not.toBe(seen[1]?.[0]);
  });

  it('turns an inline equation into a mathInline node and a display one into a mathBlock', () => {
    const nodes = draftToProseMirror(
      'Stress follows $\\sigma = E\\varepsilon$ here.\n\n$$\\dot{m} = \\rho A v$$\n\nThe fee was $5 and $10.',
      'draft-1',
      resolve,
    );
    expect(nodes.map((n) => n.type)).toEqual(['paragraph', 'mathBlock', 'paragraph']);
    const first = (nodes[0] as { content: Array<Record<string, unknown>> }).content;
    expect(first.map((n) => n.type)).toEqual(['text', 'mathInline', 'text']);
    expect(first[1]?.attrs).toEqual({ latex: '\\sigma = E\\varepsilon' });
    expect(nodes[1]?.attrs).toEqual({ latex: '\\dot{m} = \\rho A v' });
    const third = (nodes[2] as { content: Array<{ text: string }> }).content;
    expect(third).toHaveLength(1);
    expect(third[0]?.text).toBe('The fee was $5 and $10.');
  });

  it('drops a citation that resolves to nothing rather than leaving a marker in the prose', () => {
    const nodes = draftToProseMirror('A claim {{cite:S9#c9}}.', 'draft-1', resolve);
    const json = JSON.stringify(nodes);
    expect(json).not.toContain('S9#c9');
    expect(json).not.toContain('{{cite');
  });

  it('ignores blank blocks', () => {
    expect(draftToProseMirror('\n\n\n', 'draft-1', resolve)).toEqual([]);
  });
});

describe('DRAFT constants match A.2', () => {
  it('pins the numbers the prompt and the post-processing share', () => {
    expect(DRAFT.maxTokens).toBe(1_200);
    expect(DRAFT.topK).toBe(12);
    expect(DRAFT.shortRatio).toBe(0.6);
    expect(DRAFT.maxUsesPerPassage).toBe(3);
  });
});
