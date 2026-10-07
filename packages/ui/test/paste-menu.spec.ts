import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PasteInfo } from '../src/editor/paste-menu.js';
import { createTestEditor } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

/** What the paper reader's "Copy with citation" puts on the clipboard as HTML (R9). */
const READER_HTML =
  '<span>“Night-time temperatures stayed 3.1 °C above the rural reference” <span data-citation="" data-key="c_reader01" data-source-id="0190a8b2-0000-7000-8000-000000000001" data-chunk-id="" data-locator="7" data-label="(Raja et al., 2026, p. 7)">(Raja et al., 2026, p. 7)</span></span>';

function citations(): Array<{ key: string; sourceId: string; locator: string | null }> {
  const out: Array<{ key: string; sourceId: string; locator: string | null }> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'citation') {
      out.push({
        key: String(node.attrs.key),
        sourceId: String(node.attrs.sourceId),
        locator: (node.attrs.locator as string | null) ?? null,
      });
    }
  });
  return out;
}

const renderedMap = () =>
  (editor.storage.citation as { renderedMap: Record<string, string> }).renderedMap;

describe('paste with a choice (Jenni build plan R9)', () => {
  it('a passage copied from the reader arrives as text and a real citation, with its label', () => {
    editor = createTestEditor('<p>Before. </p>');
    const onPaste = vi.fn<(info: PasteInfo) => void>();
    (editor.storage.pasteMenu as { onPaste: unknown }).onPaste = onPaste;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.pasteHTML(READER_HTML);

    expect(citations()).toEqual([
      { key: 'c_reader01', sourceId: '0190a8b2-0000-7000-8000-000000000001', locator: '7' },
    ]);
    expect(renderedMap().c_reader01).toBe('(Raja et al., 2026, p. 7)');
    expect(onPaste).toHaveBeenCalledTimes(1);
    const info = onPaste.mock.calls[0]?.[0] as PasteInfo;
    expect(info.cited).toBe(true);
    expect(info.text).toContain('Night-time temperatures stayed');
    expect(editor.state.doc.textBetween(info.from, info.to)).toContain('3.1 °C');
  });

  it('pasted twice, the second citation gets a key of its own and keeps the label', () => {
    editor = createTestEditor('<p>Start </p>');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.pasteHTML(READER_HTML);
    editor.view.pasteHTML(READER_HTML);
    const keys = citations().map((c) => c.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(renderedMap()[keys[1] as string]).toBe('(Raja et al., 2026, p. 7)');
  });

  it('plain text of a few words or more is a paste without a citation', () => {
    editor = createTestEditor('<p></p>');
    const onPaste = vi.fn<(info: PasteInfo) => void>();
    (editor.storage.pasteMenu as { onPaste: unknown }).onPaste = onPaste;
    editor.view.pasteText('Rooftop solar adoption remains low in rural Karnataka.');
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onPaste.mock.calls[0]?.[0]?.cited).toBe(false);
  });

  it('a short paste is a fix, not a passage: no menu', () => {
    editor = createTestEditor('<p></p>');
    const onPaste = vi.fn();
    (editor.storage.pasteMenu as { onPaste: unknown }).onPaste = onPaste;
    editor.view.pasteText('three words only');
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('typing is not a paste', () => {
    editor = createTestEditor('<p></p>');
    const onPaste = vi.fn();
    (editor.storage.pasteMenu as { onPaste: unknown }).onPaste = onPaste;
    editor.commands.insertContent('Several words typed in, not pasted at all.');
    expect(onPaste).not.toHaveBeenCalled();
  });
});
