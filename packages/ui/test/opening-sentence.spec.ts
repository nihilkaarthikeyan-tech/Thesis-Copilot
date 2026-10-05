/**
 * ADR-0078 — an opening sentence for an empty section, offered without a keystroke.
 *
 * The side-by-side study found Jenni offers a first sentence under a heading before the student
 * types anything. The copying round (ADR-0075) found our prompt already writes one for an empty
 * section; the editor simply never asked. These pin when it asks: once per heading, only in an
 * empty paragraph straight under a heading, only when automatic suggestions are on.
 */

import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emptySectionUnderHeading,
  OPENER_RETRY_MS,
  setAutoSuggest,
} from '../src/editor/ghost-text.js';
import { createTestEditor, fakeRequest } from './helpers.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const moveTo = (editor: ReturnType<typeof createTestEditor>, pos: number) =>
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

const endOf = (editor: ReturnType<typeof createTestEditor>) => editor.state.doc.content.size - 1;

describe('emptySectionUnderHeading', () => {
  it('names the heading above an empty paragraph', () => {
    const editor = createTestEditor('<h2>Financial constraints</h2><p></p>');
    moveTo(editor, endOf(editor));
    expect(emptySectionUnderHeading(editor.state)).toContain('Financial constraints');
  });

  it('is nothing once the paragraph has text, or with no heading above it', () => {
    const typed = createTestEditor('<h2>Financial constraints</h2><p>Some text</p>');
    moveTo(typed, endOf(typed));
    expect(emptySectionUnderHeading(typed.state)).toBeNull();
    const plain = createTestEditor('<p>Intro.</p><p></p>');
    moveTo(plain, endOf(plain));
    expect(emptySectionUnderHeading(plain.state)).toBeNull();
  });
});

describe('the opening sentence is offered', () => {
  const setup = (autoSuggest: boolean) => {
    vi.useFakeTimers();
    const fake = fakeRequest({ events: [] });
    const editor = createTestEditor(
      '<h2>Financial constraints</h2><p></p><h2>Technical limitations</h2><p></p>',
      { request: fake.request, autoSuggest, autoSuggestIdleMs: 50 },
    );
    editor.commands.focus();
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    return { editor, fake };
  };

  it('once, when the cursor comes to rest under a heading', () => {
    const { editor, fake } = setup(true);
    const firstEmpty = 1 + editor.state.doc.child(0).nodeSize;
    moveTo(editor, firstEmpty);
    vi.advanceTimersByTime(60);
    expect(fake.calls).toHaveLength(1);

    // Away and back to the same section: not asked again.
    moveTo(editor, 1);
    moveTo(editor, firstEmpty);
    vi.advanceTimersByTime(60);
    expect(fake.calls).toHaveLength(1);
  });

  it('not at all when automatic suggestions are off', () => {
    const { editor, fake } = setup(false);
    moveTo(editor, 1 + editor.state.doc.child(0).nodeSize);
    vi.advanceTimersByTime(60);
    expect(fake.calls).toHaveLength(0);
  });

  it('when the setting is switched on after the editor is built, as the web app does', () => {
    const { editor, fake } = setup(false);
    setAutoSuggest(editor, true);
    moveTo(editor, 1 + editor.state.doc.child(0).nodeSize);
    vi.advanceTimersByTime(60);
    expect(fake.calls).toHaveLength(1);
  });
});

describe('while typing, an automatic suggestion is asked for', () => {
  const typed = (text: string) => {
    vi.useFakeTimers();
    const fake = fakeRequest({ events: [] });
    const editor = createTestEditor('<p>Start</p>', {
      request: fake.request,
      autoSuggest: true,
      autoSuggestIdleMs: 50,
    });
    editor.commands.focus();
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    moveTo(editor, endOf(editor));
    editor.commands.insertContent(text);
    vi.advanceTimersByTime(60);
    return fake;
  };

  it('after a finished sentence', () => {
    expect(typed('. Uptake is low.').calls).toHaveLength(1);
    expect(typed('. Uptake is low. ').calls).toHaveLength(1);
  });

  it('not at a pause mid-sentence (each one would spend a unit)', () => {
    expect(typed('. Uptake is low among').calls).toHaveLength(0);
  });
});

describe('the opening sentence, when nothing comes back', () => {
  const setupWith = (events: Parameters<typeof fakeRequest>[0]['events']) => {
    vi.useFakeTimers();
    const fake = fakeRequest({ events });
    const editor = createTestEditor('<h2>Financial constraints</h2><p></p>', {
      request: fake.request,
      autoSuggest: true,
      autoSuggestIdleMs: 50,
    });
    editor.commands.focus();
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    moveTo(editor, 1 + editor.state.doc.child(0).nodeSize);
    return { editor, fake };
  };

  it('asks once more (the server was still finishing the last one)', async () => {
    const { fake } = setupWith([
      {
        type: 'error',
        code: 'ASSIST_IN_FLIGHT',
        message: 'A suggestion is already in progress. Wait for it or press Esc.',
      },
    ]);
    await vi.advanceTimersByTimeAsync(60);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(OPENER_RETRY_MS);
    expect(fake.calls).toHaveLength(2);
    // And no more than once.
    await vi.advanceTimersByTimeAsync(OPENER_RETRY_MS * 3);
    expect(fake.calls).toHaveLength(2);
  });

  it('not when a suggestion is showing', async () => {
    const { fake } = setupWith([
      { type: 'start', suggestionId: 'sug-1' },
      { type: 'token', t: 'Upfront cost is the barrier households name first.' },
      { type: 'done', citations: [] },
    ]);
    await vi.advanceTimersByTimeAsync(60);
    await vi.advanceTimersByTimeAsync(OPENER_RETRY_MS);
    expect(fake.calls).toHaveLength(1);
  });
});
