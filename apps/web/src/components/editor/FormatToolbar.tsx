'use client';

/**
 * The formatting toolbar — PRD §6.2.
 *
 * Added 2026-09-21 after an audit against a competitor found that the product had **no formatting
 * UI at all**. The schema had supported most of this since the editor was built, reachable only by
 * keyboard shortcut, and three things were not reachable at all: `insertTable` was never called
 * from anywhere, the KaTeX nodes had no trigger and no `$…$` input rule, and `uploadImage` always
 * returned `false` because the editor never passed it a handler. A thesis with no way to insert a
 * table or an equation is not a thesis tool, whatever the schema says.
 *
 * Two rules from §6.2 shape what this is *not*:
 *
 * - **Nothing competes with body text.** The bar is one row of quiet icons on the page's own
 *   surface, not a ribbon. No fonts, no sizes: a thesis is typeset by the template at export
 *   (`packages/export`), so letting someone pick 14pt Verdana here would be offering a choice the
 *   `.docx` is going to overrule anyway. Colour is the one exception (R28, ADR-0119): six text
 *   colours and four highlights, by name, because students mark words for themselves and their
 *   guide, and each prints in every export.
 * - **The writing column stays 72ch.** The bar aligns to it rather than to the window, so the
 *   controls sit over the text they act on.
 *
 * Headings start at level 2. H1 is reserved for the chapter title (`ThesisHeading`), which the
 * document owns and the student does not type.
 */

import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
  isHighlightColor,
  isTextColor,
  numberTargets,
  TEXT_COLORS,
  type TextColor,
} from '@tc/types';
import {
  insertLatexAt,
  latexError,
  MATH_EDIT_EVENT,
  type MathEditDetail,
  wordCountByProvenance,
} from '@tc/ui';
import type { Editor } from '@tiptap/react';
import {
  Baseline,
  Bold,
  Braces,
  Code,
  Highlighter,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Sigma,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MessageKey } from '@/i18n/en';
import { useT } from '@/i18n/react';
import { cn } from '@/lib/utils';
import { MathHelp } from './MathHelp';

/**
 * Re-renders the caller on any editor change.
 *
 * TipTap mutates the editor in place, so nothing that reads `isActive` or the document re-renders
 * on its own. Both pieces of chrome in this file need it: the toolbar so a button lights up when
 * the caret moves into bold text, the counter so it moves while typing.
 */
function useEditorTick(editor: Editor | null): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const rerender = () => force((n) => n + 1);
    editor.on('transaction', rerender);
    editor.on('selectionUpdate', rerender);
    return () => {
      editor.off('transaction', rerender);
      editor.off('selectionUpdate', rerender);
    };
  }, [editor]);
}

/**
 * A one-field ask, inline, where `window.prompt` would otherwise go.
 *
 * `GuidedInput` already established this pattern for the Shift+→ instruction, for the reason
 * written there: a native prompt steals focus from the document and blocks the whole page. The
 * first draft of this toolbar used `window.prompt` for links and equations anyway, which
 * contradicted a decision this codebase had already taken. This is the same idea, parameterised
 * by what is being asked for, and kept local because the shape it needs — a starting value, and a
 * caller that acts on the answer rather than awaiting a promise — differs from the guided one.
 */
type Ask = {
  label: string;
  hint: string;
  initial: string;
  onDone: (value: string | null) => void;
  /** Shown under the field while it is non-null; Apply waits until it is (ADR-0045). */
  validate?: (value: string) => string | null;
  /** An equation: examples, a live preview and the cheat sheet under the field (item 22). */
  math?: { display: boolean; describe?: DescribeEquation; photo?: ReadEquationPhoto };
};

/** ADR-0064: LaTeX read from a photo of the equation, for the student to check before Apply. */
export type ReadEquationPhoto = (
  image: Blob,
) => Promise<
  { ok: true; latex: string; reading: string } | { ok: false; refusal: string; reading: string }
>;

