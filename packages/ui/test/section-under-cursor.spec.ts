/**
 * ADR-0071 — the section the cursor is in, for Draft mode.
 *
 * Production, 2026-10-05: a draft under a "Financial constraints" heading was written for
 * "Chapter 1", because Draft mode never read where the cursor was.
 */

import { describe, expect, it } from 'vitest';
import { sectionUnderCursor } from '../src/editor/text.js';
import { createTestEditor } from './helpers.js';

const endOf = (editor: ReturnType<typeof createTestEditor>) => editor.state.doc.content.size - 1;

describe('sectionUnderCursor', () => {
  it('finds the heading above the cursor and the text written under it', () => {
    const editor = createTestEditor(
      '<h1>Chapter 1</h1><p>Opening paragraph.</p><h2>Financial constraints</h2><p>Upfront cost is the first barrier.</p><p></p>',
    );
    const section = sectionUnderCursor(editor.state.doc, endOf(editor));
    expect(section.heading).toBe('Financial constraints');
    expect(section.context).toBe('Upfront cost is the first barrier.');
  });

  it('skips the chapter title, which is level 1', () => {
    const editor = createTestEditor('<h1>Chapter 1</h1><p>Opening paragraph.</p><p></p>');
    const section = sectionUnderCursor(editor.state.doc, endOf(editor));
    expect(section.heading).toBeUndefined();
    expect(section.context).toBe('Opening paragraph.');
  });

  it('reads a heading the markdown shortcut left as literal text', () => {
    const editor = createTestEditor('<p>Intro.</p><p>## Financial constraints</p><p></p>');
    expect(sectionUnderCursor(editor.state.doc, endOf(editor)).heading).toBe(
      'Financial constraints',
    );
  });

  it('uses the nearest heading when there are several', () => {
    const editor = createTestEditor(
      '<h2>Financial constraints</h2><p>a</p><h2>Technical limitations</h2><p>b</p>',
    );
    expect(sectionUnderCursor(editor.state.doc, endOf(editor)).heading).toBe(
      'Technical limitations',
    );
  });
});
