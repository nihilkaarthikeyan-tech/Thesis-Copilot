/** Tone review — ADR-0084: the request, the sample, the rules in code, the mock. */

import { describe, expect, it } from 'vitest';
import {
  buildToneRequest,
  mockToneResponse,
  paperSample,
  postProcessTone,
  renderStyleSample,
  TONE,
  toneSchema,
} from '../src/builder/tone.js';
import { loadPrompt } from '../src/prompts.js';

const batch = [
  { id: 's1', text: 'A lot of households never install rooftop solar {{cite:S1#c1}}.' },
  { id: 's2', text: 'Upfront cost was named first by 73% of respondents {{cite:S1#c2}}.' },
  { id: 's3', text: 'This is really a very big problem for the state.' },
];

describe('buildToneRequest', () => {
  it('is a fast-tier COMMAND call carrying the sample, the language and one line per sentence', () => {
    const req = buildToneRequest({
      sentences: batch,
      sample: 'Register: formal. Voice: passive.',
      language: 'en',
      userId: 'u',
      documentId: 'd',
    });
    expect(req.action).toBe('COMMAND');
    expect(req.tier).toBe('fast');
    expect(req.system.cached).toContain(loadPrompt('tone').system);
    const user = req.messages[0]?.content ?? '';
    expect(user).toMatch(/^<tone>\n<language>en<\/language>\n<sample>\nRegister: formal/);
    expect(user).toContain('- s2 | Upfront cost was named first');
    expect(user.trim().endsWith('</tone>')).toBe(true);
  });
});

describe('the sample', () => {
  it('renders a writing profile as a description', () => {
    const text = renderStyleSample(
      {
        avgSentenceLen: 22.4,
        register: 'formal',
        voice: 'passive',
        transitions: ['however', 'in contrast'],
        voiceNote: 'Opens paragraphs with the claim.',
        hedging: 'medium',
      },
      'Keep it plain.',
    );
    expect(text).toContain('Register: formal. Voice: passive. Hedging: medium.');
    expect(text).toContain('about 22 words');
    expect(text).toContain('Transitions used: however, in contrast.');
    expect(text).toContain('How they write: Opens paragraphs with the claim.');
    expect(text).toContain('Their own guidance: Keep it plain.');
  });

  it("takes a paper's first passages up to the word budget, cut at a sentence", () => {
    const chunk = Array.from(
      { length: 50 },
      (_, i) => `Sentence number ${i} of the paper is here.`,
    ).join(' ');
    const sample = paperSample([chunk, chunk, chunk], 120);
    expect(sample.split(/\s+/).length).toBeLessThanOrEqual(120);
    expect(sample.endsWith('.')).toBe(true);
    expect(paperSample(['Short.'], 600)).toBe('Short.');
  });
});

describe('postProcessTone', () => {
  it('keeps a rewrite that is a different sentence with the same citations; one per sentence', () => {
    const out = postProcessTone(
      {
        items: [
          {
            sentenceId: 's1',
            why: 'Conversational',
            rewrite: 'Many households never install rooftop solar {{cite:S1#c1}}.',
          },
          {
            sentenceId: 's1',
            why: 'Again',
            rewrite: 'Most households never install rooftop solar {{cite:S1#c1}}.',
          },
          {
            sentenceId: 's2',
            why: 'Same',
            rewrite: 'Upfront cost was named first by 73% of respondents {{cite:S1#c2}}.',
          },
          { sentenceId: 'nope', why: 'Unknown', rewrite: 'x y z' },
        ],
      },
      batch,
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      sentenceId: 's1',
      kind: 'tone',
      original: batch[0]?.text,
      replacement: 'Many households never install rooftop solar {{cite:S1#c1}}.',
      why: 'Conversational',
    });
    expect(out.refused).toBe(0);
  });

  it('refuses a rewrite that drops or adds a citation, or is not that sentence any more', () => {
    const out = postProcessTone(
      {
        items: [
          {
            sentenceId: 's1',
            why: 'Dropped',
            rewrite: 'Many households never install rooftop solar.',
          },
          {
            sentenceId: 's2',
            why: 'Added',
            rewrite: 'Upfront cost came first {{cite:S1#c2}} {{cite:S1#c9}}.',
          },
          {
            sentenceId: 's3',
            why: 'Too long',
            rewrite: `${'This is a problem for the state. '.repeat(6)}`,
          },
        ],
      },
      batch,
    );
    expect(out.items).toHaveLength(0);
    expect(out.refused).toBe(3);
  });
});

describe('the mock', () => {
  it('rewrites the conversational sentences and leaves the rest', () => {
    const req = buildToneRequest({
      sentences: batch,
      sample: 'formal',
      userId: 'u',
      documentId: 'd',
    });
    expect(mockToneResponse.match(req)).toBe(true);
    const result = toneSchema.parse(mockToneResponse.respond(req));
    expect(result.items.map((i) => i.sentenceId)).toEqual(['s1', 's3']);
    expect(result.items[0]?.rewrite).toBe(
      'many households never install rooftop solar {{cite:S1#c1}}.',
    );
    expect(result.items[1]?.rewrite).toBe('This is a big problem for the state.');
    expect(TONE.batch).toBeLessThanOrEqual(40);
  });
});
