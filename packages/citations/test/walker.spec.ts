import { describe, expect, it } from 'vitest';
import { citationNodesIn, rekeyDuplicateCitations } from '../src/checks.js';

const chapter = {
  id: 'ch',
  title: 'One',
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Let ' },
          { type: 'mathInline', attrs: { latex: 'x' } },
          { type: 'hardBreak' },
          { type: 'text', text: ' be ' },
          {
            type: 'citation',
            attrs: { key: 'k1', sourceId: 's1', role: 'narrative', locator: '12' },
          },
          { type: 'text', text: '.' },
        ],
      },
      { type: 'paragraph' },
      {
        type: 'paragraph',
        content: [{ type: 'citation', attrs: { key: 'k1', sourceId: 's2' } }],
      },
    ],
  },
};

describe('citationNodesIn (ADR-0045)', () => {
  it('counts a leaf node as one position and carries the node attributes', () => {
    const found = citationNodesIn(chapter);
    // 0 open-para, "Let " 1-5, math 5-6, break 6-7, " be " 7-11, citation at 11.
    expect(found[0]).toMatchObject({
      nodeKey: 'k1',
      from: 11,
      to: 12,
      role: 'narrative',
      locator: '12',
    });
    // "." 12-13, close-para 13, empty paragraph 14-16, open-para 16, citation at 17.
    expect(found[1]).toMatchObject({ nodeKey: 'k1', sourceId: 's2', from: 17, to: 18 });
  });
});

describe('rekeyDuplicateCitations', () => {
  it('keeps the first key and gives each twin a fresh one without mutating the input', () => {
    let n = 0;
    const { content, changed } = rekeyDuplicateCitations(chapter.content, () => `c_${++n}`);
    expect(changed).toBe(true);
    const keys = citationNodesIn({ ...chapter, content }).map((c) => c.nodeKey);
    expect(keys).toEqual(['k1', 'c_1']);
    expect(citationNodesIn(chapter).map((c) => c.nodeKey)).toEqual(['k1', 'k1']);
    expect(rekeyDuplicateCitations(content, () => 'x').changed).toBe(false);
  });
});
