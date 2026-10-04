'use client';

/**
 * The suggestion bar: what to do with a suggestion, on screen (2026-10-04, from the Jenni study).
 *
 * A suggestion could only be kept with Tab or →, so on a phone — no Tab key — it could be read but
 * never kept, and on a laptop the student had to know the keys. Jenni shows Accept / Refine under
 * every suggestion. This does the same with our commands, and adds refine presets.
 *
 * A preset is a guided suggestion (Shift+→) with the instruction written for the student: the same
 * A.1 path, the same grounding rules, no new prompt. Asking again uses one Assist suggestion, as
 * every suggestion does, so the menu says so.
 */

import {
  type CitationPassage,
  getGhostState,
  type SuggestionCitation,
  sourceMetricBadges,
} from '@tc/ui';
import type { Editor } from '@tiptap/react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** The presets: each is an instruction the guided suggestion already accepts. */
export const REFINE_PRESETS: Array<{ label: string; instruction: string }> = [
  { label: 'Shorter', instruction: 'Make it shorter: the same point in fewer words.' },
  { label: 'More formal', instruction: 'Use a more formal academic register.' },
  {
    label: 'Stay closer to my topic',
    instruction: 'Stay strictly on the topic of this paragraph and this chapter.',
  },
  {
    label: 'Complete this paragraph',
    instruction: 'Finish the current paragraph rather than starting a new point.',
  },
  {
    label: 'A contrasting finding',
    instruction:
      'Give a finding from the sources that contrasts with or qualifies the previous sentence, if one exists.',
  },
];

/** `{{cite:KEY}}` markers in the streamed text; the revised suggestion cites afresh. */
const CITE_MARKER = /\{\{cite:[^}]+\}\}/g;

type Status = 'idle' | 'requesting' | 'streaming' | 'shown' | string;

type HistoryEntry = { suggestionId: string; text: string; citations: SuggestionCitation[] };
/**
 * Earlier suggestions at the same place (2026-10-04, from the Jenni study). Jenni keeps the
 * suggestions it has offered and steps between them with arrows; a refined suggestion here used to
 * replace the one before it for good. Kept in the page only, for the one cursor position.
 */
type History = { anchor: number | null; entries: HistoryEntry[]; index: number };
const NO_HISTORY: History = { anchor: -1, entries: [], index: -1 };

