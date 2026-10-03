import { describe, expect, it } from 'vitest';
import { makeRepairText, repairTruncatedJson } from '../src/providers/json-repair.js';

const parse = (s: string | null) => (s === null ? null : JSON.parse(s));

describe('repairTruncatedJson (ADR-0048)', () => {
  it('keeps every finished array element and drops the one cut mid-string', () => {
    const cut = '{"themes":[{"name":"Solar dryers","candidateIds":["c1","c2"]},{"name":"Cost barr';
    expect(parse(repairTruncatedJson(cut))).toEqual({
      themes: [{ name: 'Solar dryers', candidateIds: ['c1', 'c2'] }],
    });
  });

  it('never closes an open string into a value the model did not finish', () => {
    const cut = '{"text":"The results show that';
    expect(repairTruncatedJson(cut)).toBeNull();
  });

  it('drops a key whose value never arrived', () => {
    const cut = '{"a":1,"b":';
    expect(parse(repairTruncatedJson(cut))).toEqual({ a: 1 });
  });

  it('cuts inside a nested array back to the last complete number', () => {
    const cut = '{"rows":[[1,2],[3,4],[5,';
    expect(parse(repairTruncatedJson(cut))).toEqual({ rows: [[1, 2], [3, 4], [5]] });
  });

  it('handles escaped quotes and brackets inside strings', () => {
    const cut = '{"items":[{"q":"a \\"quoted\\" [bracket]"},{"q":"b';
    expect(parse(repairTruncatedJson(cut))).toEqual({ items: [{ q: 'a "quoted" [bracket]' }] });
  });

  it('strips a Markdown fence or a sentence before the JSON', () => {
    expect(parse(repairTruncatedJson('Here it is:\n```json\n{"a":[1,2]}\n```'))).toEqual({
      a: [1, 2],
    });
  });

  it('returns null for text that is already valid and for text with no JSON', () => {
    expect(repairTruncatedJson('{"a":1}')).toBeNull();
    expect(repairTruncatedJson('no json here')).toBeNull();
  });
});

describe('makeRepairText', () => {
  it('repairs only a parse failure, never a schema failure', async () => {
    const seen: number[] = [];
    const repair = makeRepairText((before) => seen.push(before));
    expect(await repair({ text: '{"a":[1,2,', error: { name: 'AI_JSONParseError' } })).toBe(
      '{"a":[1,2]}',
    );
    expect(seen).toEqual([10]);
    expect(await repair({ text: '{"a":1}', error: { name: 'AI_TypeValidationError' } })).toBeNull();
  });
});
