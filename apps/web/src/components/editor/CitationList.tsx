'use client';

/**
 * The Citations tab — PRD §6.2 right panel, PHASES 3.5.
 *
 * Every citation node in the chapter, in document order, with the label the server rendered and
 * the passage it stands on. The list follows the document (B.2: the node attrs are the only
 * citation state), so it re-reads on each transaction rather than keeping its own copy.
 */

import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Entry = {
  key: string;
  sourceId: string | null;
  chunkId: string | null;
  label: string;
};

type Passage = {
  text: string;
  page: number | null;
  section: string | null;
  source: { title: string | null; year: number | null };
  pdfUrl: string | null;
};

function entriesOf(editor: Editor): Entry[] {
  const renderedMap =
    (editor.storage as { citation?: { renderedMap?: Record<string, string> } }).citation
      ?.renderedMap ?? {};
  const out: Entry[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'citation') return;
    const key = String(node.attrs.key);
    out.push({
      key,
      sourceId: (node.attrs.sourceId as string | null) ?? null,
      chunkId: (node.attrs.chunkId as string | null) ?? null,
      label: renderedMap[key] ?? '(Source)',
    });
  });
  return out;
}

export function CitationList({ editor }: { editor: Editor | null }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [passages, setPassages] = useState<Record<string, Passage | 'missing'>>({});

  useEffect(() => {
    if (!editor) return;
    const refresh = () => setEntries(entriesOf(editor));
    refresh();
    editor.on('transaction', refresh);
    return () => {
      editor.off('transaction', refresh);
    };
  }, [editor]);

  async function toggle(entry: Entry) {
    const next = open === entry.key ? null : entry.key;
    setOpen(next);
    if (!next || passages[entry.key] || !entry.sourceId || !entry.chunkId) return;
    try {
      const passage = await api<Passage>(`/sources/${entry.sourceId}/chunks/${entry.chunkId}`);
      setPassages((prev) => ({ ...prev, [entry.key]: passage }));
    } catch {
      setPassages((prev) => ({ ...prev, [entry.key]: 'missing' }));
    }
  }

  if (entries.length === 0) {
    return (
      <p>
        No citations in this chapter yet. Accept a suggestion that cites a source, or insert one.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {entries.map((entry, index) => {
        const passage = passages[entry.key];
        const orphan = entry.sourceId === null;
        return (
          // Keys are unique by construction, but a paste inside the chapter can repeat one; the list
          // is positional and follows the document, so the index is the honest tiebreaker.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional list that mirrors the document
          <li key={`${entry.key}-${index}`} className="text-ink">
            <button
              type="button"
              className="flex w-full items-baseline gap-2 text-left hover:underline"
              onClick={() => void toggle(entry)}
              disabled={orphan}
            >
              <span className="text-xs text-muted">{index + 1}.</span>
              <span className={orphan ? 'text-warn line-through' : ''}>{entry.label}</span>
            </button>
            {orphan ? (
              <p className="text-xs text-warn">Its source was removed from the library.</p>
            ) : null}
            {open === entry.key && !orphan ? (
              <div className="mt-1 rounded-md border border-line bg-white p-2 text-xs">
                {passage === undefined ? (
                  <p className="text-muted">Loading the passage…</p>
                ) : passage === 'missing' ? (
                  <p className="text-muted">That passage is no longer available.</p>
                ) : (
                  <>
                    <p className="text-muted">
                      {[
                        passage.source.title,
                        passage.source.year,
                        passage.page !== null ? `p. ${passage.page}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="mt-1">{passage.text}</p>
                    {passage.pdfUrl ? (
                      <a
                        className="mt-1 inline-block underline"
                        href={
                          passage.page !== null
                            ? `${passage.pdfUrl}#page=${passage.page}`
                            : passage.pdfUrl
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {passage.page !== null ? `Open PDF at page ${passage.page}` : 'Open PDF'}
                      </a>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
