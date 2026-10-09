'use client';

/**
 * Ask a research question — with no thesis, or across every thesis (ADR-0132, Jenni build plan
 * R30/R32).
 *
 * Opened from the thesis list ("Ask a research question") and from New ▾. Two sources:
 *
 * - **The literature**: the scholarly indexes are searched and the answer is written from the
 *   abstracts they return (ADR-0060's path), each paper marked "Not in your library".
 * - **All my theses**: the answer comes from the passages in the student's own theses' libraries,
 *   each citation naming its thesis.
 *
 * Either is one CHAT unit. Nothing enters a thesis without a press: "Add to a thesis…" sends one
 * paper to the thesis chosen, and "Start a thesis from this" makes a thesis with the question as
 * its working title and the ticked papers in its library.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { AnswerText } from '@/components/editor/ChatPanel';
import { LimitNotice, useLimit } from '@/components/LimitNotice';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, PageHeader, Textarea } from '@/components/ui/primitives';
import { useT } from '@/i18n/react';
import { API_URL, ApiError, api, type ProblemDetails } from '@/lib/api';
import {
  addPaperToThesis,
  labelledCitations,
  paperKey,
  papersOfTurn,
  type ResearchChatSummary,
  type ResearchChatView,
  type ResearchCitation,
  type ResearchPaper,
  type ResearchSource,
  type ResearchTurn,
  startThesisFromChat,
} from '@/lib/research-chat';
import { cn } from '@/lib/utils';

type Thesis = { id: string; title: string };
type Step = { id: string; text: string };

function problemText(e: unknown): string {
  return e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : (e as Error).message;
}

const SOURCES: Array<{ value: ResearchSource; label: string; hint: string }> = [
  {
    value: 'web',
    label: 'The literature',
    hint: 'Searches OpenAlex, PubMed and arXiv and answers from the abstracts.',
  },
  {
    value: 'theses',
    label: 'All my theses',
    hint: 'Answers from the papers in the libraries of all your theses.',
  },
];

export default function AskPage() {
  return (
    <Suspense fallback={null}>
      <Ask />
    </Suspense>
  );
}

function Ask() {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('chat');

  const [chats, setChats] = useState<ResearchChatSummary[] | null>(null);
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [chatId, setChatId] = useState<string | null>(openId);
  const [turns, setTurns] = useState<ResearchTurn[]>([]);
  const [suggestedTitle, setSuggestedTitle] = useState('');
  const [source, setSource] = useState<ResearchSource>('web');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [streaming, setStreaming] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const limit = useLimit();

  const loadChats = useCallback(() => {
    api<{ chats: ResearchChatSummary[] }>('/research-chats')
      .then((r) => setChats(r.chats))
      .catch(() => setChats([]));
  }, []);

  useEffect(() => {
    loadChats();
    api<Thesis[]>('/documents')
      .then((list) => setTheses(list.map((d) => ({ id: d.id, title: d.title }))))
      .catch(() => setTheses([]));
  }, [loadChats]);

  // Open the chat named in the address, or start empty.
  useEffect(() => {
    setChatId(openId);
    setError(null);
    limit.clear();
    if (!openId) {
      setTurns([]);
      setSuggestedTitle('');
      return;
    }
    api<ResearchChatView>(`/research-chats/${openId}`)
      .then((view) => {
        setTurns(view.turns);
        setSuggestedTitle(view.suggestedTitle);
      })
      .catch((e) => setError(problemText(e)));
  }, [openId, limit.clear]);

  const papers = allPapers(turns);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const question = message.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    limit.clear();
    setSteps([]);
    setStreaming('');
    setTurns((list) => [...list, { id: crypto.randomUUID(), role: 'user', text: question }]);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/v1/research-chats/ask`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ message: question, source, ...(chatId ? { chatId } : {}) }),
      });
      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as ProblemDetails | null;
        if (problem?.type) throw new ApiError(problem);
        throw new Error(problem?.detail ?? problem?.title ?? `HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const name = /^event:\s*(.*)$/m.exec(frame)?.[1]?.trim();
          const line = /^data:\s*(.*)$/m.exec(frame)?.[1];
          if (!name || !line) continue;
          const data = JSON.parse(line) as Record<string, unknown>;
          if (name === 'step') {
            setSteps((list) => [...list, { id: String(data.id ?? ''), text: String(data.text) }]);
          } else if (name === 'token') {
            text += String(data.t ?? '');
            setStreaming(text);
          } else if (name === 'done') {
            const turn: ResearchTurn = {
              id: typeof data.turnId === 'string' ? data.turnId : crypto.randomUUID(),
              role: 'assistant',
              text: String(data.text ?? text),
              citations: (data.citations as ResearchCitation[]) ?? [],
              outcome: String(data.outcome ?? 'answered'),
              ...(data.beyond ? { beyond: data.beyond as ResearchTurn['beyond'] } : {}),
              ...(data.across === true ? { across: true as const } : {}),
            };
            setTurns((list) => [...list, turn]);
            setStreaming('');
            setSteps([]);
            if (typeof data.threadId === 'string' && data.threadId !== chatId) {
              setChatId(data.threadId);
              if (!suggestedTitle) setSuggestedTitle(question);
              router.replace(`/app/ask?chat=${data.threadId}`, { scroll: false });
              loadChats();
            }
          } else if (name === 'error') {
            throw new Error(String(data.message ?? 'The answer did not finish.'));
          }
        }
      }
    } catch (e) {
      if (!limit.take(e)) setError(problemText(e));
      setStreaming('');
      setSteps([]);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/research-chats/${id}`, { method: 'DELETE', body: '{}' });
      loadChats();
      if (id === chatId) router.replace('/app/ask');
    } catch (e) {
      setError(problemText(e));
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10" data-testid="ask-page">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          {t('common.theses')}
        </Link>{' '}
        / Ask a research question
      </nav>
      <PageHeader
        className="mt-3"
        title="Ask a research question"
        lede="No thesis needed. Ask the literature, or ask across all your theses. Each question is one chat question from your allowance; nothing goes into a thesis unless you add it."
      />

      <div className="mt-6 grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="min-w-0" data-testid="ask-history">
          <details className="rounded-md border border-line bg-surface lg:open:border-line" open>
            <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-ink">
              Past questions{chats && chats.length > 0 ? ` (${chats.length})` : ''}
            </summary>
            <div className="border-t border-line p-2">
              <Link
                href="/app/ask"
                data-testid="ask-new"
                className="block rounded px-2 py-1.5 text-[13px] font-semibold text-accent hover:bg-sunk"
              >
                + New question
              </Link>
              {chats === null ? (
                <p className="px-2 py-1.5 text-xs text-muted">Loading…</p>
              ) : chats.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted">Your questions will be kept here.</p>
              ) : (
                <ul className="mt-1 max-h-[40vh] space-y-0.5 overflow-y-auto lg:max-h-[60vh]">
                  {chats.map((c) => (
                    <li
                      key={c.id}
                      className={cn(
                        'group flex min-w-0 items-start gap-1 rounded',
                        c.id === chatId ? 'bg-sunk' : 'hover:bg-sunk',
                      )}
                    >
                      <Link
                        href={`/app/ask?chat=${c.id}`}
                        data-testid="ask-history-item"
                        className="min-w-0 flex-1 px-2 py-1.5"
                        title={c.title}
                      >
                        <span className="line-clamp-2 text-[13px] text-ink [overflow-wrap:anywhere]">
                          {c.title}
                        </span>
                        <span className="text-[11px] text-muted">
                          {c.questions} question{c.questions === 1 ? '' : 's'}
                        </span>
                      </Link>
                      <button
                        type="button"
                        aria-label={`Delete “${c.title}”`}
                        data-testid="ask-history-delete"
                        onClick={() => {
                          if (
                            window.confirm('Delete this chat? Its answers cannot be brought back.')
                          ) {
                            void remove(c.id);
                          }
                        }}
                        className="shrink-0 px-2 py-1.5 text-xs text-muted hover:text-danger"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </aside>

        <section className="min-w-0" aria-label="The conversation">
          {turns.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-xs text-muted">
                {papers.length > 0
                  ? `${papers.length} paper${papers.length === 1 ? '' : 's'} cited in this chat`
                  : 'No papers cited yet'}
              </p>
              <Button
                size="sm"
                variant="secondary"
                data-testid="ask-start-thesis"
                disabled={busy}
                onClick={() => setStarting(true)}
              >
                Start a thesis from this
              </Button>
            </div>
          ) : null}

          <ol className="space-y-4" data-testid="ask-turns">
            {turns.map((turn) =>
              turn.role === 'user' ? (
                <li
                  key={turn.id}
                  className="ml-auto w-fit max-w-[90%] rounded-lg bg-accent/10 px-3 py-2 text-[14px] text-ink [overflow-wrap:anywhere]"
                >
                  {turn.text}
                </li>
              ) : (
                <li key={turn.id} data-testid="ask-answer">
                  <Answer
                    turn={turn}
                    theses={theses}
                    onOpen={(citation) => {
                      if (citation.thesis) {
                        router.push(`/app/d/${citation.thesis.id}/sources/${citation.sourceId}`);
                      }
                    }}
                  />
                </li>
              ),
            )}
            {busy ? (
              <li
                className="rounded-lg border border-line bg-surface p-3"
                data-testid="ask-working"
              >
                <ul className="space-y-0.5 text-xs text-muted">
                  {steps.map((s, i) => (
                    // A step is said once; its words tell it apart from the others.
                    <li key={`${s.id}:${s.text}`}>
                      {i < steps.length - 1 ? '✓ ' : '… '}
                      {s.text}
                    </li>
                  ))}
                  {steps.length === 0 ? <li>… Starting</li> : null}
                </ul>
                {streaming ? (
                  <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink">
                    {streaming.replace(/\{\{cite:[^}]+\}\}/g, '')}
                  </p>
                ) : null}
              </li>
            ) : null}
          </ol>

          {turns.length === 0 && !busy ? (
            <p className="rounded-lg border border-dashed border-line-strong p-4 text-[13.5px] text-muted">
              Ask what the research says — for example, “What limits rooftop solar adoption among
              rural households?” The answer cites only the papers it read.
            </p>
          ) : null}

          <LimitNotice limit={limit.value} className="mt-3" />
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger [overflow-wrap:anywhere]"
            >
              {error}
            </p>
          ) : null}

          <form onSubmit={ask} className="mt-4 space-y-2" data-testid="ask-form">
            <fieldset className="flex flex-wrap gap-2" aria-label="Where the answer comes from">
              {SOURCES.map((s) => (
                <label
                  key={s.value}
                  title={s.hint}
                  className={cn(
                    'flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px]',
                    source === s.value
                      ? 'border-accent bg-accent/10 font-semibold text-ink'
                      : 'border-line text-muted hover:bg-sunk',
                  )}
                >
                  <input
                    type="radio"
                    name="source"
                    value={s.value}
                    checked={source === s.value}
                    onChange={() => setSource(s.value)}
                    data-testid={`ask-source-${s.value}`}
                    className="accent-[var(--color-accent)]"
                  />
                  {s.label}
                </label>
              ))}
            </fieldset>
            <p className="text-[11.5px] text-muted">
              {SOURCES.find((s) => s.value === source)?.hint}
            </p>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={3}
              maxLength={2000}
              placeholder="Ask a research question"
              aria-label="Your question"
              data-testid="ask-input"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || !message.trim()} data-testid="ask-submit">
                {busy ? 'Working…' : 'Ask'}
              </Button>
            </div>
          </form>
        </section>
      </div>

      <StartThesisDialog
        open={starting}
        onClose={() => setStarting(false)}
        suggestedTitle={suggestedTitle || turns.find((x) => x.role === 'user')?.text || ''}
        papers={papers}
        onCreated={(made) =>
          router.push(
            made.firstChapterId
              ? `/app/d/${made.id}/write/${made.firstChapterId}`
              : `/app/d/${made.id}/outline`,
          )
        }
      />
    </main>
  );
}

/** Every paper the chat's answers cited, once. */
function allPapers(turns: readonly ResearchTurn[]): ResearchPaper[] {
  const seen = new Map<string, ResearchPaper>();
  for (const turn of turns) {
    if (turn.role !== 'assistant') continue;
    for (const paper of papersOfTurn(turn))
      if (!seen.has(paperKey(paper))) seen.set(paperKey(paper), paper);
  }
  return [...seen.values()];
}

