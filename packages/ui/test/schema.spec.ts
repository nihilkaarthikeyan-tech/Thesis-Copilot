/**
 * PHASES 1.1 — schema and base editor. A fixture containing every node and mark type in Appendix
 * B.2 must round-trip through `getJSON()` unchanged, and level-1 headings must not be user-insertable.
 */

import type { Editor, JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor, pressKey } from './helpers.js';

const prov = (kind: string, actionId: string | null = null) => ({
  type: 'provenance',
  attrs: { kind, actionId },
});

const FIXTURE: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter 2' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Background' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Prior work' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Plain ', marks: [prov('HUMAN')] },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }, prov('HUMAN')] },
        { type: 'text', text: ' italic', marks: [{ type: 'italic' }, prov('HUMAN')] },
        { type: 'text', text: ' under', marks: [{ type: 'underline' }, prov('HUMAN')] },
        { type: 'text', text: ' strike', marks: [{ type: 'strike' }, prov('HUMAN')] },
        { type: 'text', text: ' sup', marks: [{ type: 'superscript' }, prov('HUMAN')] },
        { type: 'text', text: ' sub', marks: [{ type: 'subscript' }, prov('HUMAN')] },
        {
          type: 'text',
          text: ' link',
          marks: [
            {
              type: 'link',
              attrs: {
                href: 'https://example.org',
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
                class: null,
              },
            },
            prov('HUMAN'),
          ],
        },
        { type: 'text', text: ' assisted', marks: [prov('ASSIST', 's-1')] },
        {
          type: 'citation',
          attrs: {
            key: 'c_1',
            sourceId: 'src-1',
            chunkId: 'chunk-1',
            role: 'parenthetical',
            locator: null,
            prefix: null,
            suffix: null,
          },
        },
        {
          type: 'text',
          text: ' commented',
          marks: [{ type: 'commentAnchor', attrs: { commentId: 'cm-1' } }, prov('HUMAN')],
        },
        { type: 'hardBreak' },
        { type: 'mathInline', attrs: { latex: 'E = mc^2' } },
      ],
    },
    { type: 'mathBlock', attrs: { latex: '\\int_0^1 x\\,dx' } },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'one', marks: [prov('HUMAN')] }] },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'first', marks: [prov('HUMAN')] }],
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'quoted', marks: [prov('HUMAN')] }] },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: null },
      content: [{ type: 'text', text: 'let x = 1;' }],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'H', marks: [prov('HUMAN')] }],
                },
              ],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'D', marks: [prov('HUMAN')] }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'image',
      attrs: {
        src: 'https://files.example/x.png',
        alt: 'fig',
        title: null,
        key: 'img/abc',
        caption: 'Figure 1',
      },
    },
    {
      type: 'draftBlock',
      attrs: { draftId: 'd-1', status: 'pending' },
      content: [
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Drafted', marks: [prov('DRAFT', 'd-1')] }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Draft text ', marks: [prov('DRAFT', 'd-1')] },
            { type: 'needsSourceNote', attrs: { text: 'cost data for 2022' } },
          ],
        },
      ],
    },
  ],
};

let editor: Editor;
afterEach(() => editor?.destroy());

describe('schema (Appendix B.2)', () => {
  it('round-trips a document containing every node and mark type', () => {
    editor = createTestEditor(FIXTURE);
    const once = editor.getJSON();
    editor.commands.setContent(once);
    expect(editor.getJSON()).toEqual(once);
    // And nothing was silently dropped on the way in.
    const types = new Set<string>();
    editor.state.doc.descendants((n) => {
      types.add(n.type.name);
    });
    for (const t of [
      'heading',
      'paragraph',
      'bulletList',
      'orderedList',
      'listItem',
      'table',
      'tableRow',
      'tableHeader',
      'tableCell',
      'image',
      'mathInline',
      'mathBlock',
      'codeBlock',
      'blockquote',
      'hardBreak',
      'citation',
      'draftBlock',
      'needsSourceNote',
    ]) {
      expect(types.has(t), t).toBe(true);
    }
    for (const m of [
      'bold',
      'italic',
      'underline',
      'strike',
      'link',
      'superscript',
      'subscript',
      'provenance',
      'commentAnchor',
    ]) {
      expect(editor.schema.marks[m], m).toBeDefined();
    }
  });

  it('level-1 heading is not user-insertable but stays available programmatically', () => {
    editor = createTestEditor('<p>title</p>');
    // Markdown-style input rule for "# " must not produce h1; "## " must produce h2.
    editor.commands.setTextSelection(1);
    editor.commands.insertContent('# ');
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');

    editor.commands.setContent('<p>x</p>');
    editor.commands.setTextSelection(1);
    pressKey(editor, '1', { ctrl: true, alt: true });
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    pressKey(editor, '2', { ctrl: true, alt: true });
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.state.doc.firstChild?.attrs.level).toBe(2);

    // The chapter title is set by code, not by the student.
    editor.commands.setNode('heading', { level: 1 });
    expect(editor.state.doc.firstChild?.attrs.level).toBe(1);
  });

  it('citation renders {{cite:KEY}} in HTML so copies carry their key', () => {
    editor = createTestEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'citation',
              attrs: {
                key: 'c_9',
                sourceId: 's',
                chunkId: null,
                role: 'parenthetical',
                locator: null,
                prefix: null,
                suffix: null,
              },
            },
          ],
        },
      ],
    });
    expect(editor.getHTML()).toContain('data-key="c_9"');
    expect(editor.getHTML()).toContain('{{cite:c_9}}');
  });
});
