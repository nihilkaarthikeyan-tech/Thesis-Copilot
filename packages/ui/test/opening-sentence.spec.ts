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
  midSentencePoint,
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

  it('not at the short pause mid-sentence (each one would spend a unit)', () => {
    expect(typed('. Uptake is low among').calls).toHaveLength(0);
  });
});

describe('Jenni build plan R1: a half-written sentence is finished after a longer pause', () => {
  const setupMid = (html = '<p>Start</p>') => {
    vi.useFakeTimers();
    const fake = fakeRequest({ events: [] });
    const editor = createTestEditor(html, {
      request: fake.request,
      autoSuggest: true,
      autoSuggestIdleMs: 50,
      autoSuggestMidSentenceIdleMs: 200,
    });
    editor.commands.focus();
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    moveTo(editor, endOf(editor));
    const type = (text: string, wait = 210) => {
      editor.commands.insertContent(text);
      vi.advanceTimersByTime(wait);
    };
    return { editor, fake, type };
  };

  it('asks after the longer pause, between words, once the sentence has four words', () => {
    const { fake, type } = setupMid();
    type('. Urban heat islands raise night temperatures because ', 60);
    expect(fake.calls).toHaveLength(0); // the 800 ms rule's pause is not enough
    vi.advanceTimersByTime(200);
    expect(fake.calls).toHaveLength(1);
  });

  it('after a comma, a semicolon or a dash too', () => {
    for (const ending of [',', ';', ' —']) {
      const { fake, type } = setupMid();
      type(`. Urban heat islands raise night temperatures${ending}`);
      expect(fake.calls).toHaveLength(1);
    }
  });

  it('not inside a word, not with fewer than four words, not after a citation', () => {
    const { fake, type } = setupMid();
    type('. Urban heat islands raise night temperat');
    expect(fake.calls).toHaveLength(0);
    const short = setupMid();
    short.type('. Urban heat islands ');
    expect(short.fake.calls).toHaveLength(0);
    const cited = setupMid(
      '<p>Start. Urban heat islands raise night temperatures <span data-citation="" data-key="c_1" data-source-id="s1"></span></p>',
    );
    cited.type(' ');
    expect(cited.fake.calls).toHaveLength(0);
  });

  it('not with text after the cursor in the paragraph', () => {
    const { editor, fake } = setupMid(
      '<p>Urban heat islands raise night temperatures because the rest.</p>',
    );
    moveTo(editor, 1 + 'Urban heat islands raise night temperatures because '.length);
    editor.commands.insertContent(' ');
    vi.advanceTimersByTime(210);
    expect(fake.calls).toHaveLength(0);
  });

  it('once per sentence, again only after six more words', () => {
    const { fake, type } = setupMid();
    type('. Urban heat islands raise night temperatures because ');
    expect(fake.calls).toHaveLength(1);
    type('dense ');
    expect(fake.calls).toHaveLength(1);
    type('concrete stores heat and releases it ');
    expect(fake.calls).toHaveLength(2);
  });

  it('not when automatic suggestions are off', () => {
    vi.useFakeTimers();
    const fake = fakeRequest({ events: [] });
    const editor = createTestEditor('<p>Start</p>', {
      request: fake.request,
      autoSuggest: false,
      autoSuggestMidSentenceIdleMs: 200,
    });
    editor.commands.focus();
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    moveTo(editor, endOf(editor));
    editor.commands.insertContent('. Urban heat islands raise night temperatures because ');
    vi.advanceTimersByTime(300);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('midSentencePoint', () => {
  it('keys the sentence being written and counts its words', () => {
    const editor = createTestEditor('<p>One two. Three four five six</p>');
    moveTo(editor, endOf(editor));
    editor.commands.insertContent(' ');
    const point = midSentencePoint(editor.state);
    expect(point?.words).toBe(4);
    expect(point?.key).toMatch(/:\d+$/);
  });

  it('is nothing at a sentence end or in a heading', () => {
    const ended = createTestEditor('<p>One two three four five. </p>');
    moveTo(ended, endOf(ended));
    expect(midSentencePoint(ended.state)).toBeNull();
    const heading = createTestEditor('<h2>One two three four five </h2>');
    moveTo(heading, endOf(heading));
    expect(midSentencePoint(heading.state)).toBeNull();
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
