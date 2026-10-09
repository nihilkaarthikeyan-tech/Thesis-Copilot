'use client';

/**
 * What the paper reader asked the editor to do (ADR-0068), picked up when the chapter opens.
 *
 *   "Ask chat about this" — the chat opens with the passage in the box and the paper @-named.
 *   "Cite in my chapter"  — a bar asks the student to click where the citation goes, then press
 *                           Cite here. The editor does not remember a caret between visits, so
 *                           guessing a place would put a citation somewhere the student did not
 *                           choose; one click is the honest version of "at the cursor".
 *   "Put note in chapter"  — ADR-0130: the same bar, carrying the student's own note on a
 *                           highlight; "Put here" puts the note in with the citation after it.
 *
 * Nothing enters the chapter without that press (flag, don't fix).
 */

import { newCitationKey } from '@tc/ui';
import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { type ReaderHandoff, takeHandoff } from '@/lib/reader';
import type { Mention } from './ChatMentions';

type CiteHandoff = Extract<ReaderHandoff, { kind: 'cite' }>;

export function ReaderHandoffBar({
  editor,
  documentId,
  onAsk,
}: {
  editor: Editor | null;
  documentId: string;
  onAsk: (
    text: string,
    mention: Mention,
    /** R13 (ADR-0100): a part of a page as a picture, and questions to offer with it. */
    extra?: {
      attachment?: { id: string; kind: 'image'; name: string };
      questions?: string[];
      /** ADR-0130: the student's note on a highlight. */
      note?: string;
    },
  ) => void;
}) {
  const [cite, setCite] = useState<CiteHandoff | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const taken = useRef(false);
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;

  useEffect(() => {
    if (!editor || taken.current) return;
    taken.current = true;
    const handoff = takeHandoff(documentId);
    if (!handoff) return;
    if (handoff.kind === 'ask') {
      onAskRef.current(
        handoff.text,
        {
          id: handoff.sourceId,
          label: handoff.label,
          readable: handoff.readable,
        },
        {
          ...(handoff.attachment ? { attachment: handoff.attachment } : {}),
          ...(handoff.questions ? { questions: handoff.questions } : {}),
          ...(handoff.note ? { note: handoff.note } : {}),
        },
      );
    } else {
      setCite(handoff);
    }
  }, [editor, documentId]);

  if (!cite) return null;

  async function insert(target: CiteHandoff) {
    if (!editor) return;
    if (!editor.state.selection.empty) {
      setMessage(
        'Click where the citation should go, with no text selected, then press Cite here.',
      );
      return;
    }
    // The label the `@` picker would give, so the citation reads right at once — not in a numeric
    // style, whose number is the document's to give on the next render (ADR-0045).
    let label = '';
    let numeric = false;
    try {
      const pick = await api<{
        sources: Array<{ sourceId: string; label: string }>;
        numeric?: boolean;
      }>(
        `/documents/${documentId}/citations/pick?q=${encodeURIComponent(
          (target.title ?? '').split(/\s+/).slice(0, 4).join(' '),
        )}`,
      );
      label = pick.sources.find((s) => s.sourceId === target.sourceId)?.label ?? '';
      numeric = pick.numeric === true;
    } catch {
      // The placeholder shows until the next render brings the label.
    }
    const key = newCitationKey();
    const store = (editor.storage as { citation?: { renderedMap?: Record<string, string> } })
      .citation;
    if (store?.renderedMap && label && !numeric) store.renderedMap[key] = label;
    const note = target.text?.replace(/\s+/g, ' ').trim();
    const chain = editor.chain().focus();
    if (note) chain.insertContent({ type: 'text', text: `${note} ` });
    chain
      .insertCitation({
        key,
        sourceId: target.sourceId,
        chunkId: target.chunkId,
        ...(target.page ? { locator: String(target.page) } : {}),
      })
      .run();
    setCite(null);
    setMessage(null);
  }

  return (
    <div
      role="status"
      data-testid="reader-cite-bar"
      className="fixed inset-x-0 bottom-16 z-40 mx-auto flex w-[min(40rem,94vw)] flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-surface px-3 py-2 text-[13px] text-ink shadow-lg"
    >
      <span className="min-w-0 flex-1">
        {cite.text ? 'Putting your note in, citing ' : 'Citing '}
        <strong>{cite.label}</strong>
        {cite.page ? `, p. ${cite.page}` : ''}.{' '}
        {message ??
          `Click in your chapter where it goes, then press ${cite.text ? 'Put here' : 'Cite here'}.`}
      </span>
      <button
        type="button"
        data-testid="reader-cite-here"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void insert(cite)}
        className="rounded-md bg-accent px-3 py-1 text-[12px] font-bold text-accent-ink hover:bg-accent-hover"
      >
        {cite.text ? 'Put here' : 'Cite here'}
      </button>
      <button
        type="button"
        onClick={() => setCite(null)}
        className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-sunk hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}