/** ADR-0063: LaTeX from a description in words, for the student to check before Apply. */
export type DescribeEquation = (
  description: string,
  current: string,
) => Promise<
  { ok: true; latex: string; reading: string } | { ok: false; refusal: string; reading: string }
>;

function useInlinePrompt() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ask) inputRef.current?.focus();
  }, [ask]);

  const open = useCallback((next: Omit<Ask, 'onDone'> & { onDone: Ask['onDone'] }) => {
    setValue(next.initial);
    setAsk(next);
  }, []);

  const close = useCallback(
    (result: string | null) => {
      if (result !== null && ask?.validate?.(result)) return; // the message under the field says why
      ask?.onDone(result);
      setAsk(null);
      setValue('');
    },
    [ask],
  );
  const problem = ask?.validate && value.trim() ? ask.validate(value.trim()) : null;

  /** Puts `snippet` at the field's caret (or over its selection) and keeps the caret after it. */
  const insert = useCallback(
    (snippet: string) => {
      const field = inputRef.current;
      const start = field?.selectionStart ?? value.length;
      const end = field?.selectionEnd ?? start;
      const next = insertLatexAt(value, snippet, start, end);
      setValue(next.value);
      requestAnimationFrame(() => {
        field?.focus();
        field?.setSelectionRange(next.caret, next.caret);
      });
    },
    [value],
  );

  const element = ask ? (
    // A plain div with an explicit Enter handler and a visible Apply button, rather than a
    // `<form>` whose only affordance was implicit submission. Both routes are exercised and both
    // work; the button exists because a control you can only operate by guessing at a keystroke
    // is a control most people will not operate.
    <div
      data-testid="inline-prompt"
      // Positioned against the toolbar, not the viewport. `fixed` was wrong twice over: the
      // toolbar sets `backdrop-blur`, which makes it a containing block for fixed descendants —
      // so the panel landed above the bar instead of where the class said — and anchoring to the
      // button that opened it is the behaviour actually wanted.
      className={cn(
        'absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2 rounded-md border border-line bg-surface p-3 shadow-lg',
        ask.math ? 'w-[min(36rem,calc(100vw-2rem))]' : 'w-[min(30rem,calc(100vw-2rem))]',
      )}
    >
      <label className="text-xs text-muted" htmlFor="inline-prompt-field">
        {ask.label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id="inline-prompt-field"
          ref={inputRef}
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-paper px-3 py-2 text-sm text-ink"
          placeholder={ask.hint}
          maxLength={500}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close(null);
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              close(value.trim());
            }
          }}
        />
        <button
          type="button"
          data-testid="inline-prompt-apply"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => close(value.trim())}
          className="shrink-0 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Apply
        </button>
      </div>
      {problem ? (
        <p className="mt-1 text-xs text-danger" role="alert">
          {ask.math
            ? `This cannot be drawn yet: ${problem}. Check that every { has its }.`
            : problem}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted">Enter to apply · Esc to cancel</p>
      )}
      {ask.math ? (
        <MathHelp
          value={value.trim()}
          problem={problem}
          display={ask.math.display}
          onInsert={insert}
          onReplace={(latex) => setValue(latex)}
          {...(ask.math.describe ? { describe: ask.math.describe } : {})}
          {...(ask.math.photo ? { photo: ask.math.photo } : {})}
        />
      ) : null}
    </div>
  ) : null;

  return { open, element };
}

