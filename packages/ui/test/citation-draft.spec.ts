/**
 * PHASES 1.5 / 1.6 — citation NodeView (B.5) and draft block (B.6).
 * B.9 test 6: style switch re-renders labels without changing getJSON().
 * B.9 test 7: draft accept unwraps the block and keeps citations and marks.
 */

import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { pendingDraft } from '../src/editor/draft-block.js';
import { createTestEditor, fakeRequest, pressKey, provenanceRuns, tick } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const cite = (key: string, sourceId: string | null = 'src-1') => ({
  type: 'citation',
  attrs: {
    key,
    sourceId,
    chunkId: null,
    role: 'parenthetical',
    locator: null,
    prefix: null,
    suffix: null,
  },
});

describe('citation node (Appendix B.5)', () => {
  it('B.9 #6: switching APA → IEEE re-renders labels but leaves the document JSON untouched', () => {
    editor = createTestEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Claim ' },
            cite('c_a'),
            { type: 'text', text: ' and ' },
            cite('c_b'),
          ],
        },
      ],
    });
    const before = editor.getJSON();

    editor.commands.setCitationStyle('apa', { c_a: '(Kumar et al., 2021)', c_b: '(Rao, 2019)' });
    const labels = () =>
      Array.from(editor.view.dom.querySelectorAll('span.citation')).map((el) => el.textContent);
    expect(labels()).toEqual(['(Kumar et al., 2021)', '(Rao, 2019)']);

    editor.commands.setCitationStyle('ieee', { c_a: '[1]', c_b: '[2]' });
    expect(labels()).toEqual(['[1]', '[2]']);

    expect(editor.getJSON()).toEqual(before);
  });

  it('renders a removed source red-dashed and never deletes it', () => {
    editor = createTestEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [cite('c_x', 'src-gone')] }],
    });
    editor.commands.markSourceRemoved('src-gone');
    const el = editor.view.dom.querySelector('span.citation');
    expect(el?.classList.contains('citation--removed')).toBe(true);
    expect(el?.getAttribute('title')).toContain('Source removed');
    expect(editor.getJSON().content?.[0]?.content?.[0]?.type).toBe('citation');
  });

  it('insertCitation creates a node with a stable key and defaults', () => {
    editor = createTestEditor('<p>x</p>');
    editor.commands.setTextSelection(2);
    editor.commands.insertCitation({ sourceId: 'src-9', chunkId: 'ch-1' });
    const node = editor.getJSON().content?.[0]?.content?.find((n) => n.type === 'citation');
    expect(node?.attrs?.key).toMatch(/^c_/);
    expect(node?.attrs).toMatchObject({
      sourceId: 'src-9',
      chunkId: 'ch-1',
      role: 'parenthetical',
    });
  });
});

describe('draft block (Appendix B.6)', () => {
  const draftContent = () => {
    const schema = editor.schema;
    const draftMark = schema.marks.provenance?.create({ kind: 'DRAFT', actionId: 'd-1' });
    const marks = draftMark ? [draftMark] : [];
    const citation = schema.nodes.citation?.create({
      key: 'c_d',
      sourceId: 'src-1',
      chunkId: 'ch-2',
    });
    const note = schema.nodes.needsSourceNote?.create({ text: 'yield data for 2020' });
    const bold = schema.marks.bold?.create();
    if (!citation || !note) throw new Error('schema is missing citation or needsSourceNote');
    return [
      schema.nodes.heading?.create({ level: 3 }, schema.text('Drafted section', marks)),
      schema.nodes.paragraph?.create(null, [
        schema.text('Drafted claim ', marks),
        citation,
        schema.text(' with ', marks),
        schema.text('emphasis', bold ? [...marks, bold] : marks),
        schema.text('. ', marks),
        note,
      ]),
    ].filter((n): n is NonNullable<typeof n> => Boolean(n));
  };

  it('B.9 #7: accept unwraps the block and keeps citations and marks; notes become visible text', () => {
    const outcomes: Array<{ draftId: string; outcome: string }> = [];
    editor = createTestEditor('<p>Existing.</p>', {}, []);
    // Re-create with the draft outcome hook.
    editor.destroy();
    editor = createTestEditor('<p>Existing.</p>');
    (
      editor.extensionManager.extensions.find((e) => e.name === 'draftBlock') as {
        options: { onOutcome?: (e: { draftId: string; outcome: string }) => void };
      }
    ).options.onOutcome = (e) => outcomes.push(e);

    editor.commands.setTextSelection(3);
    expect(editor.commands.insertDraft('d-1', draftContent())).toBe(true);
    expect(pendingDraft(editor.state.doc)).not.toBeNull();
    expect(editor.view.dom.querySelector('[data-draft="true"]')).not.toBeNull();

    // A second pending draft is refused (one per chapter).
    expect(editor.commands.insertDraft('d-2', draftContent())).toBe(false);

    expect(editor.commands.acceptDraft('d-1')).toBe(true);

    const json = editor.getJSON();
    expect(JSON.stringify(json)).not.toContain('draftBlock');
    expect(JSON.stringify(json)).not.toContain('needsSourceNote');
    expect(editor.state.doc.textContent).toContain('[NEEDS SOURCE: yield data for 2020]');

    const runs = provenanceRuns(editor);
    expect(runs.some((r) => r.kind === 'DRAFT' && r.actionId === 'd-1')).toBe(true);
    expect(runs.find((r) => r.text.includes('NEEDS SOURCE'))?.kind).toBe('HUMAN');
    const paragraphs = json.content ?? [];
    const hasCitation = paragraphs.some((p) =>
      p.content?.some((n) => n.type === 'citation' && n.attrs?.key === 'c_d'),
    );
    expect(hasCitation).toBe(true);
    const boldKept = paragraphs.some((p) =>
      p.content?.some((n) => n.marks?.some((m) => m.type === 'bold')),
    );
    expect(boldKept).toBe(true);
    expect(outcomes).toEqual([{ draftId: 'd-1', outcome: 'ACCEPTED' }]);
  });

  it('discard removes the block entirely', () => {
    editor = createTestEditor('<p>Existing.</p>');
    editor.commands.setTextSelection(3);
    editor.commands.insertDraft('d-3', draftContent());
    expect(editor.commands.discardDraft('d-3')).toBe(true);
    expect(JSON.stringify(editor.getJSON())).not.toContain('Drafted');
    expect(editor.state.doc.textContent).toBe('Existing.');
  });

  it('editing inside a pending draft yields HUMAN_EDITED, and requests are refused there', () => {
    editor = createTestEditor('<p>Existing.</p>');
    editor.commands.setTextSelection(3);
    editor.commands.insertDraft('d-4', draftContent());
    const draft = pendingDraft(editor.state.doc);
    const inside = (draft?.pos ?? 0) + 1 + 1 + 3; // into the heading text
    editor.commands.setTextSelection(inside);
    editor.commands.insertContent('Z');
    expect(
      provenanceRuns(editor).some((r) => r.kind === 'HUMAN_EDITED' && r.actionId === 'd-1'),
    ).toBe(true);
    expect(editor.commands.requestSuggestion()).toBe(false);
  });
});

