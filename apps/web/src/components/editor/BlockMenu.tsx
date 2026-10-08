'use client';

/**
 * The block menu (Jenni build plan R7), opened from the grip beside a paragraph
 * (`packages/ui/src/editor/block-handle.ts`). Every item reuses something that already exists:
 * Edit selects the block so the selection toolbar's edits apply (ADR-0066), Ask in chat and Find
 * a source are the toolbar's own actions, Cite opens the `@` library picker at the paragraph's
 * end — free, it cannot cite anything the student has not added. The rest are editor commands
 * that call no model.
 *
 * "Check this paragraph" (R26, ADR-0126) runs a check of the Check tab on this block only:
 * spelling and grammar (ADR-0026), the tone review (ADR-0084) and the examiner (ADR-0067). Each is
 * the check's own run with the block's range, for the unit it takes today (one command), and its
 * results open in the text through review mode (ADR-0110).
 *
 * Submenus open in place rather than on hover, so the menu works the same on a touch screen. The
 * menu is measured once drawn and kept inside the window, with a submenu open, at any size.
 */

import {
  BLOCK_HIGHLIGHTS,
  type BlockHighlight,
  type BlockMenuRequest,
  blockTextAt,
  citeSlot,
  type TurnInto,
  topLevelBlock,
} from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BlockCheck } from '@/lib/block-check';
import { placeMenu } from '@/lib/place-menu';
import { AI_EDIT_FOCUS } from './CommandToolbar';

const TURN_INTO: Array<{ kind: TurnInto; label: string }> = [
  { kind: 'paragraph', label: 'Text' },
  { kind: 'heading', label: 'Heading' },
  { kind: 'subheading', label: 'Subheading' },
  { kind: 'bulletList', label: 'Bulleted list' },
  { kind: 'orderedList', label: 'Numbered list' },
  { kind: 'quote', label: 'Quote' },
  { kind: 'code', label: 'Code' },
];

const HIGHLIGHT_LABEL: Record<BlockHighlight, string> = {
  amber: 'Amber',
  green: 'Green',
  blue: 'Blue',
};

type Open = 'turn' | 'highlight' | 'review' | null;

/** The checks a paragraph can have on its own, in the order the Check tab lists them. */
const CHECKS: Array<{ check: BlockCheck; label: string }> = [
  { check: 'proofread', label: 'Spelling and grammar' },
  { check: 'tone', label: 'Tone of voice' },
  { check: 'examiner', label: 'As an examiner' },
];