function Answer({
  turn,
  theses,
  onOpen,
}: {
  turn: ResearchTurn;
  theses: Thesis[];
  onOpen: (citation: ResearchCitation) => void;
}) {
  const citations = labelledCitations(turn.citations ?? []);
  const papers = papersOfTurn(turn);
  const thesisOf = new Map(
    (turn.citations ?? []).flatMap((c) => {
      const paper = c.beyond ?? c.paper;
      return paper && c.thesis ? [[paperKey(paper), c.thesis] as const] : [];
    }),
  );
  return (
    <div className="rounded-lg border border-line bg-surface p-3 text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]">
      <AnswerText
        text={turn.text}
        citations={citations}
        onOpen={(sourceId, chunkId) => {
          const citation = citations.find((c) => c.sourceId === sourceId && c.chunkId === chunkId);
          if (citation) onOpen(citation);
        }}
      />
      {turn.beyond ? (
        <p className="mt-2 border-t border-line pt-2 text-xs text-muted" data-testid="ask-note">
          {turn.beyond.note}
        </p>
      ) : null}
      {papers.length > 0 ? (
        <ul className="mt-2 space-y-2" data-testid="ask-papers">
          {papers.map((paper) => (
            <PaperRow
              key={paperKey(paper)}
              paper={paper}
              thesis={thesisOf.get(paperKey(paper)) ?? null}
              theses={theses}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One cited paper: where it is, a link to it, and "Add to a thesis…". */
function PaperRow({
  paper,
  thesis,
  theses,
}: {
  paper: ResearchPaper;
  thesis: Thesis | null;
  theses: Thesis[];
}) {
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const others = theses.filter((x) => x.id !== thesis?.id);

  async function add(target: Thesis) {
    setAdding(target.id);
    setError(null);
    try {
      await addPaperToThesis(api, target.id, paper);
      setAdded((list) => [...list, target.title]);
      setChoosing(false);
    } catch (e) {
      setError(problemText(e));
    } finally {
      setAdding(null);
    }
  }

  return (
    <li className="min-w-0 text-xs" data-testid="ask-paper">
      <span className="font-medium text-ink">{paper.title}</span>
      <span className="text-muted">
        {[paper.venue, paper.year].filter(Boolean).length > 0
          ? ` · ${[paper.venue, paper.year].filter(Boolean).join(' · ')}`
          : ''}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {thesis ? (
          <span className="text-ok" data-testid="ask-paper-thesis">
            In “{thesis.title}”
          </span>
        ) : (
          <span className="text-warn">Not in your library</span>
        )}
        {others.length > 0 ? (
          <button
            type="button"
            aria-expanded={choosing}
            data-testid="ask-add-to-thesis"
            onClick={() => setChoosing((v) => !v)}
            className="font-semibold text-accent underline"
          >
            Add to a thesis…
          </button>
        ) : null}
        {paper.doi ? (
          <a
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted underline hover:text-ink"
          >
            View paper
          </a>
        ) : null}
      </span>
      {choosing ? (
        <ul
          className="mt-1 max-w-full space-y-0.5 rounded-md border border-line bg-surface p-1"
          data-testid="ask-thesis-choices"
        >
          {others.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                disabled={adding !== null}
                onClick={() => add(x)}
                data-testid="ask-thesis-choice"
                className="block w-full truncate rounded px-2 py-1 text-left text-[12.5px] text-ink hover:bg-sunk disabled:opacity-50"
              >
                {adding === x.id ? 'Adding…' : x.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {added.length > 0 ? (
        <p className="mt-0.5 text-ok" data-testid="ask-paper-added">
          Added to {added.map((title) => `“${title}”`).join(', ')}. It is read and then citable
          there.
        </p>
      ) : null}
      {error ? <p className="mt-0.5 text-danger">{error}</p> : null}
    </li>
  );
}

/** "Start a thesis from this": the working title, and which papers go into its library. */
function StartThesisDialog({
  open,
  onClose,
  suggestedTitle,
  papers,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  suggestedTitle: string;
  papers: ResearchPaper[];
  onCreated: (made: { id: string; firstChapterId: string | null }) => void;
}) {
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(suggestedTitle.slice(0, 300));
    setChosen(new Set(papers.map(paperKey)));
    setError(null);
  }, [open, suggestedTitle, papers]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const made = await startThesisFromChat(
        api,
        title,
        papers.filter((p) => chosen.has(paperKey(p))),
      );
      onCreated(made);
    } catch (e) {
      setError(problemText(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start a thesis from this"
      testId="ask-start-dialog"
    >
      <form onSubmit={create} className="space-y-3">
        <label htmlFor="ask-start-title" className="block text-[13px] font-semibold text-ink">
          Working title
          <Input
            id="ask-start-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
            className="mt-1"
            data-testid="ask-start-title"
          />
        </label>
        {papers.length > 0 ? (
          <fieldset>
            <legend className="text-[13px] font-semibold text-ink">
              Papers to put in its library
            </legend>
            <ul className="mt-1 max-h-60 space-y-1 overflow-y-auto">
              {papers.map((p) => (
                <li key={paperKey(p)}>
                  <label className="flex min-w-0 items-start gap-2 text-[12.5px] text-ink">
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0"
                      checked={chosen.has(paperKey(p))}
                      data-testid="ask-start-paper"
                      onChange={(e) =>
                        setChosen((set) => {
                          const next = new Set(set);
                          if (e.target.checked) next.add(paperKey(p));
                          else next.delete(paperKey(p));
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {p.title}
                      {p.year ? `, ${p.year}` : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : (
          <p className="text-[12.5px] text-muted">
            No papers were cited yet; the thesis starts empty.
          </p>
        )}
        <p className="text-[12px] text-muted">
          The thesis starts as “Start writing now” does: papers on the title are searched for too,
          and its chapters are planned from the title.
        </p>
        {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !title.trim()} data-testid="ask-start-create">
            {busy ? 'Creating…' : 'Create the thesis'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
