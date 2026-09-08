'use client';

/**
 * The Citations tab — PRD §6.2 right panel, PHASES 3.5.
 *
 * Every citation node in the chapter, in document order, with the label the server rendered and
 * the passage it stands on. The list follows the document (B.2: the node attrs are the only
 * citation state), so it re-reads on each transaction rather than keeping its own copy.
 */

import { applyCitationRole, type CitationRole, sentenceAroundCitation } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Entry = {
  key: string;
  sourceId: string | null;
  chunkId: string | null;
  label: string;
  /** FR-5.1: which form this citation is in, and so which one the button offers. */
  role: CitationRole;
};

/** FR-5.6's answer: the sentence as it would read, plus why it was refused if it was. */
type RoleRewrite = {
  sentence: string;
  targetRole: CitationRole;
  unchanged: boolean;
  refusal: string | null;
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
      role: (node.attrs.role as CitationRole) ?? 'parenthetical',
    });
  });
  return out;
}

export function CitationList({ editor, chapterId }: { editor: Editor | null; chapterId?: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [passages, setPassages] = useState<Record<string, Passage | 'missing'>>({});
  const [rewrite, setRewrite] = useState<{ key: string; result: RoleRewrite } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  /** FR-5.6. Asks for the rewrite; nothing reaches the chapter until Apply. */
  async function askForRole(entry: Entry, targetRole: CitationRole) {
    if (!editor || !chapterId) return;
    const range = sentenceAroundCitation(editor, entry.key);
    if (!range) {
      setError('That citation is no longer in the chapter.');
      return;
    }
    setBusy(entry.key);
    setError(null);
    try {
      const result = await api<RoleRewrite>('/citations/role', {
        method: 'POST',
        body: JSON.stringify({
          chapterId,
          citationId: entry.key,
          targetRole,
          sentence: range.text,
        }),
      });
      setRewrite({ key: entry.key, result });
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not rewrite that.',
      );
    } finally {
      setBusy(null);
    }
  }

  function applyRewrite(entry: Entry, result: RoleRewrite) {
    if (!editor) return;
    // Re-read the range: the student may have typed since the rewrite was asked for, and applying
    // over a stale range would replace the wrong words.
    const range = sentenceAroundCitation(editor, entry.key);
    if (!range) {
      setError('That sentence has changed. Ask again.');
      setRewrite(null);
      return;
    }
    applyCitationRole(
      editor,
      range,
      result.sentence,
      entry.key,
      result.targetRole,
      `cite-role-${entry.key}`,
    );
    setRewrite(null);
  }

  if (entries.length === 0) {
    return (
      <p>
        No citations in this chapter yet. Accept a suggestion that cites a source, or insert one.
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p role="alert" className="mb-2 text-xs text-warn">
          {error}
        </p>
      ) : null}
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

              {/* FR-5.6: the same claim in the other grammar. The sentence is rewritten, so it is
                shown first and applied only on request. */}
              {!orphan && chapterId ? (
                rewrite?.key === entry.key ? (
                  <div
                    className="mt-1 rounded-md border border-line bg-surface p-2 text-xs"
                    data-testid="cite-role-preview"
                  >
                    {rewrite.result.refusal ? (
                      <p className="text-warn">{rewrite.result.refusal}</p>
                    ) : rewrite.result.unchanged ? (
                      <p className="text-muted">It already reads that way — nothing to change.</p>
                    ) : (
                      <p>{rewrite.result.sentence.replace(/\{\{cite:[^}]+\}\}/g, entry.label)}</p>
                    )}
                    <div className="mt-2 flex justify-end gap-3">
                      <button type="button" className="underline" onClick={() => setRewrite(null)}>
                        Discard
                      </button>
                      <button
                        type="button"
                        disabled={rewrite.result.unchanged || Boolean(rewrite.result.refusal)}
                        onClick={() => applyRewrite(entry, rewrite.result)}
                        data-testid="cite-role-apply"
                        className="rounded-md bg-ink px-2 py-0.5 text-paper disabled:opacity-40"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void askForRole(
                        entry,
                        entry.role === 'narrative' ? 'parenthetical' : 'narrative',
                      )
                    }
                    data-testid="cite-role-button"
                    className="mt-0.5 text-xs text-muted underline disabled:opacity-50"
                  >
                    {busy === entry.key
                      ? 'Rewriting…'
                      : entry.role === 'narrative'
                        ? 'Move the source into brackets'
                        : 'Make the source the subject'}
                  </button>
                )
              ) : null}
              {open === entry.key && !orphan ? (
                <div className="mt-1 rounded-md border border-line bg-surface p-2 text-xs">
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
    </>
  );
}