describe('citation passage popover and rendered labels (PHASES 3.5)', () => {
  const passage = {
    text: 'A 2021 survey of 312 rural households found upfront cost the main barrier.',
    page: 7,
    section: 'Findings',
    shortRef: 'Kumar 2021',
    pdfUrl: 'https://minio.example/signed.pdf',
  };

  it('shows the real passage on hover, with an open-at-page link, and never touches the doc', async () => {
    const calls: Array<[string, string | null]> = [];
    editor = createTestEditor(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Claim ' },
              {
                ...cite('c_p', 'src-4'),
                attrs: { ...cite('c_p', 'src-4').attrs, chunkId: 'chunk-2' },
              },
            ],
          },
        ],
      },
      {},
      [],
      {
        hoverDelayMs: 0,
        resolvePassage: async (sourceId, chunkId) => {
          calls.push([sourceId, chunkId]);
          return passage;
        },
      },
    );
    const before = editor.getJSON();
    const node = editor.view.dom.querySelector('span.citation') as HTMLElement;
    expect(node).toBeTruthy();
    expect(node.getAttribute('data-source-id')).toBe('src-4');
    expect(node.getAttribute('data-chunk-id')).toBe('chunk-2');

    node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await new Promise((r) => setTimeout(r, 5));
    await Promise.resolve();

    expect(calls).toEqual([['src-4', 'chunk-2']]);
    const popover = node.querySelector('.citation-popover') as HTMLElement;
    expect(popover).toBeTruthy();
    expect(popover.querySelector('.citation-popover__text')?.textContent).toBe(passage.text);
    expect(popover.querySelector('.citation-popover__ref')?.textContent).toBe(
      'Kumar 2021 · p. 7 · Findings',
    );
    const link = popover.querySelector('a.citation-popover__pdf') as HTMLAnchorElement;
    expect(link.textContent).toBe('Open PDF at page 7');
    expect(link.getAttribute('href')).toBe('https://minio.example/signed.pdf#page=7');
    expect(link.getAttribute('rel')).toContain('noopener');

    // B.2: the popover is UI, not document.
    expect(editor.getJSON()).toEqual(before);

    node.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    expect(node.querySelector('.citation-popover')).toBeNull();
  });

  it('does not fetch when the pointer leaves before the delay, or when there is no source', async () => {
    let fetched = 0;
    editor = createTestEditor(
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [cite('c_slow', 'src-1'), cite('c_gone', null)] }],
      },
      {},
      [],
      {
        hoverDelayMs: 50,
        resolvePassage: async () => {
          fetched++;
          return passage;
        },
      },
    );
    const [slow, gone] = Array.from(
      editor.view.dom.querySelectorAll('span.citation'),
    ) as HTMLElement[];

    slow?.dispatchEvent(new MouseEvent('mouseenter'));
    slow?.dispatchEvent(new MouseEvent('mouseleave'));
    await new Promise((r) => setTimeout(r, 80));
    expect(fetched).toBe(0);

    gone?.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise((r) => setTimeout(r, 80));
    expect(fetched).toBe(0);
  });

  it('carries the server-rendered label from done.citations onto the inserted node', async () => {
    const fake = fakeRequest({
      events: [
        { type: 'start', suggestionId: 'sug-90' },
        { type: 'token', t: 'Cost mattered most {{cite:S1#c1}}.' },
        {
          type: 'done',
          citations: [
            { key: 'S1#c1', sourceId: 'src-4', chunkId: 'chunk-2', rendered: '(Kumar 2021)' },
          ],
        },
      ],
    });
    editor = createTestEditor('<p>Intro. </p>', { request: fake.request });
    editor.commands.setTextSelection(8);
    editor.commands.requestSuggestion();
    await tick(40);
    expect(pressKey(editor, 'Tab')).toBe(true);

    const label = editor.view.dom.querySelector('span.citation')?.textContent;
    expect(label).toBe('(Kumar 2021)');
    const json = editor.getJSON();
    const node = json.content?.[0]?.content?.find((n) => n.type === 'citation');
    expect(node?.attrs).toMatchObject({ key: 'S1#c1', sourceId: 'src-4', chunkId: 'chunk-2' });
    // The label lives in storage, never in the document (B.5).
    expect(JSON.stringify(json)).not.toContain('Kumar 2021');
  });
});