export function BlockMenu(props: {
  editor: Editor | null;
  request: BlockMenuRequest | null;
  onClose: () => void;
  onAskChat: (text: string) => void;
  onFindPapers: (text: string) => void;
  /** R26: run one of the Check tab's checks on this block's range. */
  onCheck: (check: BlockCheck, from: number, to: number) => void;
}) {
  const { editor, request, onClose } = props;
  const [open, setOpen] = useState<Open>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  // A menu opened on a new block starts with every submenu closed, before it is first painted
  // (it used to close the last one after painting it open for a frame).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new request closes the submenus
  useLayoutEffect(() => {
    setOpen(null);
  }, [request]);

  // Measured before the browser paints, so the menu never shows where it does not fit; again when
  // a submenu opens (the menu grows) and when the window changes size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` changes the menu's height
  useLayoutEffect(() => {
    if (!request) return;
    const measure = () => {
      const menu = ref.current;
      if (!menu) return;
      setPlace(
        placeMenu(
          request.rect,
          { width: menu.offsetWidth, height: menu.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [request, open]);

  useEffect(() => {
    if (!request) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // On the next tick, so the click that opened the menu does not close it.
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [request, onClose]);

  if (!editor || !request) return null;
  const block = topLevelBlock(editor.state.doc, request.pos);
  if (!block) return null;
  const text = blockTextAt(editor.state.doc, block.pos);
  const hasText = text.length > 0;
  const textblock = block.node.isTextblock;

  const done = (action: () => void) => () => {
    action();
    onClose();
  };

  const cite = () => {
    const at = citeSlot(editor.state.doc, block.pos);
    if (at === null) return;
    const before = editor.state.doc.textBetween(Math.max(0, at - 1), at);
    // "@" after a space opens the library picker (`CitePicker`); choosing a paper replaces it.
    editor
      .chain()
      .focus()
      .insertContentAt(at, /\s$/.test(before) ? '@' : ' @')
      .run();
  };

  // Before the first measurement: beside the grip, at the estimated size.
  const at =
    place ??
    placeMenu(
      request.rect,
      { width: 240, height: 380 },
      { width: window.innerWidth, height: window.innerHeight },
    );
  const item =
    'flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-50';
  const sub = 'ml-3 border-l border-line pl-1';

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Block menu"
      data-testid="block-menu"
      className="fixed z-50 max-h-[calc(100dvh-16px)] w-60 max-w-[calc(100vw-16px)] overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-lg"
      style={{ top: at.top, left: at.left }}
    >
      <button
        type="button"
        role="menuitem"
        className={item}
        aria-expanded={open === 'turn'}
        onClick={() => setOpen(open === 'turn' ? null : 'turn')}
        data-testid="block-menu-turn"
      >
        Turn into <span className="text-muted">▸</span>
      </button>
      {open === 'turn' ? (
        <div className={sub}>
          {TURN_INTO.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="menuitem"
              className={item}
              onClick={done(() =>
                editor.chain().focus().turnBlockInto(block.pos, option.kind).run(),
              )}
              data-testid={`block-menu-turn-${option.kind}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className={item}
        disabled={!textblock || !hasText}
        onClick={done(cite)}
        data-testid="block-menu-cite"
      >
        Cite from your library
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        aria-expanded={open === 'highlight'}
        onClick={() => setOpen(open === 'highlight' ? null : 'highlight')}
        data-testid="block-menu-highlight"
      >
        Highlight <span className="text-muted">▸</span>
      </button>
      {open === 'highlight' ? (
        <div className={sub}>
          {BLOCK_HIGHLIGHTS.map((color) => (
            <button
              key={color}
              type="button"
              role="menuitem"
              className={item}
              onClick={done(() => editor.chain().focus().setBlockHighlight(block.pos, color).run())}
              data-testid={`block-menu-highlight-${color}`}
            >
              <span className="flex items-center gap-2">
                <span className="tc-swatch h-3 w-3 rounded-sm" data-highlight={color} />
                {HIGHLIGHT_LABEL[color]}
              </span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={item}
            disabled={!block.node.attrs.highlight}
            onClick={done(() => editor.chain().focus().setBlockHighlight(block.pos, null).run())}
            data-testid="block-menu-highlight-none"
          >
            No highlight
          </button>
          {/* ADR-0094: a reading aid. R28 (ADR-0119) added the highlight that prints. */}
          <p className="px-2 pb-1 pt-0.5 text-[11px] leading-snug text-muted">
            On screen only. To highlight words in the file, select them and use Highlight in the
            toolbar.
          </p>
        </div>
      ) : null}
      <div className="my-1 border-t border-line" />
      <button
        type="button"
        role="menuitem"
        className={item}
        disabled={!hasText}
        onClick={done(() => props.onAskChat(text))}
        data-testid="block-menu-chat"
      >
        Ask in chat
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        disabled={!hasText}
        onClick={done(() => {
          editor.chain().focus().selectBlock(block.pos).run();
          // The edit panel appears with the selection; the caret goes to its box (ADR-0095).
          window.setTimeout(() => window.dispatchEvent(new Event(AI_EDIT_FOCUS)), 50);
        })}
        data-testid="block-menu-edit"
      >
        Edit with AI
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        aria-expanded={open === 'review'}
        disabled={!hasText}
        onClick={() => setOpen(open === 'review' ? null : 'review')}
        data-testid="block-menu-review"
      >
        Check this paragraph <span className="text-muted">▸</span>
      </button>
      {open === 'review' ? (
        <div className={sub} data-testid="block-menu-checks">
          {CHECKS.map(({ check, label }) => (
            <button
              key={check}
              type="button"
              role="menuitem"
              className={item}
              onClick={done(() => props.onCheck(check, block.pos, block.pos + block.node.nodeSize))}
              data-testid={`block-menu-review-${check}`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={done(() => props.onFindPapers(text))}
            data-testid="block-menu-review-source"
          >
            Find a source for it
          </button>
          <p className="px-2.5 pt-0.5 pb-1 text-[11px] leading-snug text-muted">
            The three checks take one command each. Finding a source is free.
          </p>
        </div>
      ) : null}
      <div className="my-1 border-t border-line" />
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={done(() => editor.chain().focus().selectBlock(block.pos).moveBlock('up').run())}
        data-testid="block-menu-up"
      >
        Move up <span className="text-[11px] text-muted">Ctrl+Shift+↑</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={done(() => editor.chain().focus().selectBlock(block.pos).moveBlock('down').run())}
        data-testid="block-menu-down"
      >
        Move down <span className="text-[11px] text-muted">Ctrl+Shift+↓</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={done(() => editor.chain().focus().duplicateBlock(block.pos).run())}
        data-testid="block-menu-duplicate"
      >
        Duplicate
      </button>
      <button
        type="button"
        role="menuitem"
        className={`${item} text-warn`}
        onClick={done(() => editor.chain().focus().deleteBlock(block.pos).run())}
        data-testid="block-menu-delete"
      >
        Delete
      </button>
    </div>
  );
}
