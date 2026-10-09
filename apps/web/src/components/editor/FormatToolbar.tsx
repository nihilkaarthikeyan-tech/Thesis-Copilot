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
  Captions,
  ChartColumn,
  ChevronDown,
  Code,
  Hash,
  Highlighter,
  Image as ImageIcon,
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
  TextQuote,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Workflow,
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

/**
 * One row of the More menu (ADR-0137): the same control as a `Tool`, with its name written out
 * beside the icon, because a menu of bare icons is a quiz. The accessible name is the same label
 * the bar's button had, so a control that moved here is still found by its name.
 */
function MenuTool({
  label,
  text,
  active,
  disabled,
  onClick,
  children,
  testId,
}: {
  label: string;
  /** What the row shows; the label when absent. */
  text?: string;
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
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] transition-colors',
        'disabled:pointer-events-none disabled:opacity-35',
        active ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-sunk',
      )}
    >
      <span aria-hidden="true" className="inline-flex w-[18px] shrink-0 justify-center text-muted">
        {children}
      </span>
      <span aria-hidden="true" className="min-w-0 flex-1 truncate">
        {text ?? label}
      </span>
    </button>
  );
}

function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
      {children}
    </p>
  );
}

/** The More menu's width; it is clamped to the window as well. */
const MORE_WIDTH = 248;

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
function ColorPicker({
  editor,
  kind,
  row = false,
}: {
  editor: Editor;
  kind: 'text' | 'highlight';
  /** ADR-0137: drawn as a labelled row of the toolbar's More menu. */
  row?: boolean;
}) {
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
          row
            ? 'relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] transition-colors'
            : 'relative inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1 transition-colors',
          current || place
            ? 'bg-accent-soft text-accent'
            : row
              ? 'text-ink hover:bg-sunk'
              : 'text-muted hover:bg-sunk hover:text-ink',
        )}
      >
        <span className="relative inline-flex">
          {kind === 'text' ? (
            <Baseline className="size-[15px]" strokeWidth={1.75} />
          ) : (
            <Highlighter className="size-[15px]" strokeWidth={1.75} />
          )}
          {current ? (
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-x-0 -bottom-1 h-[3px] rounded-full',
                kind === 'text' ? 'tc-ink-swatch' : 'tc-hl-swatch',
              )}
              {...(kind === 'text' ? { 'data-text-color': current } : { 'data-color': current })}
            />
          ) : null}
        </span>
        {row ? (
          <span aria-hidden="true" className="min-w-0 flex-1 truncate">
            {kind === 'text' ? t('fmt.textColor') : t('fmt.highlight')}
          </span>
        ) : null}
      </button>
      {place && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              // The toolbar's More menu stays open while a colour is chosen here.
              data-keep-menu=""
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

  // ADR-0137: the More ▾ menu. Drawn in `document.body` at the button, clamped to the window, for
  // the reason the colour picker is: the bar's `backdrop-blur` makes it the containing block of
  // anything `fixed` inside it.
  const [more, setMore] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const moreMenu = useRef<HTMLDivElement>(null);
  const placeMore = useCallback(() => {
    const rect = moreButton.current?.getBoundingClientRect();
    if (!rect) return null;
    const width = Math.min(MORE_WIDTH, window.innerWidth - 16);
    const top = rect.bottom + 4;
    return {
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top,
      maxHeight: Math.max(160, window.innerHeight - top - 8),
    };
  }, []);
  const closeMore = useCallback(() => setMore(null), []);
  const moreOpen = more !== null;
  /**
   * The bar's own width, not the window's, decides what stays on it: the text column is narrowed
   * by the chapter list, the tool panel and the "read beside" pane in every combination, and a
   * row that ran past its column slid under the pane's resize handle (2026-10-09).
   */
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the row exists once the editor does
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRowWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [editor]);
  // Lists, table and equation need about 120 px more than the rest; undo/redo about 60.
  const showBlocks = rowWidth === 0 || rowWidth >= 500;
  const showHistory = rowWidth === 0 || rowWidth >= 380;
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (moreMenu.current?.contains(target) || moreButton.current?.contains(target)) return;
      // A colour panel opened from the menu is drawn outside it.
      if (target?.closest?.('[data-keep-menu]')) return;
      setMore(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMore(null);
    };
    // The bar is sticky, so the menu follows its button rather than closing on a scroll.
    const follow = (event: Event) => {
      if (event.type === 'scroll' && moreMenu.current?.contains(event.target as Node)) return;
      const next = placeMore();
      if (next) setMore(next);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [moreOpen, placeMore]);

  if (!editor) return null;

  const inTable = editor.isActive('table');
  // A figure that was drawn from numbers can be opened and redrawn (ADR-0027).
  const chartSelected = editor.isActive('image') && Boolean(editor.getAttributes('image').chart);
  const diagramSelected =
    editor.isActive('image') && Boolean(editor.getAttributes('image').diagram);
  // Recomputed on every render, which `useEditorTick` already drives: inserting a figure has to
  // make it immediately referenceable, and renumber the references that exist.
  const refTargets = numberTargets(editor.getJSON());

  /** "@" at the caret opens the library picker (`CitePicker`), as typing it does. */
  const cite = () => {
    const { from } = editor.state.selection;
    const before = editor.state.doc.textBetween(Math.max(0, from - 1), from, '\n', ' ');
    editor
      .chain()
      .focus()
      .insertContent(before === '' || /\s|[([]/.test(before) ? '@' : ' @')
      .run();
  };
  /** A menu row that opens a field, a dialog or a file picker closes the menu first. */
  const thenClose = (run: () => void) => () => {
    closeMore();
    run();
  };
  const icon = 'size-[15px]';

  return (
    <div
      data-testid="format-toolbar"
      role="toolbar"
      aria-label={t('fmt.toolbar')}
      className={cn(
        // The negative margin cancels the page's own padding so the bar runs edge to edge; it has
        // to match that padding at every width, or on a phone the bar is wider than the screen.
        // `lg:top-12`: from `lg` up the editor's header is sticky too (ADR-0137), 48 px tall.
        'sticky top-0 z-20 -mx-4 mb-4 border-b border-line bg-paper/95 px-4 py-1.5 backdrop-blur sm:-mx-6 sm:px-6 lg:top-12',
        // QA 2026-10-09: a separate `relative` here made tailwind-merge drop `sticky`, so the bar
        // scrolled away with the page. `sticky` already anchors the inline prompt below to it.
        className,
      )}
    >
      {/* ADR-0137: one row. What a thesis needs every few minutes stays on the bar; the rest is
          under More, named. Below `sm` the lists, table, equation and undo/redo join it. */}
      {/* Wraps only as a last resort, in a column too narrow even for the short row. */}
      <div ref={rowRef} className="mx-auto flex max-w-[72ch] flex-wrap items-center gap-0.5">
        <span className={cn('items-center gap-0.5', showHistory ? 'flex' : 'hidden')}>
          <Tool
            label={t('fmt.undo')}
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 className={icon} strokeWidth={1.75} />
          </Tool>
          <Tool
            label={t('fmt.redo')}
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 className={icon} strokeWidth={1.75} />
          </Tool>
          <Divider />
        </span>

        <BlockStyle editor={editor} />
        <Divider />

        <Tool
          label={t('fmt.bold')}
          testId="fmt-bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className={icon} strokeWidth={2} />
        </Tool>
        <Tool
          label={t('fmt.italic')}
          testId="fmt-italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className={icon} strokeWidth={2} />
        </Tool>
        <Tool
          label={t('fmt.underline')}
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className={icon} strokeWidth={2} />
        </Tool>

        <Tool
          label={editor.isActive('link') ? t('fmt.editLink') : t('fmt.addLink')}
          active={editor.isActive('link')}
          onClick={setLink}
        >
          <Link2 className={icon} strokeWidth={1.75} />
        </Tool>
        {editor.isActive('link') ? (
          <Tool
            label={t('fmt.removeLink')}
            onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
          >
            <Link2Off className={icon} strokeWidth={1.75} />
          </Tool>
        ) : null}

        <button
          type="button"
          title={t('fmt.citeTitle')}
          data-testid="fmt-cite"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cite}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted transition-colors hover:bg-sunk hover:text-ink"
        >
          <TextQuote className="size-[14px]" strokeWidth={1.75} aria-hidden="true" />
          {t('fmt.cite')}
        </button>

        {/* In More when the bar is too narrow for them. */}
        <span className={cn('items-center gap-0.5', showBlocks ? 'flex' : 'hidden')}>
          <Divider />
          <Tool
            label={t('fmt.bulletList')}
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className={icon} strokeWidth={1.75} />
          </Tool>
          <Tool
            label={t('fmt.orderedList')}
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className={icon} strokeWidth={1.75} />
          </Tool>
          <Tool
            label={t('fmt.insertTable')}
            testId="fmt-table"
            active={inTable}
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
          >
            <TableIcon className={icon} strokeWidth={1.75} />
          </Tool>
          <Tool label={t('fmt.equation')} testId="fmt-math" onClick={() => insertMath('inline')}>
            <Sigma className={icon} strokeWidth={1.75} />
          </Tool>
        </span>

        <button
          ref={moreButton}
          type="button"
          title={t('fmt.moreTitle')}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          data-testid="fmt-more"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMore((open) => (open ? null : placeMore()))}
          className={cn(
            'ml-auto inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[12px] transition-colors',
            moreOpen || inTable
              ? 'bg-accent-soft text-accent'
              : 'text-muted hover:bg-sunk hover:text-ink',
          )}
        >
          {t('fmt.more')}
          <ChevronDown className="size-[13px]" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {/* Always mounted: the "/" menu's "Figure" uses this picker too. */}
      {onInsertImage ? (
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
      ) : null}

      {more && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={moreMenu}
              role="menu"
              aria-label={t('fmt.moreTitle')}
              data-testid="fmt-more-menu"
              style={{
                left: more.left,
                top: more.top,
                width: Math.min(MORE_WIDTH, window.innerWidth - 16),
                maxHeight: more.maxHeight,
              }}
              className="fixed z-50 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-lg"
            >
              {/* On a phone the bar keeps only the everyday marks; the rest of its row is here. */}
              <div className={showHistory ? 'hidden' : undefined}>
                <MenuTool
                  label={t('fmt.undo')}
                  disabled={!editor.can().undo()}
                  onClick={() => editor.chain().focus().undo().run()}
                >
                  <Undo2 className={icon} strokeWidth={1.75} />
                </MenuTool>
                <MenuTool
                  label={t('fmt.redo')}
                  disabled={!editor.can().redo()}
                  onClick={() => editor.chain().focus().redo().run()}
                >
                  <Redo2 className={icon} strokeWidth={1.75} />
                </MenuTool>
              </div>
              {/* The same below `sm`, and between `md` and `xl`, where the side columns leave
                  the text column too narrow for the whole row (768 px: 496 px of bar). */}
              <div className={showBlocks ? 'hidden' : undefined}>
                <MenuTool
                  label={t('fmt.bulletList')}
                  active={editor.isActive('bulletList')}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                >
                  <List className={icon} strokeWidth={1.75} />
                </MenuTool>
                <MenuTool
                  label={t('fmt.orderedList')}
                  active={editor.isActive('orderedList')}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                >
                  <ListOrdered className={icon} strokeWidth={1.75} />
                </MenuTool>
                <MenuTool
                  label={t('fmt.insertTable')}
                  active={inTable}
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                      .run()
                  }
                >
                  <TableIcon className={icon} strokeWidth={1.75} />
                </MenuTool>
                <MenuTool label={t('fmt.equation')} onClick={thenClose(() => insertMath('inline'))}>
                  <Sigma className={icon} strokeWidth={1.75} />
                </MenuTool>
              </div>

              <MenuHeading>{t('fmt.moreFormat')}</MenuHeading>
              <MenuTool
                label={t('fmt.strike')}
                active={editor.isActive('strike')}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              >
                <Strikethrough className={icon} strokeWidth={2} />
              </MenuTool>
              <ColorPicker editor={editor} kind="text" row />
              <ColorPicker editor={editor} kind="highlight" row />
              <MenuTool
                label={t('fmt.superscript')}
                active={editor.isActive('superscript')}
                onClick={() => editor.chain().focus().toggleSuperscript().run()}
              >
                <SuperscriptIcon className={icon} strokeWidth={1.75} />
              </MenuTool>
              <MenuTool
                label={t('fmt.subscript')}
                active={editor.isActive('subscript')}
                onClick={() => editor.chain().focus().toggleSubscript().run()}
              >
                <SubscriptIcon className={icon} strokeWidth={1.75} />
              </MenuTool>
              <MenuTool
                label={t('fmt.inlineCode')}
                active={editor.isActive('code')}
                onClick={() => editor.chain().focus().toggleCode().run()}
              >
                <Code className={icon} strokeWidth={1.75} />
              </MenuTool>
              <MenuTool
                label={t('fmt.codeBlock')}
                active={editor.isActive('codeBlock')}
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              >
                <Braces className={icon} strokeWidth={1.75} />
              </MenuTool>
              <MenuTool
                label={t('fmt.blockquote')}
                active={editor.isActive('blockquote')}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
              >
                <Quote className={icon} strokeWidth={1.75} />
              </MenuTool>

              <MenuHeading>{t('fmt.moreInsert')}</MenuHeading>
              <MenuTool
                label={t('fmt.displayEquation')}
                onClick={thenClose(() => insertMath('block'))}
              >
                <span className="text-[13px] font-semibold leading-none">Σ⁺</span>
              </MenuTool>
              <MenuTool
                label={editor.isActive('footnote') ? t('fmt.editFootnote') : t('fmt.footnote')}
                testId="fmt-footnote"
                active={editor.isActive('footnote')}
                onClick={thenClose(footnote)}
              >
                <span className="text-[12px] font-semibold leading-none">¹</span>
              </MenuTool>
              {onInsertImage ? (
                <MenuTool
                  label={t('fmt.insertFigure')}
                  testId="fmt-image"
                  onClick={thenClose(() => fileRef.current?.click())}
                >
                  <ImageIcon className={icon} strokeWidth={1.75} />
                </MenuTool>
              ) : null}
              {onInsertChart ? (
                <MenuTool
                  label={chartSelected ? t('fmt.editChart') : t('fmt.insertChart')}
                  testId="fmt-chart"
                  active={chartSelected}
                  onClick={thenClose(onInsertChart)}
                >
                  <ChartColumn className={icon} strokeWidth={1.75} />
                </MenuTool>
              ) : null}
              {onInsertDiagram ? (
                <MenuTool
                  label={diagramSelected ? t('fmt.editDiagram') : t('fmt.insertDiagram')}
                  testId="fmt-diagram"
                  active={diagramSelected}
                  onClick={thenClose(onInsertDiagram)}
                >
                  <Workflow className={icon} strokeWidth={1.75} />
                </MenuTool>
              ) : null}
              {/* A caption for the selected figure or the table the cursor is in. */}
              {inTable || editor.isActive('image') ? (
                <MenuTool
                  label={t('fmt.caption')}
                  testId="fmt-caption"
                  onClick={thenClose(setCaption)}
                >
                  <Captions className={icon} strokeWidth={1.75} />
                </MenuTool>
              ) : null}
              {/* Only when there is something to point at. A reference picker offering nothing is
                  a button that teaches people the feature is broken. */}
              {refTargets.length > 0 ? (
                <label className="flex h-8 items-center gap-2.5 px-2 text-[12.5px] text-ink">
                  <span
                    aria-hidden="true"
                    className="inline-flex w-[18px] shrink-0 justify-center text-muted"
                  >
                    <Hash className={icon} strokeWidth={1.75} />
                  </span>
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
                        closeMore();
                      }
                      e.target.value = '';
                    }}
                    className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 text-[12px] text-ink transition-colors hover:bg-sunk"
                  >
                    <option value="">{t('fmt.referToOption')}</option>
                    {refTargets.map((target) => (
                      <option key={target.refId} value={target.refId}>
                        {t(target.kind === 'figure' ? 'fmt.figureN' : 'fmt.tableN', {
                          n: target.index,
                        })}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {/* Table editing only inside a table: controls that do nothing anywhere else would
                  be a section of greyed-out rows. */}
              {inTable ? (
                <>
                  <MenuHeading>{t('fmt.table')}</MenuHeading>
                  <MenuTool
                    label={t('fmt.rowAbove')}
                    onClick={() => editor.chain().focus().addRowBefore().run()}
                  >
                    <span className="text-[12px] leading-none">↑+</span>
                  </MenuTool>
                  <MenuTool
                    label={t('fmt.rowBelow')}
                    onClick={() => editor.chain().focus().addRowAfter().run()}
                  >
                    <span className="text-[12px] leading-none">↓+</span>
                  </MenuTool>
                  <MenuTool
                    label={t('fmt.columnLeft')}
                    onClick={() => editor.chain().focus().addColumnBefore().run()}
                  >
                    <span className="text-[12px] leading-none">←+</span>
                  </MenuTool>
                  <MenuTool
                    label={t('fmt.columnRight')}
                    onClick={() => editor.chain().focus().addColumnAfter().run()}
                  >
                    <span className="text-[12px] leading-none">→+</span>
                  </MenuTool>
                  {/* Merge needs two or more cells selected (drag across them); split needs a
                      merged cell. Shown only when they would do something. */}
                  {editor.can().mergeCells() ? (
                    <MenuTool
                      label={t('fmt.mergeCells')}
                      testId="fmt-merge-cells"
                      onClick={() => editor.chain().focus().mergeCells().run()}
                    >
                      <span className="text-[11px] font-medium leading-none">⊞</span>
                    </MenuTool>
                  ) : null}
                  {editor.can().splitCell() ? (
                    <MenuTool
                      label={t('fmt.splitCell')}
                      testId="fmt-split-cell"
                      onClick={() => editor.chain().focus().splitCell().run()}
                    >
                      <span className="text-[11px] font-medium leading-none">⊟</span>
                    </MenuTool>
                  ) : null}
                  <MenuTool
                    label={t('fmt.headerRow')}
                    testId="fmt-header-row"
                    onClick={() => editor.chain().focus().toggleHeaderRow().run()}
                  >
                    <span className="text-[11px] font-medium leading-none">H</span>
                  </MenuTool>
                  <MenuTool
                    label={t('fmt.deleteRow')}
                    onClick={() => editor.chain().focus().deleteRow().run()}
                  >
                    <span className="text-[12px] leading-none">⌫R</span>
                  </MenuTool>
                  <MenuTool
                    label={t('fmt.deleteColumn')}
                    onClick={() => editor.chain().focus().deleteColumn().run()}
                  >
                    <span className="text-[12px] leading-none">⌫C</span>
                  </MenuTool>
                  <MenuTool
                    label={t('fmt.deleteTable')}
                    onClick={() => editor.chain().focus().deleteTable().run()}
                  >
                    <Trash2 className={icon} strokeWidth={1.75} />
                  </MenuTool>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
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