/** One icon button. `active` is the mark/node state, `disabled` is "the command cannot run here". */
function Tool({
  label,
  active,
  disabled,
  onClick,
  children,
  testId,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      data-testid={testId}
      // `onMouseDown` prevented: a click on the toolbar must not take the selection out of the
      // document, or a mark button would have nothing to apply itself to.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        // h-7 with a 7-unit floor, not a fixed square: a worded tool ("Chart", "Diagram") ran into
        // its neighbour inside a 28 px box (2026-10-04).
        'inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1 transition-colors',
        'disabled:pointer-events-none disabled:opacity-35',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunk hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-line" />;
}

/** Paragraph / Heading 2 / Heading 3 / Quote, as one select rather than four buttons. */
function BlockStyle({ editor }: { editor: Editor }) {
  const { t } = useT();
  const value = editor.isActive('heading', { level: 2 })
    ? 'h2'
    : editor.isActive('heading', { level: 3 })
      ? 'h3'
      : editor.isActive('blockquote')
        ? 'quote'
        : 'p';

  return (
    <select
      aria-label={t('fmt.textStyle')}
      data-testid="block-style"
      value={value}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const chain = editor.chain().focus();
        switch (e.target.value) {
          case 'h2':
            chain.setHeading({ level: 2 }).run();
            break;
          case 'h3':
            chain.setHeading({ level: 3 }).run();
            break;
          case 'quote':
            chain.setParagraph().toggleBlockquote().run();
            break;
          default:
            chain.setParagraph().run();
        }
      }}
      className="h-7 shrink-0 rounded-md border border-line bg-surface px-1.5 text-[12px] text-ink transition-colors hover:bg-sunk"
    >
      <option value="p">{t('fmt.style.text')}</option>
      <option value="h2">{t('fmt.style.heading')}</option>
      <option value="h3">{t('fmt.style.subheading')}</option>
      <option value="quote">{t('fmt.style.quote')}</option>
    </select>
  );
}

const COLOR_LABEL: Record<TextColor | HighlightColor, MessageKey> = {
  grey: 'fmt.color.grey',
  red: 'fmt.color.red',
  orange: 'fmt.color.orange',
  green: 'fmt.color.green',
  blue: 'fmt.color.blue',
  purple: 'fmt.color.purple',
  yellow: 'fmt.color.yellow',
  pink: 'fmt.color.pink',
};

/** The picker's width: six 28 px swatches, their gaps and the padding. */
const PICKER_WIDTH = 216;

/**
 * R28 (ADR-0119): the text colour or highlight picker — a button, and under it a row of swatches
 * by palette name. The panel is drawn in `document.body` at the button's position, clamped to the
 * window, because the toolbar's `backdrop-blur` makes it the containing block of anything `fixed`
 * inside it, and an `absolute` panel at the button would run off a phone's screen at the bar's
 * right edge. Choosing keeps the selection: every control here prevents the mousedown.
 */
