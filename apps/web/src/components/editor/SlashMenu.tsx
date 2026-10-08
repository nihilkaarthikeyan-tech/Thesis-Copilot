'use client';

/**
 * The "/" insert menu on screen (2026-10-04, JENNI-STUDENT-JOURNEY step 6).
 *
 * `@tc/ui`'s `SlashMenu` extension notices the "/", filters the items and takes the keys; this
 * draws the list under the caret and does what each item means. Every item reuses something the
 * editor already does — the toolbar's commands, its equation and footnote field, its file picker,
 * the chart and diagram dialogs — so a block inserted from here is the same block the toolbar
 * would have inserted. Two are new: the AI declaration (ordinary text to edit, item 24) and the
 * "citation needed" marker, which is the needs-source note the export already prints visibly and
 * the citation report lists. R28 (ADR-0119) added the horizontal rule and the contents block.
 */

import {
  attachSlashMenu,
  chooseSlashItem,
  getSlashMenuState,
  SLASH_ITEMS,
  type SlashMenuState,
} from '@tc/ui';
import type { Editor } from '@tiptap/react';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { aiDeclarationContent } from '@/lib/ai-declaration';
import { cn } from '@/lib/utils';
import type { FormatActions } from './FormatToolbar';

const LISTBOX_ID = 'slash-menu-list';
const optionId = (id: string) => `slash-menu-${id}`;

export function SlashMenu({
  editor,
  actionsRef,
  canInsertFigure,
  onInsertChart,
  onInsertDiagram,
}: {
  editor: Editor | null;
  actionsRef: RefObject<FormatActions | null>;
  canInsertFigure: boolean;
  onInsertChart?: () => void;
  onInsertDiagram?: () => void;
}) {
  const [menu, setMenu] = useState<SlashMenuState>({ active: false });
  const [focused, setFocused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // The latest callbacks, read when an item is chosen, so attaching does not depend on them.
  const handlers = useRef({ onInsertChart, onInsertDiagram });
  handlers.current = { onInsertChart, onInsertDiagram };

  const items = useMemo(
    () =>
      SLASH_ITEMS.filter(
        (item) =>
          (item.id !== 'figure' || canInsertFigure) &&
          (item.id !== 'chart' || Boolean(onInsertChart)) &&
          (item.id !== 'diagram' || Boolean(onInsertDiagram)),
      ),
    [canInsertFigure, onInsertChart, onInsertDiagram],
  );

  useEffect(() => {
    if (!editor) return;
    const run = (id: string) => {
      const chain = editor.chain().focus();
      switch (id) {
        case 'heading':
          chain.setHeading({ level: 2 }).run();
          break;
        case 'subheading':
          chain.setHeading({ level: 3 }).run();
          break;
        case 'bulletList':
          chain.toggleBulletList().run();
          break;
        case 'orderedList':
          chain.toggleOrderedList().run();
          break;
        case 'quote':
          chain.setParagraph().toggleBlockquote().run();
          break;
        // R28 (ADR-0119): both print in every export.
        case 'horizontalRule':
          chain.setHorizontalRule().run();
          break;
        case 'tableOfContents':
          chain.insertTableOfContents().run();
          break;
        case 'table':
          chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
        case 'mathInline':
          actionsRef.current?.insertMath('inline');
          break;
        case 'mathBlock':
          actionsRef.current?.insertMath('block');
          break;
        case 'footnote':
          actionsRef.current?.footnote();
          break;
        case 'figure':
          actionsRef.current?.pickFigure?.();
          break;
        case 'chart':
          handlers.current.onInsertChart?.();
          break;
        case 'diagram':
          handlers.current.onInsertDiagram?.();
          break;
        case 'aiDeclaration':
          chain.insertContent(aiDeclarationContent()).run();
          break;
        case 'citationNeeded':
          chain
            .insertContent([
              { type: 'needsSourceNote', attrs: { text: 'citation needed' } },
              { type: 'text', text: ' ' },
            ])
            .run();
          break;
      }
    };
    return attachSlashMenu(editor, items, run);
  }, [editor, items, actionsRef]);

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      setMenu(getSlashMenuState(editor.state));
      setFocused(editor.isFocused);
    };
    sync();
    editor.on('transaction', sync);
    editor.on('focus', sync);
    editor.on('blur', sync);
    return () => {
      editor.off('transaction', sync);
      editor.off('focus', sync);
      editor.off('blur', sync);
    };
  }, [editor]);

  const open = Boolean(editor?.isEditable) && focused && menu.active;
  const highlighted = menu.active ? menu.items[menu.index] : undefined;

  // The editor is the combobox: screen readers hear the highlighted row as the caret stays put.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    if (open && highlighted) {
      dom.setAttribute('aria-expanded', 'true');
      dom.setAttribute('aria-controls', LISTBOX_ID);
      dom.setAttribute('aria-activedescendant', optionId(highlighted.id));
    } else {
      dom.removeAttribute('aria-expanded');
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-activedescendant');
    }
  }, [editor, open, highlighted]);

  useEffect(() => {
    if (!open || !highlighted) return;
    listRef.current
      ?.querySelector(`#${optionId(highlighted.id)}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted]);

  if (!editor || !open || !menu.active || typeof document === 'undefined') return null;

  let coords: { left: number; bottom: number; top: number };
  try {
    coords = editor.view.coordsAtPos(menu.from);
  } catch {
    return null;
  }
  const width = 288;
  const left = Math.max(8, Math.min(coords.left, window.innerWidth - width - 8));
  // Below the line, or above it when the line is near the bottom of the window.
  const below = coords.bottom + 320 < window.innerHeight;
  const style = below
    ? { left, top: coords.bottom + 6, width }
    : { left, bottom: window.innerHeight - coords.top + 6, width };

  return createPortal(
    <div
      data-testid="slash-menu"
      style={style}
      className="fixed z-50 rounded-md border border-line bg-surface p-1 shadow-lg"
    >
      <div
        ref={listRef}
        id={LISTBOX_ID}
        role="listbox"
        aria-label="Insert"
        className="max-h-72 overflow-y-auto"
      >
        {menu.items.map((item, i) => (
          <div
            key={item.id}
            id={optionId(item.id)}
            role="option"
            aria-selected={i === menu.index}
            tabIndex={-1}
            data-testid={`slash-item-${item.id}`}
            // The caret must stay in the document, or there is nothing to insert at.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chooseSlashItem(editor, item.id)}
            onKeyDown={() => undefined}
            className={cn(
              'flex cursor-pointer flex-col rounded px-2.5 py-1.5 text-left',
              i === menu.index ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-sunk',
            )}
          >
            <span className="text-[13px] font-medium">{item.title}</span>
            {item.hint ? <span className="text-[11.5px] text-muted">{item.hint}</span> : null}
          </div>
        ))}
      </div>
      <p className="border-t border-line px-2.5 pb-0.5 pt-1.5 text-[11px] text-faint">
        ↑ ↓ to move · Enter to insert · Esc to close
      </p>
    </div>,
    document.body,
  );
}
