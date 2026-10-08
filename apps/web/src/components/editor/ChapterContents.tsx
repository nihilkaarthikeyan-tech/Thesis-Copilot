'use client';

/**
 * The open chapter's sections, under its name in the chapter list — Jenni's Sections panel
 * (Jenni build plan R10, ADR-0097; before it, coverage-map row 73's table of contents).
 *
 * Read live from the editor, so a heading typed a second ago is already listed. Each section opens
 * to show its note — what it should argue, the same note Assist and Draft read — which can be
 * written or changed in place (`PUT /documents/:id/outline/section-note`; a heading the plan does
 * not have becomes a section of the chapter), and two actions: **Draft** (the cursor in that
 * section, then Draft mode — a pending block the student accepts) and **Sources** (the cursor in
 * that section, then the Sources tab, where its own pins are). Nothing here calls a model.
 */

import { headingKey, type OutlineNode, walkOutline } from '@tc/types';
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { sectionEnd } from '@/lib/section-guide';
import { DRAFT_SECTION_EVENT } from './DraftMode';

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

type OutlineView = {
  outline: OutlineNode[];
  chapters: Array<{ id: string; outlineNodeId: string }>;
};

/** The notes of this chapter's sections, by heading key. */
function notesFor(view: OutlineView | null, chapterId: string): Map<string, string> {
  const notes = new Map<string, string>();
  const row = view?.chapters.find((c) => c.id === chapterId);
  const node = row
    ? walkOutline(view?.outline ?? []).find((n) => n.id === row.outlineNodeId)
    : null;
  for (const section of walkOutline(node?.children ?? [])) {
    notes.set(headingKey(section.title), section.scopeNote);
  }
  return notes;
}

export function ChapterContents({
  editor,
  documentId,
  chapterId,
  onShowSources,
}: {
  editor: Editor | null;
  documentId: string;
  chapterId: string;
  /** Opens the Sources tab (the cursor is already in the section). */
  onShowSources: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [view, setView] = useState<OutlineView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const load = useCallback(
    () =>
      api<OutlineView>(`/documents/${documentId}/outline`)
        .then(setView)
        .catch(() => undefined),
    [documentId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (!editor || entries.length === 0) return null;
  const notes = notesFor(view, chapterId);

  /** The cursor at the end of the section under the heading at `pos`. */
  const intoSection = (pos: number) => {
    const end = sectionEnd(editor.state.doc, pos);
    editor
      .chain()
      .focus()
      .setTextSelection(Math.max(pos + 1, end - 1))
      .scrollIntoView()
      .run();
  };

  async function save(entry: Entry) {
    setSaving(true);
    setError(null);
    try {
      await api(`/documents/${documentId}/outline/section-note`, {
        method: 'PUT',
        body: JSON.stringify({ chapterId, title: entry.text, scopeNote: draft }),
      });
      await load();
      setEditing(null);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'The note was not saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    // grid-cols-1 (minmax(0, 1fr)) so a long section title truncates inside the rail instead of
    // widening it (2026-10-08).
    <ul
      className="mt-1 mb-1 grid list-none grid-cols-1 gap-0.5 p-0 pl-3"
      data-testid="chapter-contents"
    >
      {entries.map((entry) => {
        const id = `${entry.pos}-${entry.text}`;
        const key = headingKey(entry.text);
        const note = notes.get(key) ?? '';
        const isOpen = open === key;
        return (
          <li
            key={id}
            className={entry.level === 3 ? 'min-w-0 pl-3' : 'min-w-0'}
            data-testid="section-entry"
          >
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={isOpen ? `Close ${entry.text}` : `Open ${entry.text}`}
                onClick={() => {
                  setOpen(isOpen ? null : key);
                  setEditing(null);
                  setError(null);
                }}
                className="w-3 shrink-0 text-[10px] text-faint hover:text-ink"
                data-testid="section-toggle"
              >
                {isOpen ? '▾' : '▸'}
              </button>
              <button
                type="button"
                data-testid="section-go"
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .setTextSelection(entry.pos + 1)
                    .scrollIntoView()
                    .run()
                }
                className="block min-w-0 flex-1 truncate text-left text-[12px] text-muted hover:text-ink"
                title={entry.text}
              >
                {entry.text}
              </button>
            </span>
            {isOpen ? (
              <div className="mt-1 mb-2 ml-4 text-[12px]" data-testid="section-panel">
                {editing === key ? (
                  <>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      maxLength={2000}
                      aria-label={`What "${entry.text}" should argue`}
                      className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px] text-ink"
                      data-testid="section-note-input"
                    />
                    {error ? (
                      <p role="alert" className="text-[11px] text-warn">
                        {error}
                      </p>
                    ) : null}
                    <span className="mt-1 flex gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void save(entry)}
                        className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink disabled:opacity-50"
                        data-testid="section-note-save"
                      >
                        {saving ? 'Saving…' : 'Save note'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="text-[11px] text-muted underline"
                      >
                        Cancel
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <p
                      className={note ? 'text-muted' : 'italic text-faint'}
                      data-testid="section-note"
                    >
                      {note ||
                        'No note yet: say what this section should argue, and suggestions and drafts here will follow it.'}
                    </p>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => {
                          setDraft(note);
                          setEditing(key);
                        }}
                        data-testid="section-note-edit"
                      >
                        {note ? 'Edit note' : 'Add a note'}
                      </button>
                      <button
                        type="button"
                        className="font-semibold underline"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          intoSection(entry.pos);
                          editor.view.dom.dispatchEvent(new CustomEvent(DRAFT_SECTION_EVENT));
                        }}
                        data-testid="section-draft"
                      >
                        Draft
                      </button>
                      <button
                        type="button"
                        className="underline"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          intoSection(entry.pos);
                          onShowSources();
                        }}
                        data-testid="section-sources"
                      >
                        Sources
                      </button>
                    </span>
                  </>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