function ColorPicker({ editor, kind }: { editor: Editor; kind: 'text' | 'highlight' }) {
  const { t } = useT();
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const raw =
    kind === 'text'
      ? editor.getAttributes('textColor').color
      : editor.isActive('highlight')
        ? (editor.getAttributes('highlight').color ?? 'yellow')
        : null;
  const current =
    kind === 'text' ? (isTextColor(raw) ? raw : null) : isHighlightColor(raw) ? raw : null;
  const names: readonly (TextColor | HighlightColor)[] =
    kind === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS;
  const label = kind === 'text' ? t('fmt.textColor') : t('fmt.highlight');

  const close = useCallback(() => setPlace(null), []);

  useEffect(() => {
    if (!place) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // The panel is placed once; a scroll or a resize would leave it beside nothing.
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [place, close]);

  const toggle = () => {
    if (place) {
      close();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(PICKER_WIDTH, window.innerWidth - 16);
    setPlace({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: rect.bottom + 4,
    });
  };

  const apply = (name: TextColor | HighlightColor | null) => {
    const chain = editor.chain().focus();
    if (kind === 'text') {
      if (name && isTextColor(name)) chain.setTextColor(name).run();
      else chain.unsetTextColor().run();
    } else if (name && isHighlightColor(name)) chain.setHighlight(name).run();
    else chain.unsetHighlight().run();
    close();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={Boolean(place)}
        data-testid={kind === 'text' ? 'fmt-text-color' : 'fmt-highlight'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        className={cn(
          'relative inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1 transition-colors',
          current || place
            ? 'bg-accent-soft text-accent'
            : 'text-muted hover:bg-sunk hover:text-ink',
        )}
      >
        {kind === 'text' ? (
          <Baseline className="size-[15px]" strokeWidth={1.75} />
        ) : (
          <Highlighter className="size-[15px]" strokeWidth={1.75} />
        )}
        {current ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-x-1.5 bottom-0.5 h-[3px] rounded-full',
              kind === 'text' ? 'tc-ink-swatch' : 'tc-hl-swatch',
            )}
            {...(kind === 'text' ? { 'data-text-color': current } : { 'data-color': current })}
          />
        ) : null}
      </button>
      {place && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={label}
              data-testid={kind === 'text' ? 'text-color-picker' : 'highlight-picker'}
              style={{
                left: place.left,
                top: place.top,
                width: Math.min(PICKER_WIDTH, window.innerWidth - 16),
              }}
              className="fixed z-50 rounded-md border border-line bg-surface p-2 shadow-lg"
            >
              <p className="text-[11px] font-semibold text-ink">{label}</p>
              <div
                className={cn(
                  'mt-1.5 grid gap-1.5',
                  kind === 'text' ? 'grid-cols-6' : 'grid-cols-4',
                )}
              >
                {names.map((name) => (
                  <button
                    key={name}
                    type="button"
                    title={t(COLOR_LABEL[name])}
                    aria-label={t(COLOR_LABEL[name])}
                    aria-pressed={current === name}
                    data-testid={`${kind === 'text' ? 'text-color' : 'highlight'}-${name}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => apply(name)}
                    className={cn(
                      'h-7 w-full min-w-0 rounded-md border',
                      kind === 'text' ? 'tc-ink-swatch' : 'tc-hl-swatch',
                      current === name ? 'border-ink ring-2 ring-accent' : 'border-line-strong',
                    )}
                    {...(kind === 'text' ? { 'data-text-color': name } : { 'data-color': name })}
                  />
                ))}
              </div>
              <button
                type="button"
                data-testid={kind === 'text' ? 'text-color-none' : 'highlight-none'}
                disabled={!current}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(null)}
                className="mt-1.5 w-full rounded-md px-2 py-1 text-left text-[12px] text-ink transition-colors hover:bg-sunk disabled:opacity-45"
              >
                {kind === 'text' ? t('fmt.defaultColor') : t('fmt.noHighlight')}
              </button>
              <p className="mt-1 text-[11px] leading-snug text-muted">{t('fmt.colorsPrint')}</p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * The toolbar's own actions that open its inline field or its file picker, handed to the "/"
 * menu (`SlashMenu`) so an item there does exactly what the button does.
 */
export type FormatActions = {
  insertMath: (kind: 'inline' | 'block') => void;
  footnote: () => void;
  /** Null when the chapter cannot take an upload. */
  pickFigure: (() => void) | null;
};

export function FormatToolbar({
  editor,
  className,
  onInsertImage,
  onInsertChart,
  onInsertDiagram,
  actionsRef,
  describeEquation,
  readEquationPhoto,
}: {
  editor: Editor | null;
  /** ADR-0064: an equation read from a photo (one COMMAND unit); absent hides the button. */
  readEquationPhoto?: ReadEquationPhoto;
  /** ADR-0063: an equation described in words (one COMMAND unit); absent hides the box. */
  describeEquation?: DescribeEquation;
  className?: string;
  /** Filled with the toolbar's field-opening actions while it is mounted. */
  actionsRef?: RefObject<FormatActions | null>;
  /** Absent when the chapter cannot take an upload; the button is then hidden rather than dead. */
  onInsertImage?: (file: File) => void;
  /** Opens the chart dialog (ADR-0027) — for a new chart, or the selected one to edit. */
  onInsertChart?: () => void;
  /** ADR-0049: a diagram from the student's own steps and links. */
  onInsertDiagram?: () => void;
}) {
  useEditorTick(editor);
  const { t } = useT();

  const fileRef = useRef<HTMLInputElement>(null);
  const prompt = useInlinePrompt();

  const setLink = useCallback(() => {
    if (!editor) return;
    prompt.open({
      label: 'Link address',
      hint: 'example.com/paper',
      initial: (editor.getAttributes('link').href as string | undefined) ?? '',
      onDone: (href) => {
        if (href === null) return; // cancelled — leave the link as it was
        if (href === '') {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
          return;
        }
        // Default to https rather than letting a bare "example.com" become a relative link inside
        // the app, which is what the browser would otherwise resolve it to.
        const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      },
    });
  }, [editor, prompt]);

  // The caption the exporters print as "Figure 3.1: …" or "Table 2.1: …". Until this existed a
  // figure's caption was the uploaded file's name and a table's was nothing at all.
  const setCaption = useCallback(() => {
    if (!editor) return;
    const kind = editor.isActive('image') ? 'image' : 'table';
    const current = (editor.getAttributes(kind).caption as string | null | undefined) ?? '';
    prompt.open({
      label: kind === 'image' ? 'Figure caption' : 'Table caption',
      hint: kind === 'image' ? 'Survey sites in the two districts' : 'Sample sizes by district',
      initial: current,
      onDone: (caption) => {
        if (caption === null) return; // cancelled
        editor
          .chain()
          .focus()
          .updateAttributes(kind, {
            caption: caption || null,
            // The words a screen reader gets, in place of the file name.
            ...(kind === 'image' && caption ? { alt: caption } : {}),
          })
          .run();
      },
    });
  }, [editor, prompt]);

  /** A footnote at the caret, or the selected one's words changed (2026-09-25). */
  const footnote = useCallback(() => {
    if (!editor) return;
    const editing = editor.isActive('footnote');
    prompt.open({
      label: editing ? 'Footnote' : 'New footnote',
      hint: 'The survey was run before the 2020 subsidy change.',
      initial: editing ? String(editor.getAttributes('footnote').text ?? '') : '',
      onDone: (text) => {
        if (!text) return; // cancelled, or nothing to say
        if (editing) editor.chain().focus().setFootnoteText(text).run();
        else editor.chain().focus().insertFootnote(text).run();
      },
    });
  }, [editor, prompt]);

  const insertMath = useCallback(
    (kind: 'inline' | 'block') => {
      if (!editor) return;
      prompt.open({
        label: kind === 'inline' ? 'Equation (LaTeX)' : 'Display equation (LaTeX)',
        hint: 'E = mc^2, or pick an example below',
        initial: '',
        validate: latexError,
        math: {
          display: kind === 'block',
          ...(describeEquation ? { describe: describeEquation } : {}),
          ...(readEquationPhoto ? { photo: readEquationPhoto } : {}),
        },
        onDone: (latex) => {
          if (!latex) return;
          if (kind === 'inline') editor.chain().focus().insertMathInline(latex).run();
          else editor.chain().focus().insertMathBlock(latex).run();
        },
      });
    },
    [editor, prompt, describeEquation, readEquationPhoto],
  );

  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      insertMath,
      footnote,
      pickFigure: onInsertImage ? () => fileRef.current?.click() : null,
    };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, insertMath, footnote, onInsertImage]);

  // ADR-0045: an equation is edited by clicking it. The NodeView raises an event with its
  // position and source; the same field that inserted it opens with the source filled in.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onEdit = (event: Event) => {
      const detail = (event as CustomEvent<MathEditDetail>).detail;
      if (!detail) return;
      prompt.open({
        label: detail.display ? 'Display equation (LaTeX)' : 'Equation (LaTeX)',
        hint: 'E = mc^2, or pick an example below',
        initial: detail.latex,
        validate: latexError,
        math: {
          display: detail.display,
          ...(describeEquation ? { describe: describeEquation } : {}),
          ...(readEquationPhoto ? { photo: readEquationPhoto } : {}),
        },
        onDone: (latex) => {
          if (!latex || latex === detail.latex) return;
          editor.chain().focus().setMathLatex(detail.pos, latex).run();
        },
      });
    };
    dom.addEventListener(MATH_EDIT_EVENT, onEdit);
    return () => dom.removeEventListener(MATH_EDIT_EVENT, onEdit);
  }, [editor, prompt, describeEquation, readEquationPhoto]);

  if (!editor) return null;

  const inTable = editor.isActive('table');
  // A figure that was drawn from numbers can be opened and redrawn (ADR-0027).
  const chartSelected = editor.isActive('image') && Boolean(editor.getAttributes('image').chart);
  const diagramSelected =
    editor.isActive('image') && Boolean(editor.getAttributes('image').diagram);
  // Recomputed on every render, which `useEditorTick` already drives: inserting a figure has to
  // make it immediately referenceable, and renumber the references that exist.
  const refTargets = numberTargets(editor.getJSON());

  return (
    <div
      data-testid="format-toolbar"
      role="toolbar"
      aria-label={t('fmt.toolbar')}
      className={cn(
        // The negative margin cancels the page's own padding so the bar runs edge to edge; it has
        // to match that padding at every width, or on a phone the bar is wider than the screen.
        'sticky top-0 z-20 -mx-4 mb-4 border-b border-line bg-paper/95 px-4 py-1.5 backdrop-blur sm:-mx-6 sm:px-6',
        // QA 2026-10-09: a separate `relative` here made tailwind-merge drop `sticky`, so the bar
        // scrolled away with the page. `sticky` already anchors the inline prompt below to it.
        className,
      )}
    >
      <div className="mx-auto flex max-w-[72ch] flex-wrap items-center gap-0.5">
        <Tool
          label={t('fmt.undo')}
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="size-[15px]" strokeWidth={1.75} />
        </Tool>
        <Tool
          label={t('fmt.redo')}
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="size-[15px]" strokeWidth={1.75} />
        </Tool>

        <Divider />
        <BlockStyle editor={editor} />
        <Divider />

        <Tool
          label={t('fmt.bold')}
          testId="fmt-bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="size-[15px]" strokeWidth={2} />
        </Tool>
        <Tool
          label={t('fmt.italic')}
          testId="fmt-italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-[15px]" strokeWidth={2} />
        </Tool>
        <Tool
          label={t('fmt.underline')}
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="size-[15px]" strokeWidth={2} />
        </Tool>
        <Tool
          label={t('fmt.strike')}
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="size-[15px]" strokeWidth={2} />
        </Tool>
        <ColorPicker editor={editor} kind="text" />
        <ColorPicker editor={editor} kind="highlight" />

        <Divider />

        <Tool
          label={t('fmt.superscript')}
          active={editor.isActive('superscript')}
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
        >
          <SuperscriptIcon className="size-[15px]" strokeWidth={1.75} />
        </Tool>
        <Tool
          label={t('fmt.subscript')}
          active={editor.isActive('subscript')}
          onClick={() => editor.chain().focus().toggleSubscript().run()}
        >
          <SubscriptIcon className="size-[15px]" strokeWidth={1.75} />
        </Tool>
        <Tool
          label={t('fmt.inlineCode')}
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code className="size-[15px]" strokeWidth={1.75} />
        </Tool>
        <Tool
          label={t('fmt.codeBlock')}
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Braces className="size-[15px]" strokeWidth={1.75} />
        </Tool>

        <Divider />

        <Tool
          label={t('fmt.bulletList')}
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="size-[15px]" strokeWidth={1.75} />
        </Tool>
        <Tool
          label={t('fmt.orderedList')}
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-[15px]" strokeWidth={1.75} />
        </Tool>
        <Tool
          label={t('fmt.blockquote')}
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="size-[15px]" strokeWidth={1.75} />
        </Tool>

        <Divider />

        <Tool
          label={editor.isActive('link') ? t('fmt.editLink') : t('fmt.addLink')}
          active={editor.isActive('link')}
          onClick={setLink}
        >
          <Link2 className="size-[15px]" strokeWidth={1.75} />
        </Tool>
        {editor.isActive('link') ? (
          <Tool
            label={t('fmt.removeLink')}
            onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
          >
            <Link2Off className="size-[15px]" strokeWidth={1.75} />
          </Tool>
        ) : null}

        <Tool
          label={t('fmt.insertTable')}
          testId="fmt-table"
          active={inTable}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <TableIcon className="size-[15px]" strokeWidth={1.75} />
        </Tool>

        {/* Only when there is something to point at. A reference picker offering nothing is a
            button that teaches people the feature is broken. */}
        {refTargets.length > 0 ? (
          <select
            aria-label={t('fmt.referTo')}
            data-testid="fmt-crossref"
            value=""
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const chosen = refTargets.find((t) => t.refId === e.target.value);
              if (chosen) {
                editor
                  .chain()
                  .focus()
                  .insertCrossRef({ refId: chosen.refId, kind: chosen.kind })
                  .run();
              }
              e.target.value = '';
            }}
            className="h-7 shrink-0 rounded-md border border-line bg-surface px-1.5 text-[12px] text-ink transition-colors hover:bg-sunk"
          >
            <option value="">{t('fmt.referToOption')}</option>
            {refTargets.map((target) => (
              <option key={target.refId} value={target.refId}>
                {t(target.kind === 'figure' ? 'fmt.figureN' : 'fmt.tableN', { n: target.index })}
              </option>
            ))}
          </select>
        ) : null}

        <Tool label={t('fmt.equation')} testId="fmt-math" onClick={() => insertMath('inline')}>
          <Sigma className="size-[15px]" strokeWidth={1.75} />
        </Tool>
        <Tool label={t('fmt.displayEquation')} onClick={() => insertMath('block')}>
          <span className="text-[13px] font-semibold leading-none">Σ⁺</span>
        </Tool>
        <Tool
          label={editor.isActive('footnote') ? t('fmt.editFootnote') : t('fmt.footnote')}
          testId="fmt-footnote"
          active={editor.isActive('footnote')}
          onClick={footnote}
        >
          <span className="text-[12px] font-semibold leading-none">¹</span>
        </Tool>

        {onInsertImage ? (
          <>
            <Tool
              label={t('fmt.insertFigure')}
              testId="fmt-image"
              onClick={() => fileRef.current?.click()}
            >
              {/* biome-ignore lint/a11y/noSvgWithoutTitle: the button carries the label. */}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-[15px]"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
              </svg>
            </Tool>
            <input
              ref={fileRef}
              type="file"
              // What the server accepts (`sniffImage`); offering WebP and SVG here only to refuse
              // them on upload was a picker that lied.
              accept="image/png,image/jpeg,image/gif"
              className="hidden"
              data-testid="figure-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared before the upload so choosing the same file twice fires `change` again.
                e.target.value = '';
                if (file) onInsertImage(file);
              }}
            />
          </>
        ) : null}

        {onInsertChart ? (
          <Tool
            label={chartSelected ? t('fmt.editChart') : t('fmt.insertChart')}
            testId="fmt-chart"
            active={chartSelected}
            onClick={onInsertChart}
          >
            <span className="text-[11px] font-medium leading-none">{t('fmt.chart')}</span>
          </Tool>
        ) : null}

        {onInsertDiagram ? (
          <Tool
            label={diagramSelected ? t('fmt.editDiagram') : t('fmt.insertDiagram')}
            testId="fmt-diagram"
            active={diagramSelected}
            onClick={onInsertDiagram}
          >
            <span className="text-[11px] font-medium leading-none">{t('fmt.diagram')}</span>
          </Tool>
        ) : null}

        {/* A caption for the selected figure or the table the cursor is in. */}
        {inTable || editor.isActive('image') ? (
          <Tool label={t('fmt.caption')} testId="fmt-caption" onClick={setCaption}>
            <span className="text-[11px] font-medium leading-none">{t('fmt.caption')}</span>
          </Tool>
        ) : null}

        {/* Table editing only appears inside a table: eight controls that do nothing anywhere else
            would be eight-ninths of this bar permanently greyed out. */}
        {inTable ? (
          <>
            <Divider />
            <span className="shrink-0 text-[11px] text-faint">{t('fmt.table')}</span>
            <Tool
              label={t('fmt.rowAbove')}
              onClick={() => editor.chain().focus().addRowBefore().run()}
            >
              <span className="text-[12px] leading-none">↑+</span>
            </Tool>
            <Tool
              label={t('fmt.rowBelow')}
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              <span className="text-[12px] leading-none">↓+</span>
            </Tool>
            <Tool
              label={t('fmt.columnLeft')}
              onClick={() => editor.chain().focus().addColumnBefore().run()}
            >
              <span className="text-[12px] leading-none">←+</span>
            </Tool>
            <Tool
              label={t('fmt.columnRight')}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              <span className="text-[12px] leading-none">→+</span>
            </Tool>
            {/* Merge needs two or more cells selected (drag across them); split needs a merged
                cell. Shown only when they would do something, like the rest of this group. */}
            {editor.can().mergeCells() ? (
              <Tool
                label={t('fmt.mergeCells')}
                testId="fmt-merge-cells"
                onClick={() => editor.chain().focus().mergeCells().run()}
              >
                <span className="text-[11px] font-medium leading-none">{t('fmt.merge')}</span>
              </Tool>
            ) : null}
            {editor.can().splitCell() ? (
              <Tool
                label={t('fmt.splitCell')}
                testId="fmt-split-cell"
                onClick={() => editor.chain().focus().splitCell().run()}
              >
                <span className="text-[11px] font-medium leading-none">{t('fmt.split')}</span>
              </Tool>
            ) : null}
            <Tool
              label={t('fmt.headerRow')}
              testId="fmt-header-row"
              onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            >
              <span className="text-[11px] font-medium leading-none">{t('fmt.header')}</span>
            </Tool>
            <Tool
              label={t('fmt.deleteRow')}
              onClick={() => editor.chain().focus().deleteRow().run()}
            >
              <span className="text-[12px] leading-none">⌫R</span>
            </Tool>
            <Tool
              label={t('fmt.deleteColumn')}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            >
              <span className="text-[12px] leading-none">⌫C</span>
            </Tool>
            <Tool
              label={t('fmt.deleteTable')}
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              <Trash2 className="size-[15px]" strokeWidth={1.75} />
            </Tool>
          </>
        ) : null}
      </div>
      {prompt.element}
    </div>
  );
}

/**
 * Live word count, and how much of it the model wrote.
 *
 * The count comes from `wordCountByProvenance` — the same function the API runs on save
 * (`apps/api/.../word-counts.ts` is its twin) — rather than from a private `split(/\s+/)` here.
 * Two counters would eventually disagree, and the number a student sees while typing disagreeing
 * with the number on the outline screen is the kind of small wrongness that costs trust in every
 * other number in the product.
 *
 * The AI share is shown because we can: §12.3 already tracks every word's provenance for the
 * disclosure export, so the honest number is sitting right there. A competitor's editor shows
 * "68 words"; this one can say how many of them the student actually wrote.
 */
export function WordCount({ editor, className }: { editor: Editor | null; className?: string }) {
  useEditorTick(editor);
  if (!editor) return null;

  const counts = wordCountByProvenance(editor.state.doc);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  // HUMAN_EDITED is text the model proposed and the student then rewrote. It counts as theirs:
  // they read it and changed it, which is the whole distinction the product is built on.
  const ai = counts.ASSIST + counts.DRAFT + counts.COMMAND;
  const share = total > 0 ? Math.round((ai / total) * 100) : 0;

  return (
    <span data-testid="word-count" className={cn('tnum text-[11.5px] text-faint', className)}>
      {total.toLocaleString()} {total === 1 ? 'word' : 'words'}
      {ai > 0 ? (
        <span title={`${ai.toLocaleString()} words came from a suggestion or draft you accepted`}>
          {' · '}
          {share}% AI
        </span>
      ) : null}
    </span>
  );
}