export function SuggestionBar({
  editor,
  onRefine,
  resolvePassage,
}: {
  editor: Editor | null;
  /** Asks the student for their own instruction (the guided input) and resolves with it. */
  onRefine: () => Promise<string | null>;
  /** The passage behind a citation, the same lookup as the hover card on a placed citation. */
  resolvePassage: (sourceId: string, chunkId: string | null) => Promise<CitationPassage | null>;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [menu, setMenu] = useState(false);
  const [citations, setCitations] = useState<SuggestionCitation[]>([]);
  const [history, setHistory] = useState<History>(NO_HISTORY);
  /**
   * Thumbs on a suggestion (2026-10-04, from the Jenni study), kept apart from whether it was
   * kept: a suggestion can be dismissed and still have been useful to read. No model call.
   */
  const [ratings, setRatings] = useState<Record<string, 1 | -1>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  /**
   * The evidence card (2026-10-04, from the Jenni study): the paper and the passage behind a
   * suggested citation, readable before the suggestion is accepted, not only after.
   */
  const [evidence, setEvidence] = useState<{
    key: string;
    passage: CitationPassage | null;
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const ghost = getGhostState(editor);
      setStatus(ghost?.status ?? 'idle');
      setCitations(ghost?.citations ?? []);
      setCurrentId(ghost?.suggestionId ?? null);
      if (ghost?.status !== 'shown' || !ghost.suggestionId) return;
      const { suggestionId, anchorPos, text } = ghost;
      setHistory((h) => {
        const at = h.entries.findIndex((e) => e.suggestionId === suggestionId);
        if (at >= 0) return at === h.index ? h : { ...h, index: at };
        // A suggestion somewhere else starts a new history; one word kept moves the anchor too.
        const entries = h.anchor === anchorPos ? h.entries : [];
        const entry = { suggestionId, text, citations: ghost.citations ?? [] };
        return { anchor: anchorPos, entries: [...entries, entry], index: entries.length };
      });
    };
    update();
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  useEffect(() => {
    if (status === 'idle') {
      setMenu(false);
      setEvidence(null);
    }
  }, [status]);

  if (!editor) return null;
  if (status === 'idle') {
    // On a phone the Suggest button at the foot of the chapter is below the screen, under
    // everything the student has written (2026-10-04, found at 390 px wide). This one floats
    // above the tab bar, and only while no suggestion is showing.
    return (
      <button
        type="button"
        data-testid="suggest-floating"
        aria-label="Suggest a continuation"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().requestSuggestion().run()}
        className="fixed right-4 bottom-16 z-30 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink shadow-lg hover:bg-accent-hover lg:hidden"
      >
        Suggest
      </button>
    );
  }

  const ask = (instruction: string) => {
    setMenu(false);
    // The model never sees a dismissed suggestion, so "shorter" alone meant nothing to it and it
    // wrote nothing (2026-10-04). The preset carries the text it revises, citation markers out.
    const current = (getGhostState(editor)?.text ?? '').replace(CITE_MARKER, '').trim();
    editor.commands.dismissSuggestion();
    editor.commands.requestSuggestion(
      current
        ? `${instruction}\n\nRevise this suggestion: "${current.slice(0, 900)}"`
        : instruction,
    );
  };

  const shown = status === 'shown';
  const rating = currentId ? ratings[currentId] : undefined;
  const rate = (value: 1 | -1) => {
    if (!currentId) return;
    const id = currentId;
    const next = rating === value ? 0 : value;
    const before = ratings;
    setRatings((r) => {
      const copy = { ...r };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
    void api('/assist/rating', {
      method: 'POST',
      body: JSON.stringify({ suggestionId: id, rating: next }),
    }).catch(() => setRatings(before));
  };
  const step = (delta: number) => {
    const target = history.entries[history.index + delta];
    if (!target) return;
    editor.commands.dismissSuggestion();
    editor.commands.restoreSuggestion(target);
  };
  // One chip per paper: two passages of the same paper are one source to the student.
  const chips = citations.filter(
    (c, i) => c.sourceId && citations.findIndex((d) => d.sourceId === c.sourceId) === i,
  );
  const openEvidence = (citation: SuggestionCitation) => {
    if (evidence?.key === citation.key) {
      setEvidence(null);
      return;
    }
    setEvidence({ key: citation.key, passage: null, loading: true });
    void resolvePassage(citation.sourceId ?? '', citation.chunkId).then((passage) =>
      setEvidence((current) =>
        current?.key === citation.key ? { key: citation.key, passage, loading: false } : current,
      ),
    );
  };
  const button =
    'rounded-md border border-line px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-sunk disabled:opacity-40';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 lg:bottom-6">
      <div
        data-testid="suggestion-bar"
        className="pointer-events-auto relative flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 shadow-lg"
      >
        <span className="text-[12px] text-muted">{shown ? 'Suggestion' : 'Writing…'}</span>
        {shown && history.entries.length > 1 ? (
          <span className="flex items-center gap-0.5" data-testid="suggestion-history">
            <button
              type="button"
              aria-label="Previous suggestion"
              disabled={history.index <= 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => step(-1)}
              className="rounded px-1.5 py-0.5 text-[13px] hover:bg-sunk disabled:opacity-40"
            >
              ‹
            </button>
            <span className="text-[11.5px] tabular-nums text-muted">
              {history.index + 1} of {history.entries.length}
            </span>
            <button
              type="button"
              aria-label="Next suggestion"
              disabled={history.index >= history.entries.length - 1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => step(1)}
              className="rounded px-1.5 py-0.5 text-[13px] hover:bg-sunk disabled:opacity-40"
            >
              ›
            </button>
          </span>
        ) : null}
        {shown && chips.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1" data-testid="suggestion-evidence">
            <span className="text-[11px] text-muted">Evidence:</span>
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-expanded={evidence?.key === c.key}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => openEvidence(c)}
                className="rounded bg-accent/10 px-1.5 py-0.5 text-[11.5px] text-accent underline"
              >
                {c.rendered || 'source'}
              </button>
            ))}
          </span>
        ) : null}
        <button
          type="button"
          disabled={!shown}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.acceptSuggestion()}
          className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-ink disabled:opacity-40"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={!shown}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.acceptSuggestionWord()}
          className={button}
        >
          One word
        </button>
        <button
          type="button"
          disabled={!shown}
          aria-expanded={menu}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenu((open) => !open)}
          className={button}
        >
          Refine
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.dismissSuggestion()}
          className={button}
        >
          Dismiss
        </button>
        {shown && currentId ? (
          <span className="flex items-center gap-0.5" data-testid="suggestion-rating">
            <button
              type="button"
              aria-label="Useful suggestion"
              aria-pressed={rating === 1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => rate(1)}
              className={`rounded p-1.5 hover:bg-sunk ${rating === 1 ? 'text-accent' : 'text-muted'}`}
            >
              <ThumbsUp size={14} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Not a useful suggestion"
              aria-pressed={rating === -1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => rate(-1)}
              className={`rounded p-1.5 hover:bg-sunk ${rating === -1 ? 'text-accent' : 'text-muted'}`}
            >
              <ThumbsDown size={14} aria-hidden />
            </button>
          </span>
        ) : null}
        {evidence ? (
          <div
            data-testid="evidence-card"
            className="absolute bottom-full left-0 mb-2 w-[min(32rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-3 text-[13px] shadow-lg"
          >
            {evidence.loading ? (
              <p className="text-muted">Opening the passage…</p>
            ) : !evidence.passage ? (
              <p className="text-muted">This passage could not be opened.</p>
            ) : (
              <>
                <p className="font-semibold">
                  {evidence.passage.record?.title ?? evidence.passage.shortRef}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {[
                    evidence.passage.record?.authors,
                    evidence.passage.record?.year,
                    evidence.passage.record?.venue,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="mt-1 text-[11.5px]">
                  {evidence.passage.record?.grounding === 'FULL_TEXT'
                    ? 'We hold the full text of this paper.'
                    : evidence.passage.record?.grounding === 'ABSTRACT'
                      ? 'We hold only the abstract of this paper.'
                      : null}
                </p>
                {evidence.passage.record ? (
                  <p className="mt-1 flex flex-wrap gap-1" data-testid="evidence-badges">
                    {sourceMetricBadges(evidence.passage.record).map((b) => (
                      <span
                        key={b.kind}
                        title={b.title}
                        className="rounded bg-sunk px-1.5 py-0.5 text-[11px] text-muted"
                      >
                        {b.label}
                      </span>
                    ))}
                  </p>
                ) : null}
                <blockquote className="mt-2 max-h-40 overflow-y-auto border-l-2 border-accent/40 pl-2 text-[12.5px]">
                  “{evidence.passage.text.slice(0, 600)}
                  {evidence.passage.text.length > 600 ? '…' : ''}”
                </blockquote>
                <p className="mt-1 text-[11.5px] text-muted">
                  {[
                    evidence.passage.section,
                    evidence.passage.page ? `page ${evidence.passage.page}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  {evidence.passage.pdfUrl ? (
                    <>
                      {' · '}
                      <a
                        href={`${evidence.passage.pdfUrl}${evidence.passage.page ? `#page=${evidence.passage.page}` : ''}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        Open PDF
                      </a>
                    </>
                  ) : null}
                </p>
              </>
            )}
          </div>
        ) : null}
        {menu ? (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-64 rounded-md border border-line bg-surface p-2 shadow-lg"
          >
            {REFINE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => ask(preset.instruction)}
                className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-sunk"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setMenu(false);
                editor.commands.dismissSuggestion();
                void onRefine().then((instruction) => {
                  if (instruction && !editor.isDestroyed) {
                    editor.commands.requestSuggestion(instruction);
                  }
                });
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-sunk"
            >
              Your own instruction…
            </button>
            <p className="mt-1 px-2 text-[11px] text-muted">
              Each refined suggestion uses one of your Assist suggestions.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
