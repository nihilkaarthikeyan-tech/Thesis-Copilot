import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackedChangeRange, trackedChangesKey, wordsAt } from '../src/editor/tracked-changes.js';
import { createTestEditor } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

/** Where `text` starts in the document (first occurrence in a text node). */
function at(text: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    const i = (node.text ?? '').indexOf(text);
    if (i >= 0) found = { from: pos + i, to: pos + i + text.length };
    return false;
  });
  if (!found) throw new Error(`no "${text}"`);
  return found;
}

const state = () => trackedChangesKey.getState(editor.state);

describe('tracked changes in the text (Jenni build plan R23)', () => {
  it('draws a change as struck words with the new ones beside them, and a note as a highlight', () => {
    editor = createTestEditor('<p>The resuts were recieved in May.</p><p>Costs fell sharply.</p>');
    editor.commands.setTrackedChanges(
      [
        { id: 'a', ...at('resuts'), original: 'resuts', replacement: 'results' },
        { id: 'b', ...at('Costs fell sharply'), original: 'Costs fell sharply', replacement: null },
      ],
      'a',
    );
    const html = editor.view.dom.innerHTML;
    expect(html).toContain('tc-change-del is-active');
    expect(html).toContain('>results</span>');
    expect(html).toContain('tc-change-note');
    // Drawn, not written: the document still says what the student wrote.
    expect(editor.state.doc.textContent).toBe(
      'The resuts were recieved in May.Costs fell sharply.',
    );
  });

  it('follows its words through an edit before them', () => {
    editor = createTestEditor('<p>The resuts were recieved in May.</p>');
    const span = at('recieved');
    editor.commands.setTrackedChanges([
      { id: 'a', ...span, original: 'recieved', replacement: 'received' },
    ]);
    editor.commands.insertContentAt(1, 'All ');
    const moved = trackedChangeRange(editor.state, 'a');
    expect(moved).toMatchObject({ from: span.from + 4, to: span.to + 4, gone: false });
    expect(wordsAt(editor.state.doc, moved?.from ?? 0, moved?.to ?? 0)).toBe('recieved');
  });

  it('marks a change gone when its words are edited or deleted, and stops drawing it', () => {
    editor = createTestEditor('<p>The resuts were recieved in May.</p>');
    const span = at('recieved');
    editor.commands.setTrackedChanges([
      { id: 'a', ...span, original: 'recieved', replacement: 'received' },
    ]);
    editor.commands.insertContentAt(span.from + 2, 'x');
    expect(trackedChangeRange(editor.state, 'a')?.gone).toBe(true);
    expect(editor.view.dom.innerHTML).not.toContain('tc-change-del');
  });

  it('is gone from the start when the words are not where the check said', () => {
    editor = createTestEditor('<p>The resuts were recieved in May.</p>');
    editor.commands.setTrackedChanges([
      { id: 'a', ...at('resuts'), original: 'something else', replacement: 'x' },
    ]);
    expect(trackedChangeRange(editor.state, 'a')?.gone).toBe(true);
  });

  it('removes one, moves the active one, and clears', () => {
    editor = createTestEditor('<p>The resuts were recieved in May.</p>');
    editor.commands.setTrackedChanges([
      { id: 'a', ...at('resuts'), original: 'resuts', replacement: 'results' },
      { id: 'b', ...at('recieved'), original: 'recieved', replacement: 'received' },
    ]);
    editor.commands.setActiveTrackedChange('b');
    expect(state()?.activeId).toBe('b');
    editor.commands.removeTrackedChange('b');
    expect(state()).toMatchObject({ activeId: null });
    expect(state()?.changes.map((c) => c.id)).toEqual(['a']);
    editor.commands.clearTrackedChanges();
    expect(state()?.changes).toEqual([]);
  });

  it('names the change a click lands on', () => {
    editor = createTestEditor('<p>The resuts were recieved in May.</p>');
    const onPick = vi.fn();
    editor.storage.trackedChanges.onPick = onPick;
    editor.commands.setTrackedChanges([
      { id: 'a', ...at('resuts'), original: 'resuts', replacement: 'results' },
    ]);
    // jsdom has no layout; ProseMirror's own mousedown handler asks it for one after ours.
    const doc = document as Document & { elementFromPoint?: unknown };
    doc.elementFromPoint ??= () => null;
    const struck = editor.view.dom.querySelector('[data-change-id="a"]');
    struck?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('a');
  });
});
