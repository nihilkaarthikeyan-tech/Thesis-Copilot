'use client';

/**
 * The block menu (Jenni build plan R7), opened from the grip beside a paragraph
 * (`packages/ui/src/editor/block-handle.ts`). Every item reuses something that already exists:
 * Edit selects the block so the selection toolbar's edits apply (ADR-0066), Ask in chat and Find
 * a source are the toolbar's own actions, Review is the examiner review of a selection
 * (ADR-0067), Cite opens the `@` library picker at the paragraph's end — free, it cannot cite
 * anything the student has not added. The rest are editor commands that call no model.
 *
 * Submenus open in place rather than on hover, so the menu works the same on a touch screen.
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
import { useEffect, useRef, useState } from 'react';
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

export function BlockMenu(props: {
  editor: Editor | null;
  request: BlockMenuRequest | null;
  onClose: () => void;
  onAskChat: (text: string) => void;
  onFindPapers: (text: string) => void;
  onReview: (from: number, to: number) => void;
}) {
  const { editor, request, onClose } = props;
  const [open, setOpen] = useState<Open>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!request) return;
    setOpen(null);
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

  const top = Math.min(request.rect.top, window.innerHeight - 380);
  const left = Math.min(request.rect.right + 6, window.innerWidth - 248);
  const item =
    'flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-50';
  const sub = 'ml-3 border-l border-line pl-1';

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Block menu"
      data-testid="block-menu"
      className="fixed z-50 w-60 rounded-md border border-line bg-surface p-1 shadow-lg"
      style={{ top: Math.max(8, top), left: Math.max(8, left) }}
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
        Review <span className="text-muted">▸</span>
      </button>
      {open === 'review' ? (
        <div className={sub}>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={done(() => props.onReview(block.pos, block.pos + block.node.nodeSize))}
            data-testid="block-menu-review-examiner"
          >
            As an examiner
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={done(() => props.onFindPapers(text))}
            data-testid="block-menu-review-source"
          >
            Find a source for it
          </button>
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
