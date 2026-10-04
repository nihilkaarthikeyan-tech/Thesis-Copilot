'use client';

/**
 * The open chapter's own headings, under its name in the chapter list (2026-10-04, from the Jenni
 * study, coverage-map row 73: Jenni keeps a table of contents beside the text; ours showed only the
 * chapter names). Read live from the editor, so a heading typed a second ago is already listed;
 * pressing one moves the cursor there and scrolls to it.
 */

import type { Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';

type Entry = { pos: number; level: number; text: string };

/** Level-2 and level-3 headings with text. Level 1 is the chapter title, listed above already. */
export function chapterHeadings(editor: Editor): Entry[] {
  const out: Entry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = Number(node.attrs.level);
      const text = node.textContent.trim();
      if (level >= 2 && text) out.push({ pos, level, text });
      return false;
    }
    return true;
  });
  return out;
}

const sameEntries = (a: Entry[], b: Entry[]) =>
  a.length === b.length &&
  a.every((e, i) => e.pos === b[i]?.pos && e.text === b[i]?.text && e.level === b[i]?.level);

export function ChapterContents({ editor }: { editor: Editor | null }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const next = chapterHeadings(editor);
      setEntries((current) => (sameEntries(current, next) ? current : next));
    };
    update();
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor]);

  if (!editor || entries.length === 0) return null;

  return (
    <ul className="mt-1 mb-1 grid list-none gap-0.5 p-0 pl-3" data-testid="chapter-contents">
      {entries.map((entry) => (
        <li key={`${entry.pos}-${entry.text}`}>
          <button
            type="button"
            onClick={() =>
              editor
                .chain()
                .focus()
                .setTextSelection(entry.pos + 1)
                .scrollIntoView()
                .run()
            }
            className={`block w-full truncate text-left text-[12px] text-muted hover:text-ink ${
              entry.level === 3 ? 'pl-3' : ''
            }`}
            title={entry.text}
          >
            {entry.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
