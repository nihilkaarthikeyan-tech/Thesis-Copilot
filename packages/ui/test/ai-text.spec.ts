import { describe, expect, it } from 'vitest';
import { aiTextToNodes, citationsInRange, tokenizeAiText } from '../src/editor/ai-text.js';
import { createTestEditor } from './helpers.js';

describe('tokenizeAiText (ADR-0045)', () => {
  it('finds citation markers, inline and display maths, and leaves money alone', () => {
    const tokens = tokenizeAiText(
      'Stress $\\sigma = E\\varepsilon$ rises {{cite:S1#c1}}; the fee was $5 and $10. $$a^2+b^2=c^2$$ Then \\(x_1\\).',
    );
    expect(tokens).toEqual([
      { type: 'text', text: 'Stress ' },
      { type: 'math', latex: '\\sigma = E\\varepsilon', display: false },
      { type: 'text', text: ' rises ' },
      { type: 'cite', key: 'S1#c1' },
      { type: 'text', text: '; the fee was $5 and $10. ' },
      { type: 'math', latex: 'a^2+b^2=c^2', display: true },
      { type: 'text', text: ' Then ' },
      { type: 'math', latex: 'x_1', display: false },
      { type: 'text', text: '.' },
    ]);
  });

  it('does not treat a lone dollar sign or an escaped one as maths', () => {
    expect(tokenizeAiText('costs $ and \\$x\\$ here')).toEqual([
      { type: 'text', text: 'costs $ and \\$x\\$ here' },
    ]);
  });
});

describe('aiTextToNodes', () => {
  it('gives every resolved citation a fresh key and reports the label; keeps existing ones', () => {
    const editor = createTestEditor('<p>x</p>');
    const seeded: Array<[string, string | null, string]> = [];
    const nodes = aiTextToNodes(
      editor.schema,
      'A {{cite:S1#c1}} and $E=mc^2$ and {{cite:c_keep}} and {{cite:S9#c9}}.',
      {
        provenance: { kind: 'ASSIST', actionId: 'sug-1' },
        citations: [
          { key: 'S1#c1', sourceId: 'src-1', chunkId: 'ch-1', rendered: '(Kumar, 2021)' },
        ],
        existing: new Map([
          ['c_keep', { sourceId: 'src-k', chunkId: null, role: 'narrative', locator: '12' }],
        ]),
        onCitation: (key, rendered, prompt) => seeded.push([key, rendered, prompt]),
      },
    );
    const types = nodes.map((n) => n.type.name);
    expect(types).toEqual(['text', 'citation', 'text', 'mathInline', 'text', 'citation', 'text']);
    const fresh = nodes[1];
    expect(String(fresh?.attrs.key)).toMatch(/^c_/);
    expect(fresh?.attrs.sourceId).toBe('src-1');
    expect(nodes[3]?.attrs.latex).toBe('E=mc^2');
    expect(nodes[5]?.attrs).toMatchObject({
      key: 'c_keep',
      sourceId: 'src-k',
      role: 'narrative',
      locator: '12',
    });
    expect(seeded).toEqual([[String(fresh?.attrs.key), '(Kumar, 2021)', 'S1#c1']]);
    // S9#c9 was neither resolved nor in the document: dropped (§10.6).
    expect(nodes.filter((n) => n.type.name === 'citation')).toHaveLength(2);
    expect(nodes[0]?.marks[0]?.attrs).toMatchObject({ kind: 'ASSIST', actionId: 'sug-1' });
    editor.destroy();
  });

  it('a citation of a paper just added, with no chunk yet, goes in as a library citation (ADR-0133)', () => {
    const editor = createTestEditor('<p>x</p>');
    const nodes = aiTextToNodes(editor.schema, 'Credit raised adoption {{cite:S1#c1}}.', {
      provenance: { kind: 'COMMAND', actionId: null },
      citations: [
        { key: 'S1#c1', sourceId: 'new-src', chunkId: null, rendered: '(Credit access 2022)' },
      ],
    });
    const cite = nodes.find((n) => n.type.name === 'citation');
    expect(cite?.attrs).toMatchObject({ sourceId: 'new-src', chunkId: null });
    expect(String(cite?.attrs.key)).toMatch(/^c_/);
    editor.destroy();
  });

  it('citationsInRange collects the nodes a rewrite must keep', () => {
    const editor = createTestEditor('<p>x</p>');
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'One ' },
            {
              type: 'citation',
              attrs: { key: 'c_1', sourceId: 's1', chunkId: null, locator: '4' },
            },
            { type: 'text', text: ' two.' },
          ],
        },
      ],
    });
    const found = citationsInRange(editor.state.doc, 0, editor.state.doc.content.size);
    expect(found.get('c_1')).toMatchObject({ sourceId: 's1', locator: '4' });
    editor.destroy();
  });
});

describe('text views of equations and citations', () => {
  it('textBetween shows a citation and an equation as the model is told to write them', () => {
    const editor = createTestEditor('<p>x</p>');
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Let ' },
            { type: 'mathInline', attrs: { latex: 'x^2' } },
            { type: 'text', text: ' hold ' },
            { type: 'citation', attrs: { key: 'c_1', sourceId: 's1', chunkId: null } },
            { type: 'text', text: '.' },
          ],
        },
      ],
    });
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ');
    expect(text).toBe('Let $x^2$ hold {{cite:c_1}}.');
    editor.destroy();
  });

  it('dedupeCitationKeys re-keys every twin after the first', () => {
    const editor = createTestEditor('<p>x</p>');
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'citation', attrs: { key: 'S1#c1', sourceId: 's1', chunkId: null } },
            { type: 'text', text: ' and ' },
            { type: 'citation', attrs: { key: 'S1#c1', sourceId: 's2', chunkId: null } },
          ],
        },
      ],
    });
    expect(editor.commands.dedupeCitationKeys()).toBe(true);
    const keys: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'citation') keys.push(String(n.attrs.key));
      return true;
    });
    expect(keys[0]).toBe('S1#c1');
    expect(keys[1]).toMatch(/^c_/);
    expect(editor.commands.dedupeCitationKeys()).toBe(false);
    editor.destroy();
  });
});
