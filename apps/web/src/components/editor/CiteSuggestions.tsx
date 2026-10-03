'use client';

/**
 * Citation suggestion — PRD FR-4.5, §9.3 `POST /citations/suggest`, PHASES 3.6.
 *
 *   "Never fires on every keystroke; at most once per sentence end."
 *
 * The trigger is deliberately quiet. It fires when the student finishes a sentence, and only when
 * that sentence looks like a claim, and never twice for the same sentence. Everything the model
 * offers is shown with the passage behind it, because the student is the one deciding whether the
 * source supports the claim; the model only narrows the field.
 */

import { newCitationKey } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Suggestion = {
  key: string;
  sourceId: string;
  chunkId: string;
  support: 'direct' | 'partial';
  why: string;
  passage: string;
  page: number | null;
  shortRef: string;
  rendered: string;
};

type Result = { suggestions: Suggestion[]; triggered: boolean };

/** Text of the block the cursor is in, up to the cursor. */
function textBeforeCursor(editor: Editor): string {
  const { from } = editor.state.selection;
  return editor.state.doc.textBetween(Math.max(0, from - 2_000), from, '\n', ' ');
}

/** The last finished sentence before the cursor, or null when the student is mid-sentence. */
function lastSentence(before: string): string | null {
  if (!/[.!?]["')\]]?\s*$/.test(before)) return null;
  const trimmed = before.trimEnd();
  const match = /(?:^|[.!?]["')\]]?\s+)([^.!?]*[.!?]["')\]]?)\s*$/.exec(trimmed);
  const sentence = match?.[1]?.trim() ?? trimmed;
  return sentence.length > 0 ? sentence : null;
}

export function CiteSuggestions({
  editor,
  chapterId,
  onUsageChange,
}: {
  editor: Editor | null;
  chapterId: string;
  onUsageChange: () => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sentence, setSentence] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sentences already asked about, so finishing one never asks twice (FR-4.5).
  const askedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);

  const dismiss = useCallback(() => {
    setSuggestions([]);
    setSentence(null);
    setError(null);
  }, []);

  const ask = useCallback(
    async (text: string) => {
      if (inFlightRef.current || askedRef.current.has(text)) return;
      inFlightRef.current = true;
      askedRef.current.add(text);
      try {
        const result = await api<Result>('/citations/suggest', {
          method: 'POST',
          body: JSON.stringify({ chapterId, sentence: text }),
        });
        // A sentence the heuristic declined, or a library with nothing to offer, is silence —
        // not a message. Nothing was charged and nothing needs saying.
        if (result.suggestions.length > 0) {
          setSuggestions(result.suggestions);
          setSentence(text);
          onUsageChange();
        }
      } catch (e) {
        if (e instanceof ApiError && e.problem.type === 'CAP_EXCEEDED') {
          setError(e.problem.detail ?? 'You have used this month’s citation suggestions.');
          setSentence(text);
        }
        // Any other failure stays silent: an unasked-for feature must not interrupt with an error.
      } finally {
        inFlightRef.current = false;
      }
    },
    [chapterId, onUsageChange],
  );

  useEffect(() => {
    if (!editor) return;

    const onKeyUp = (event: KeyboardEvent) => {
      // Only the keys that can finish a sentence, so this is not a per-keystroke call.
      if (event.key !== '.' && event.key !== '!' && event.key !== '?') return;
      const text = lastSentence(textBeforeCursor(editor));
      if (text) void ask(text);
    };

    const dom = editor.view.dom;
    dom.addEventListener('keyup', onKeyUp);
    return () => dom.removeEventListener('keyup', onKeyUp);
  }, [editor, ask]);

  function insert(suggestion: Suggestion) {
    if (!editor) return;
    // The node's key is its own; `suggestion.key` is the passage's id in this one request, and
    // reusing it as the node key made later suggestions overwrite this node's label (ADR-0045).
    const key = newCitationKey();
    const store = (editor.storage as { citation?: { renderedMap?: Record<string, string> } })
      .citation;
    if (store?.renderedMap) store.renderedMap[key] = suggestion.rendered;

    editor
      .chain()
      .focus()
      .insertCitation({
        key,
        sourceId: suggestion.sourceId,
        chunkId: suggestion.chunkId,
      })
      .run();
    dismiss();
  }

  if (!sentence) return null;

  return (
    <aside
      data-testid="cite-suggestions"
      className="fixed bottom-20 left-1/2 z-30 w-[34rem] -translate-x-1/2 rounded-md border border-line bg-surface p-3 shadow-lg"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-muted">
          {error ? 'Citation suggestions' : 'Sources that may support that sentence'}
        </p>
        <button type="button" className="text-xs underline" onClick={dismiss}>
          Dismiss
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-sm text-warn">{error}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {suggestions.map((suggestion) => (
            <li key={suggestion.key} className="rounded-md border border-line p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{suggestion.shortRef}</span>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                  {suggestion.support === 'direct' ? 'Supports it' : 'Partly supports it'}
                </span>
              </div>
              {suggestion.why ? <p className="mt-1 text-xs text-muted">{suggestion.why}</p> : null}
              <p className="mt-1 text-xs">
                {suggestion.page !== null ? `p. ${suggestion.page}: ` : ''}
                {suggestion.passage}
              </p>
              <button
                type="button"
                className="mt-2 rounded-md px-3 py-1 text-xs bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
                onClick={() => insert(suggestion)}
              >
                Insert citation
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
