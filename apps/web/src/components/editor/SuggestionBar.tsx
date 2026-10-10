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
  type CiteMode,
  getGhostState,
  type SuggestionCitation,
  sourceMetricBadges,
} from '@tc/ui';
import type { Editor } from '@tiptap/react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessageKey } from '@/i18n';
import { useT } from '@/i18n/react';
import { api } from '@/lib/api';

/**
 * The presets: each is an instruction the guided suggestion already accepts. Jenni build plan R3
 * added Jenni's novelty, simplify and citation presets; `citeMode` makes "without citations" and
 * "from my library" hold in code, not only in the instruction.
 */
export const REFINE_PRESETS: Array<{ label: string; instruction: string; citeMode?: CiteMode }> = [
  // Write
  {
    label: 'Complete this paragraph',
    instruction: 'Finish the current paragraph rather than starting a new point.',
  },
  {
    label: 'Stay closer to my topic',
    instruction: 'Stay strictly on the topic of this paragraph and this chapter.',
  },
  {
    label: 'A contrasting finding',
    instruction:
      'Give a finding from the sources that contrasts with or qualifies the previous sentence, if one exists.',
  },
  // Refine
  { label: 'Shorter', instruction: 'Make it shorter: the same point in fewer words.' },
  { label: 'More formal', instruction: 'Use a more formal academic register.' },
  {
    label: 'Increase novelty',
    instruction:
      'Make the point less obvious: bring out a specific finding, a less-discussed angle or a limitation that the passages report, instead of a general statement.',
  },
  {
    label: 'Simplify language',
    instruction:
      'Use plainer words and shorter sentences. Keep the meaning, the claims and the citations exactly.',
  },
  {
    label: 'Validate supporting evidence',
    instruction:
      'Check each claim against the passage it cites. Keep only what the cited passage actually says; reword any claim that goes beyond it so it matches the passage, and cite the passage that supports it. Leave out a claim no passage supports.',
  },
  {
    label: 'Cite from my library',
    instruction:
      "Support the point with the passages given, which come from the student's own library, and cite them.",
    citeMode: 'library',
  },
  {
    label: 'Re-write without citations',
    instruction:
      'Write the same point without citing any source and without naming any author or study.',
    citeMode: 'none',
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

/**
 * What each preset's button says on screen (ADR-0061). The preset's `instruction` is what the
 * model reads and stays in English whatever the interface language is.
 */
/** R3: the menu's group headings, keyed by the index of the first preset in each (Jenni's order). */
const REFINE_GROUP_AT: Record<number, MessageKey> = {
  0: 'suggest.group.write',
  3: 'suggest.group.refine',
  7: 'suggest.group.citations',
};

const REFINE_LABEL: Record<string, MessageKey> = {
  Shorter: 'suggest.preset.shorter',
  'More formal': 'suggest.preset.formal',
  'Stay closer to my topic': 'suggest.preset.onTopic',
  'Complete this paragraph': 'suggest.preset.complete',
  'A contrasting finding': 'suggest.preset.contrast',
  'Increase novelty': 'suggest.preset.novelty',
  'Simplify language': 'suggest.preset.simplify',
  'Validate supporting evidence': 'suggest.preset.validate',
  'Cite from my library': 'suggest.preset.library',
  'Re-write without citations': 'suggest.preset.noCite',
};

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
  const { t } = useT();
  const [status, setStatus] = useState<Status>('idle');
  const [menu, setMenu] = useState(false);
  const [citations, setCitations] = useState<SuggestionCitation[]>([]);
  const [history, setHistory] = useState<History>(NO_HISTORY);
  /**
   * R3: the suggestion a refinement replaced. When the refinement brings nothing back — refused
   * ("Cite from my library" with nothing of the student's own on the sentence), empty or failed —
   * it is shown again, so asking to refine never costs the student the suggestion they had.
   */
  const fallbackRef = useRef<HistoryEntry | null>(null);
  const historyRef = useRef<History>(NO_HISTORY);
  historyRef.current = history;
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
      if ((ghost?.status ?? 'idle') === 'idle' && fallbackRef.current) {
        const back = fallbackRef.current;
        fallbackRef.current = null;
        // Not inside this transaction's own dispatch.
        setTimeout(() => {
          if (!editor.isDestroyed) editor.commands.restoreSuggestion(back);
        }, 0);
        return;
      }
      if (ghost?.status !== 'shown' || !ghost.suggestionId) return;
      fallbackRef.current = null;
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
  // ADR-0150: a refined suggestion is a new one; the card for the old one closes with it. (A
  // refine dismisses and requests in one tick, so `status` never passes through `idle` here.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the suggestion changes.
  useEffect(() => {
    setEvidence(null);
    setMenu(false);
  }, [currentId]);

  /**
   * ADR-0150: the bar sits under the suggestion's last line, not over the paragraph it belongs
   * to (side-by-side 2026-10-10, `ours-1g`: it floated at the foot of the window, over the text).
   * Measured from the ghost span itself, again on every scroll, resize and transaction; above the
   * first line when there is no room below; the old place at the foot of the window only when the
   * suggestion is off screen. `popDown`: whether a card or menu opens downward, away from the
   * text, or upward because the window ends.
   */
  const barRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{
    top: number;
    left: number;
    popDown: boolean;
    room: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!editor || status === 'idle') {
      setPlace(null);
      return;
    }
    const measure = () => {
      const bar = barRef.current;
      if (!bar || editor.isDestroyed) return;
      const { view } = editor;
      const ghost = view.dom.querySelector('span.ghost');
      const rects = ghost
        ? Array.from(ghost.getClientRects()).filter((r) => r.width > 0 || r.height > 0)
        : [];
      let first = rects[0] ?? null;
      let last = rects[rects.length - 1] ?? null;
      if (!first || !last) {
        // Nothing drawn yet (requesting): the caret the suggestion will start at.
        const anchor = getGhostState(editor)?.anchorPos ?? null;
        if (anchor !== null) {
          try {
            const c = view.coordsAtPos(anchor);
            first = last = new DOMRect(c.left, c.top, 1, c.bottom - c.top);
          } catch {
            // The position is stale for this document; fall back below.
          }
        }
      }
      if (!first || !last) {
        setPlace(null);
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const GAP = 8;
      const EDGE = 16;
      const h = bar.offsetHeight;
      const w = bar.offsetWidth;
      // Lined up with the paragraph's left edge, not with the last word.
      const block = ghost?.closest('p, h1, h2, h3, h4, li, td, th, blockquote') ?? null;
      const column = (block ?? view.dom).getBoundingClientRect();
      const left = Math.max(EDGE, Math.min(column.left, vw - w - EDGE));
      let top = last.bottom + GAP;
      if (top + h > vh - GAP) top = first.top - GAP - h;
      if (top < GAP || last.bottom < 0 || first.top > vh) {
        setPlace(null);
        return;
      }
      // Downward when there is more room below the bar than above it; either way the popover is
      // held to the room it has (`room`) and scrolls inside, so it never runs off the window.
      const below = vh - (top + h) - 2 * GAP;
      const above = top - 2 * GAP;
      const popDown = below >= above;
      const room = Math.max(160, Math.floor(popDown ? below : above));
      setPlace((current) =>
        current &&
        current.top === top &&
        current.left === left &&
        current.popDown === popDown &&
        current.room === room
          ? current
          : { top, left, popDown, room },
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (observer && barRef.current) observer.observe(barRef.current);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    editor.on('transaction', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      editor.off('transaction', measure);
    };
  }, [editor, status]);

  if (!editor) return null;
  if (status === 'idle') {
    // On a phone the Suggest button at the foot of the chapter is below the screen, under
    // everything the student has written (2026-10-04, found at 390 px wide). This one floats
    // above the tab bar, and only while no suggestion is showing.
    return (
      <button
        type="button"
        data-testid="suggest-floating"
        aria-label={t('suggest.floating')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().requestSuggestion().run()}
        className="fixed right-4 bottom-16 z-30 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink shadow-lg hover:bg-accent-hover lg:hidden"
      >
        {t('editor.suggest')}
      </button>
    );
  }

  const ask = (instruction: string, citeMode?: CiteMode) => {
    setMenu(false);
    setEvidence(null);
    // The model never sees a dismissed suggestion, so "shorter" alone meant nothing to it and it
    // wrote nothing (2026-10-04). The preset carries the text it revises, citation markers out.
    const current = (getGhostState(editor)?.text ?? '').replace(CITE_MARKER, '').trim();
    const h = historyRef.current;
    editor.commands.dismissSuggestion();
    // Set after the dismissal, so only the refinement's own ending brings it back.
    fallbackRef.current = h.entries[h.index] ?? null;
    editor.commands.requestSuggestion(
      current
        ? `${instruction}\n\nRevise this suggestion: "${current.slice(0, 900)}"`
        : instruction,
      citeMode,
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
    // ADR-0150: one floating layer at a time — the card closes the menu, and the menu the card.
    setMenu(false);
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

  // A popover opens away from the text: downward under an anchored bar with room, else upward.
  const pop = `${place?.popDown ? 'top-full mt-2' : 'bottom-full mb-2'} overflow-y-auto`;
  const popStyle = { maxHeight: place?.room ?? 'calc(100vh - 8rem)' };

  return (
    <div
      className={
        place
          ? 'pointer-events-none fixed z-40 max-w-[calc(100vw-2rem)]'
          : 'pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 lg:bottom-6'
      }
      style={place ? { top: place.top, left: place.left } : undefined}
    >
      <div
        ref={barRef}
        data-testid="suggestion-bar"
        data-anchored={place ? 'true' : 'false'}
        className="pointer-events-auto relative flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 shadow-lg"
      >
        <span className="text-[12px] text-muted">
          {shown ? t('suggest.suggestion') : t('suggest.writing')}
        </span>
        {shown && history.entries.length > 1 ? (
          <span className="flex items-center gap-0.5" data-testid="suggestion-history">
            <button
              type="button"
              aria-label={t('suggest.previous')}
              disabled={history.index <= 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => step(-1)}
              className="rounded px-1.5 py-0.5 text-[13px] hover:bg-sunk disabled:opacity-40"
            >
              ‹
            </button>
            <span className="text-[11.5px] tabular-nums text-muted">
              {t('suggest.position', { n: history.index + 1, total: history.entries.length })}
            </span>
            <button
              type="button"
              aria-label={t('suggest.next')}
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
            <span className="text-[11px] text-muted">{t('suggest.evidence')}</span>
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-expanded={evidence?.key === c.key}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => openEvidence(c)}
                className="rounded bg-accent/10 px-1.5 py-0.5 text-[11.5px] text-accent underline"
              >
                {c.rendered || t('suggest.source')}
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
          {t('suggest.accept')}
        </button>
        <button
          type="button"
          disabled={!shown}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.acceptSuggestionWord()}
          className={button}
        >
          {t('suggest.oneWord')}
        </button>
        <button
          type="button"
          disabled={!shown}
          aria-expanded={menu}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setEvidence(null);
            setMenu((open) => !open);
          }}
          className={button}
        >
          {t('suggest.refine')}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.dismissSuggestion()}
          className={button}
        >
          {t('common.dismiss')}
        </button>
        {shown && currentId ? (
          <span className="flex items-center gap-0.5" data-testid="suggestion-rating">
            <button
              type="button"
              aria-label={t('suggest.useful')}
              aria-pressed={rating === 1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => rate(1)}
              className={`rounded p-1.5 hover:bg-sunk ${rating === 1 ? 'text-accent' : 'text-muted'}`}
            >
              <ThumbsUp size={14} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t('suggest.notUseful')}
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
            style={popStyle}
            className={`absolute left-0 ${pop} w-[min(32rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-3 text-[13px] shadow-lg`}
          >
            {evidence.loading ? (
              <p className="text-muted">{t('suggest.opening')}</p>
            ) : !evidence.passage ? (
              <p className="text-muted">{t('suggest.couldNotOpen')}</p>
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
                    ? t('suggest.fullText')
                    : evidence.passage.record?.grounding === 'ABSTRACT'
                      ? t('suggest.abstractOnly')
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
                    evidence.passage.page ? t('suggest.page', { n: evidence.passage.page }) : null,
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
                        {t('suggest.openPdf')}
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
            data-testid="refine-menu"
            style={popStyle}
            className={`absolute left-0 ${pop} w-64 rounded-md border border-line bg-surface p-2 shadow-lg`}
          >
            {REFINE_PRESETS.map((preset, i) => [
              REFINE_GROUP_AT[i] ? (
                <p
                  key={`group-${REFINE_GROUP_AT[i]}`}
                  className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-wide text-muted uppercase"
                >
                  {t(REFINE_GROUP_AT[i] as MessageKey)}
                </p>
              ) : null,
              <button
                key={preset.label}
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => ask(preset.instruction, preset.citeMode)}
                className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-sunk"
              >
                {REFINE_LABEL[preset.label]
                  ? t(REFINE_LABEL[preset.label] as MessageKey)
                  : preset.label}
              </button>,
            ])}
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
              {t('suggest.ownInstruction')}
            </button>
            <p className="mt-1 px-2 text-[11px] text-muted">{t('suggest.refineCost')}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
