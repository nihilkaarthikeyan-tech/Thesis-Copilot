import { describe, expect, it } from 'vitest';
import {
  bareMath,
  buildEquationRequest,
  equationUserMessage,
  mockEquationFor,
  postProcessEquation,
} from '../src/builder/equation.js';
import { loadPrompt } from '../src/prompts.js';

describe('an equation described in words (ADR-0063)', () => {
  it('is metered as COMMAND on the strong tier, with the prompt marked as not from Appendix A', () => {
    const req = buildEquationRequest({ description: 'a over b', userId: 'u', documentId: 'd' });
    expect(req.action).toBe('COMMAND');
    expect(req.tier).toBe('strong');
    expect(loadPrompt('equation').raw).toContain('NOT FROM PRD APPENDIX A');
  });

  it('sends the description, and the current LaTeX when the student is changing it', () => {
    expect(equationUserMessage({ description: 'x < y', userId: 'u', documentId: 'd' })).toBe(
      '<description>x &lt; y</description>',
    );
    expect(
      equationUserMessage({ description: 'add one', current: 'x^2', userId: 'u', documentId: 'd' }),
    ).toContain('<current>x^2</current>');
  });

  it('strips the wrappers a model adds around math mode', () => {
    expect(bareMath('$x^2$')).toBe('x^2');
    expect(bareMath('$$x^2$$')).toBe('x^2');
    expect(bareMath('\\[ x^2 \\]')).toBe('x^2');
    expect(bareMath('\\begin{equation} x^2 \\end{equation}')).toBe('x^2');
  });

  it('offers only LaTeX that renders, and passes the reading through', () => {
    expect(postProcessEquation({ latex: '\\frac{a}{b}', reading: 'a over b' })).toEqual({
      ok: true,
      latex: '\\frac{a}{b}',
      reading: 'a over b',
    });
    const broken = postProcessEquation({ latex: '\\frac{a}{', reading: 'a over' });
    expect(broken.ok).toBe(false);
    const empty = postProcessEquation({ latex: '', reading: 'That is a sentence, not maths.' });
    expect(empty).toMatchObject({ ok: false, refusal: 'That is a sentence, not maths.' });
  });

  it('the mock reads a few spoken forms, so the path runs without a provider', () => {
    const ask = (d: string) =>
      mockEquationFor({ messages: [{ content: `<description>${d}</description>` }] });
    expect(ask('y equals x squared plus one').latex).toBe('y = x^{2} + one');
    expect(ask('alpha over n').latex).toBe('\\frac{\\alpha}{n}');
    expect(postProcessEquation(ask('alpha over n')).ok).toBe(true);
  });
});
