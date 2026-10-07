'use client';

/**
 * Chat over the library — PRD FR-4.9, PHASES v2 W9.4.
 *
 * A third tab in the right panel. Answers stream over SSE and cite only the passages the server
 * sent; a citation in an answer opens the same passage popover the editor uses. The two scripted
 * replies A.4 specifies are rendered as states with an action rather than as plain text.
 */

import { tokenizeAiText } from '@tc/ui';
import katex from 'katex';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { MessageKey, Vars } from '@/i18n';
import { useLanguage, useT } from '@/i18n/react';
import { ApiError, api } from '@/lib/api';
import { answerPlainText } from '@/lib/chat-copy';
import { dropMentionQuery, mentionQuery } from '@/lib/mentions';
import { matchPrompts, promptQuery, type SavedPrompt, suggestPromptTitle } from '@/lib/prompts';
import { findInLibrary, readerHref } from '@/lib/reader';
import { cn } from '@/lib/utils';
import { type Mention, MentionChips, MentionPicker, useChatMentions } from './ChatMentions';
import { PromptPicker, SavePromptForm, useSavedPrompts } from './ChatPrompts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** ADR-0060: a paper the search found, which an answer from abstracts cites. */
type BeyondPaper = {
  title: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  inLibrary: boolean;
  reference: { raw: string; doi?: string };
};

type Citation = {
  key: string;
  sourceId: string;
  chunkId: string;
  label: string;
  /** Present when the citation is a search abstract, not a library passage (ADR-0060). */
  beyond?: BeyondPaper;
  /** ADR-0083: the passage was a file attached to the question. */
  attachment?: { name: string };
};

/** ADR-0083: a file uploaded for the next question. */
type Attachment = { id: string; kind: 'image' | 'document'; name: string; chars?: number };

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  outcome?: string;
  /** The scope the question was asked in, which the advice under a refusal depends on. */
  scope?: Scope | 'beyond';
  /** ADR-0060, "Ask first": the refusal may be searched beyond the library. */
  offerBeyond?: boolean;
  /** The question a refusal answered, so the offer can send it again. */
  question?: string;
  /** ADR-0060: written from search abstracts; the line under the answer says so. */
  beyond?: { papers: number; outsideLibrary: number; note: string };
  /**
   * ADR-0074: the library's passages and abstracts a search found for a thin question.
   * ADR-0080: a deep research answer carries its plan too.
   */
  research?: {
    papers: number;
    queries: string[];
    note: string;
    deep?: true;
    plan?: Array<{ title: string; question: string }>;
  };
  /** The student's thumbs; only answers the server stored (it sent their id) can be rated. */
  rating?: 1 | -1;
  stored?: boolean;
};

/** One line of "what it is doing" (ADR-0060, ADR-0074), as the server sent it. */
type Step = { id: string; text: string; params?: Record<string, string | number> };

/**
 * A step in the interface language. English shows the server's own words, which get the plurals
 * right; another language says the same thing from its catalogue when the step carries what the
 * sentence needs, and falls back to the English it was sent.
 */
function stepLabel(step: Step, language: string, t: (key: MessageKey, vars?: Vars) => string) {
  if (language === 'en') return step.text;
  const p = step.params ?? {};
  switch (step.id) {
    case 'search':
      return step.text.startsWith('Searching your library') ? t('chat.step.search') : step.text;
    case 'research':
      if (!('papers' in p)) return step.text;
      return 'always' in p ? t('chat.step.researchAlways', p) : t('chat.step.research', p);
    case 'query':
      return 'query' in p ? t('chat.step.query', p) : step.text;
    case 'read':
      return 'count' in p ? t('chat.step.read', p) : step.text;
    case 'kept':
      return Number(p.kept ?? 0) === 0 ? t('chat.step.keptNone') : t('chat.step.kept', p);
    case 'write':
      return step.text.includes('part by part') ? t('chat.step.writeDeep') : t('chat.step.write');
    // ADR-0080: deep research's own steps.
    case 'plan':
      return t('chat.step.plan');
    case 'planned':
      return 'titles' in p ? t('chat.step.planned', p) : step.text;
    case 'part':
      return 'query' in p ? t('chat.step.part', p) : step.text;
    default:
      return step.text;
  }
}

type Filters = {
  yearFrom?: number | null;
  yearTo?: number | null;
  minCitations?: number | null;
  minJournalCitedness?: number | null;
  excludePreprints?: boolean;
};

/**
 * ADR-0016. Three places an answer can come from, and they are not equivalent:
 *
 * - `library` — the uploaded sources. Grounded, cited, and the default.
 * - `document` — the student's own chapters. Answered from, never citable.
 * - `web` — the scholarly indexes. **Returns candidate sources, not an answer.**
 */
type Scope = 'library' | 'document' | 'web';
const SCOPES: readonly Scope[] = ['library', 'document', 'web'];
const SCOPE_LABEL: Record<Scope, string> = {
  library: 'Library',
  document: 'This thesis',
  web: 'Find papers',
};
const SCOPE_BLURB: Record<Scope, string> = {
  library: 'Answers come only from your library, and cite the passage they came from.',
  document:
    'Answers come only from what you have written. Nothing here is citable — your own draft is not a source.',
  web: 'Searches the literature and shows real papers. It does not answer the question: add a paper to your library and ask again to get a grounded answer.',
};

// The prompt has to change with the scope. "What do my sources say about…" in Find-papers mode
// invites the question this scope deliberately does not answer.
const SCOPE_PLACEHOLDER: Record<Scope, string> = {
  library: 'What do my sources say about…',
  document: 'What have I already written about…',
  web: 'A topic, method or population to search for…',
};
const SCOPE_ASK_LABEL: Record<Scope, string> = {
  library: 'Ask about your library',
  document: 'Ask about what you have written',
  web: 'Search the literature',
};

type WebResult = {
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  citationCount: number | null;
  isPreprint: boolean;
  openAccess: boolean;
  inLibrary: boolean;
  /** Which index found it: OpenAlex, Semantic Scholar, PubMed or arXiv (ADR-0020). */
  via?: string;
  reference: { raw: string; doi?: string };
};

export function ChatPanel({
  documentId,
  onUsageChange,
  onOpenPassage,
  onAddToDocument,
  prefill,
}: {
  documentId: string;
  /**
   * A passage the student chose to ask about (2026-10-04, from the Jenni study: select text, ask
   * the chat). It goes into the box with the cursor after it; nothing is sent until they press Ask.
   */
  prefill?: {
    text: string;
    nonce: number;
    mention?: Mention;
    /** R13 (ADR-0100): a part of a page from the reader, already uploaded. */
    attachment?: Attachment;
    /** R13: questions to offer with it; pressing one puts it in the box. */
    questions?: string[];
  } | null;
  onUsageChange: () => void;
  onOpenPassage: (sourceId: string, chunkId: string) => void;
  /**
   * 2026-10-04: puts an answer into the chapter, its citations as real citation nodes. Jenni's chat
   * has this; ours had no way from an answer to the thesis but retyping it. Only on the student's
   * press — flag, don't fix.
   */
  onAddToDocument?: (text: string, citations: Citation[]) => void;
}) {
  const { t } = useT();
  const [language] = useLanguage();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!prefill?.text) return;
    setDraft(`About this passage: "${prefill.text.slice(0, 1_500)}" — `);
    // After the panel has rendered the new value.
    requestAnimationFrame(() => {
      const box = boxRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
  }, [prefill]);

  useEffect(() => {
    api<{ turns: Turn[] }>(`/chat/${documentId}`)
      .then((h) => setTurns(h.turns.map((t) => ({ ...t, stored: true }))))
      .catch(() => undefined);
    api<{ chatFilters?: Filters }>('/settings')
      .then((s) => setFilters(s.chatFilters ?? {}))
      .catch(() => undefined);
  }, [documentId]);

  // ADR-0016. 'library' is the grounded default and what this panel has always done; 'document'
  // answers from the student's own chapters, which are not citable and never enter a bibliography.
  const [scope, setScope] = useState<Scope>('library');
  // `@` names the papers a question is about. Library scope only: the draft and the web search
  // have no papers of their own to name.
  const mentions = useChatMentions(documentId, scope === 'library');
  // ADR-0068: a passage sent from the paper reader names its paper, so the answer is drawn from it.
  const addMention = mentions.add;
  useEffect(() => {
    if (!prefill?.mention) return;
    setScope('library');
    addMention(prefill.mention);
  }, [prefill, addMention]);
  // R13 (ADR-0100): the reader's box arrives as a picture on the next question, with questions
  // about the paper to choose from.
  const [offered, setOffered] = useState<string[]>([]);
  useEffect(() => {
    if (!prefill?.attachment) return;
    const picture = prefill.attachment;
    setAttachments((list) => [...list.filter((a) => a.id !== picture.id), picture].slice(-3));
    setOffered(prefill.questions ?? []);
    requestAnimationFrame(() => boxRef.current?.focus());
  }, [prefill]);
  // `/` brings back a saved prompt (ADR-0019), in any scope: it only fills the box.
  const saved = useSavedPrompts();
  const typingPrompt = promptQuery(draft);
  const typingMention = typingPrompt === null && scope === 'library' ? mentionQuery(draft) : null;
  const promptOptions = typingPrompt !== null ? matchPrompts(saved.prompts, typingPrompt) : [];
  const mentionOptions = typingMention !== null ? mentions.candidates(typingMention) : [];
  // Escape closes a picker until the text changes; typing anything opens it again.
  const [dismissed, setDismissed] = useState(false);
  const pickerOpen = !dismissed && (typingPrompt !== null || typingMention !== null);
  const optionCount = typingPrompt !== null ? promptOptions.length : mentionOptions.length;
  const [active, setActive] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: back to the top whenever the query changes
  useEffect(() => {
    setActive(0);
  }, [typingPrompt, typingMention]);
  const [savingPrompt, setSavingPrompt] = useState<{ editing: SavedPrompt | null } | null>(null);
  const [promptNotice, setPromptNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!promptNotice) return;
    const timer = setTimeout(() => setPromptNotice(null), 5_000);
    return () => clearTimeout(timer);
  }, [promptNotice]);
  /** Which answer was just copied, and what to say on its button for a moment. */
  const [copied, setCopied] = useState<{ id: string; message: string } | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);
  /**
   * Copies an answer as plain text: citations as the labels on screen, equations as their LaTeX
   * (`lib/chat-copy.ts`). Jenni's chat has Copy; ours only had "Add to document".
   */
  /** Thumbs on an answer (2026-10-04, from the Jenni study); pressing again takes it back. */
  async function rate(turn: Turn, value: 1 | -1) {
    const next = turn.rating === value ? 0 : value;
    const set = (rating: 1 | -1 | undefined) =>
      setTurns((list) => list.map((t) => (t.id === turn.id ? { ...t, rating } : t)));
    set(next === 0 ? undefined : next);
    try {
      await api(`/chat/${documentId}/turns/${turn.id}/rating`, {
        method: 'POST',
        body: JSON.stringify({ rating: next }),
      });
    } catch {
      set(turn.rating);
    }
  }

  async function copyAnswer(turn: Turn) {
    try {
      await navigator.clipboard.writeText(answerPlainText(turn.text, turn.citations ?? []));
      setCopied({ id: turn.id, message: 'Copied' });
    } catch {
      // No clipboard permission (an insecure origin, or the browser refused): say so plainly.
      setCopied({ id: turn.id, message: 'Could not copy' });
    }
  }
  const [webResults, setWebResults] = useState<WebResult[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  /** ADR-0060/0074: what a question is doing right now, in order. */
  const [steps, setSteps] = useState<Step[]>([]);
  /** Papers from an answer's abstracts the student has added, by DOI or title. */
  const [addedPapers, setAddedPapers] = useState<Set<string>>(() => new Set());
  /**
   * ADR-0080: the next library question is deep research — planned, searched per part, answered
   * at length, on its own allowance. Switched off again once asked: each one is a deliberate spend.
   */
  const [deep, setDeep] = useState(false);
  const deepOffered = scope === 'library' && mentions.mentions.length === 0;
  /** ADR-0083: files for the next question, uploaded as they are chosen; cleared once asked. */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const attachOffered = scope === 'library' || scope === 'document';

  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, 3 - attachments.length)) {
        const form = new FormData();
        form.append('file', file, file.name);
        const response = await fetch(
          `${API_URL}/api/v1/chat/attachments?documentId=${encodeURIComponent(documentId)}`,
          { method: 'POST', credentials: 'include', body: form },
        );
        if (!response.ok) {
          const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(problem?.detail ?? `Could not attach ${file.name}.`);
        }
        const uploaded = (await response.json()) as Attachment;
        setAttachments((list) => [...list, uploaded].slice(0, 3));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const shown = turns.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the thread grows
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [shown, streaming]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    setSavingPrompt(null);
    await send(message, scope);
  }

  /**
   * ADR-0060: the offer under a refused library question. The question is already in the thread,
   * so it is not added again; the server stores it with the answer.
   */
  async function searchBeyond(turn: Turn) {
    if (!turn.question || busy) return;
    setTurns((list) => list.map((t) => (t.id === turn.id ? { ...t, offerBeyond: false } : t)));
    await send(turn.question, 'beyond', { repeat: true });
  }

  async function send(
    message: string,
    askScope: Scope | 'beyond',
    options: { repeat?: boolean } = {},
  ) {
    setBusy(true);
    setError(null);
    setSteps([]);

    // The web scope is not a conversation. It returns papers, so it does not join the thread,
    // does not stream, and costs no cap unit — there is no model call behind it.
    if (askScope === 'web') {
      try {
        const found = await api<{ results: WebResult[] }>('/chat/web', {
          method: 'POST',
          body: JSON.stringify({ documentId, message }),
        });
        setWebResults(found.results);
      } catch (e) {
        setError(
          e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : (e as Error).message,
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    // The server assigns its own id when it stores the turn; this one only has to be unique
    // in this list until the thread is reloaded.
    if (!options.repeat) {
      setTurns((list) => [...list, { id: crypto.randomUUID(), role: 'user', text: message }]);
    }
    setStreaming('');

    try {
      const response = await fetch(`${API_URL}/api/v1/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          documentId,
          message,
          filters,
          scope: askScope,
          ...(askScope === 'library' && mentions.mentions.length > 0
            ? { sourceIds: mentions.mentions.map((m) => m.id) }
            : {}),
          ...(askScope === 'library' && deep && mentions.mentions.length === 0
            ? { deep: true }
            : {}),
          ...(attachments.length > 0 && (askScope === 'library' || askScope === 'document')
            ? { attachmentIds: attachments.map((a) => a.id) }
            : {}),
        }),
      });
      if (deep) setDeep(false);
      if (attachments.length > 0 && response.ok) {
        setAttachments([]);
        setOffered([]);
      }
      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as {
          detail?: string;
          title?: string;
        } | null;
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
          const eventName = /^event:\s*(.*)$/m.exec(frame)?.[1]?.trim();
          const dataLine = /^data:\s*(.*)$/m.exec(frame)?.[1];
          if (!eventName || !dataLine) continue;
          const data = JSON.parse(dataLine) as Record<string, unknown>;
          if (eventName === 'step') {
            // ADR-0060: searching, reading N abstracts, writing — each replaces "now" and the
            // earlier ones stay ticked.
            setSteps((list) => [
              ...list,
              {
                id: String(data.id ?? ''),
                text: String(data.text ?? ''),
                ...(data.params && typeof data.params === 'object'
                  ? { params: data.params as Step['params'] }
                  : {}),
              },
            ]);
          } else if (eventName === 'token') {
            text += String(data.t ?? '');
            setStreaming(text);
          } else if (eventName === 'done') {
            const beyond = data.beyond as Turn['beyond'] | undefined;
            const research = data.research as Turn['research'] | undefined;
            setTurns((list) => [
              ...list,
              {
                id: typeof data.turnId === 'string' ? data.turnId : crypto.randomUUID(),
                stored: typeof data.turnId === 'string',
                role: 'assistant',
                text: String(data.text ?? text),
                citations: (data.citations as Citation[]) ?? [],
                outcome: String(data.outcome ?? 'answered'),
                // An automatic search ("On") answers a library question from abstracts.
                scope: beyond ? 'beyond' : askScope,
                ...(beyond ? { beyond } : {}),
                ...(research ? { research } : {}),
                ...(data.offerBeyond === true ? { offerBeyond: true, question: message } : {}),
              },
            ]);
            setStreaming('');
            setSteps([]);
          } else if (eventName === 'error') {
            throw new Error(String(data.message ?? 'The answer did not finish.'));
          }
        }
      }
      onUsageChange();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : (e as Error).message,
      );
      setStreaming('');
      setSteps([]);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Promotes a search result into a real source — ADR-0016's whole point.
   *
   * The same `/sources/resolve` a pasted bibliography uses, so a paper found this way is
   * indistinguishable afterwards from one the student added by hand: fetched, chunked, embedded,
   * and citable through the grounded pipeline.
   */
  async function addToLibrary(result: WebResult) {
    setAdding(result.title);
    setError(null);
    try {
      await resolveReference(result.reference);
      setWebResults(
        (list) =>
          list?.map((r) => (r.title === result.title ? { ...r, inLibrary: true } : r)) ?? null,
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not add that paper.',
      );
    } finally {
      setAdding(null);
    }
  }

  function resolveReference(reference: { raw: string; doi?: string }) {
    return api(`/documents/${documentId}/sources/resolve`, {
      method: 'POST',
      body: JSON.stringify({ references: [reference] }),
    });
  }

  /**
   * ADR-0060: Add on a paper an answer read from its abstract. The same resolve path; once the
   * paper is fetched and read it is an ordinary library source, and a Library question cites it.
   */
  async function addBeyondPaper(paper: BeyondPaper) {
    const key = paper.doi ?? paper.title;
    setAdding(key);
    setError(null);
    try {
      await resolveReference(paper.reference);
      setAddedPapers((set) => new Set(set).add(key));
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not add that paper.',
      );
    } finally {
      setAdding(null);
    }
  }

  /** ADR-0074: every found paper an answer cited, in one resolve call, on one press. */
  async function addAllPapers(papers: BeyondPaper[]) {
    if (papers.length === 0) return;
    setAdding('*all*');
    setError(null);
    try {
      await api(`/documents/${documentId}/sources/resolve`, {
        method: 'POST',
        body: JSON.stringify({ references: papers.map((p) => p.reference) }),
      });
      setAddedPapers((set) => {
        const next = new Set(set);
        for (const p of papers) next.add(p.doi ?? p.title);
        return next;
      });
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not add those papers.',
      );
    } finally {
      setAdding(null);
    }
  }

  function pickMention(mention: Mention) {
    mentions.add(mention);
    // The `@query` was only ever a way to choose; it is not part of the question.
    setDraft(dropMentionQuery);
  }

  /** A saved prompt goes into the box, not straight to the model: it can still be changed. */
  function applyPrompt(prompt: SavedPrompt) {
    setDraft(prompt.body);
    setDismissed(false);
  }

  function editPrompt(prompt: SavedPrompt) {
    setDraft(prompt.body);
    setSavingPrompt({ editing: prompt });
  }

  async function deletePrompt(prompt: SavedPrompt) {
    try {
      await saved.remove(prompt.id);
      setPromptNotice(`Deleted “${prompt.title}”.`);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'That prompt was not deleted.',
      );
    }
  }

  async function submitPrompt(title: string) {
    const body = draft.trim();
    if (!body) throw new Error('Type the prompt’s text in the box first.');
    const editing = savingPrompt?.editing ?? null;
    if (editing) {
      await saved.update(editing.id, { title, body });
      setPromptNotice(`Updated “${title}”.`);
    } else {
      await saved.save(title, body);
      setPromptNotice(`Saved “${title}”. Type / to use it.`);
    }
    setSavingPrompt(null);
  }

  /** The arrow keys and Enter drive whichever picker is open; Escape closes it. */
  function onBoxKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!pickerOpen) return;
    if (event.key === 'ArrowDown' && optionCount > 0) {
      event.preventDefault();
      setActive((i) => (i + 1) % optionCount);
    } else if (event.key === 'ArrowUp' && optionCount > 0) {
      event.preventDefault();
      setActive((i) => (i - 1 + optionCount) % optionCount);
    } else if (event.key === 'Enter') {
      const index = Math.min(active, optionCount - 1);
      if (typingPrompt !== null) {
        // Never send "/lim" as a question. Escape first to send text that starts with a slash.
        event.preventDefault();
        const prompt = promptOptions[index];
        if (prompt) applyPrompt(prompt);
      } else {
        const mention = mentionOptions[index];
        if (mention) {
          event.preventDefault();
          pickMention(mention);
        }
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDismissed(true);
    }
  }

  const canSavePrompt =
    draft.trim().length > 0 && typingPrompt === null && savingPrompt === null && !busy;

  async function saveFilters(next: Filters) {
    setFilters(next);
    await api('/settings', { method: 'PUT', body: JSON.stringify({ chatFilters: next }) }).catch(
      () => undefined,
    );
  }

  return (
    <div data-testid="chat-panel" className="flex h-full flex-col">
      <div className="px-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          {/* A real fieldset rather than role="group": the native element already carries the
              grouping semantics, and the legend names it without a duplicate aria-label. */}
          <fieldset className="inline-flex rounded-md border border-line bg-surface p-0.5">
            <legend className="sr-only">What to answer from</legend>
            {SCOPES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={scope === option}
                data-testid={`chat-scope-${option}`}
                onClick={() => setScope(option)}
                className={cn(
                  'rounded-sm px-2 py-0.5 text-[11px] font-semibold transition-colors',
                  scope === option ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink',
                )}
              >
                {SCOPE_LABEL[option]}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            className="text-xs text-muted underline"
            onClick={() => setShowFilters((v) => !v)}
          >
            Filters
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted">{SCOPE_BLURB[scope]}</p>
      </div>

      {scope === 'web' && webResults ? (
        <div data-testid="web-results" className="mb-2 grid gap-2">
          {webResults.length === 0 ? (
            <p className="px-1 text-sm text-muted">
              Nothing came back for that. Try naming the method or the population rather than asking
              a question.
            </p>
          ) : null}
          {webResults.map((result) => (
            <article
              key={result.doi ?? result.title}
              className="rounded-md border border-line bg-surface p-2"
            >
              <p className="text-sm font-medium text-ink">{result.title}</p>
              <p className="mt-0.5 text-xs text-muted">
                {[result.venue, result.year, result.isPreprint ? 'preprint' : null]
                  .filter(Boolean)
                  .join(' · ')}
                {result.citationCount !== null ? ` · ${result.citationCount} citations` : ''}
                {result.openAccess ? ' · open access' : ''}
              </p>
              {result.abstract ? (
                <p className="mt-1 line-clamp-3 text-xs text-muted">{result.abstract}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {result.inLibrary ? (
                  <p className="text-xs text-ok">
                    Already in your library
                    {(() => {
                      // ADR-0068: once the row exists, the paper can be read here.
                      const row = findInLibrary(mentions.library, result);
                      return row ? (
                        <>
                          {' · '}
                          <a
                            href={readerHref(documentId, row.id)}
                            target="_blank"
                            rel="noopener"
                            data-testid="web-read"
                            className="font-semibold text-accent underline"
                          >
                            Read
                          </a>
                        </>
                      ) : null;
                    })()}
                  </p>
                ) : (
                  <button
                    type="button"
                    data-testid="web-add"
                    disabled={adding === result.title}
                    onClick={() => void addToLibrary(result)}
                    className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-sunk disabled:opacity-50"
                  >
                    {adding === result.title ? 'Adding…' : 'Add to library'}
                  </button>
                )}
                {result.doi ? (
                  // An arXiv DOI resolves to the abstract page, which is where arXiv asks
                  // services to send people.
                  <a
                    href={`https://doi.org/${result.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted underline hover:text-ink"
                  >
                    {result.doi.startsWith('10.48550/arxiv.') ? 'arXiv page' : 'View paper'}
                  </a>
                ) : null}
              </div>
            </article>
          ))}
          <p className="px-1 text-xs text-faint">
            Adding fetches the paper and indexes it. Once it is in, ask the same question on Library
            and the answer will cite it.
          </p>
        </div>
      ) : null}

      {showFilters ? (
        <div className="mb-2 space-y-2 rounded-md border border-line bg-surface p-2 text-xs">
          <label className="flex items-center justify-between gap-2">
            Published from
            <input
              type="number"
              className="w-20 rounded border border-line px-1"
              value={filters.yearFrom ?? ''}
              onChange={(e) =>
                void saveFilters({
                  ...filters,
                  yearFrom: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Minimum citations
            <input
              type="number"
              className="w-20 rounded border border-line px-1"
              value={filters.minCitations ?? ''}
              onChange={(e) =>
                void saveFilters({
                  ...filters,
                  minCitations: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>
              Journal citedness at least
              <span className="block text-[11px] text-faint">
                OpenAlex's 2-year figure, the idea behind an impact factor. Sources without one are
                left out.
              </span>
            </span>
            <input
              type="number"
              min={0}
              step={0.5}
              data-testid="filter-journal-citedness"
              className="w-20 rounded border border-line px-1"
              value={filters.minJournalCitedness ?? ''}
              onChange={(e) =>
                void saveFilters({
                  ...filters,
                  minJournalCitedness: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Exclude preprints
            <input
              type="checkbox"
              checked={filters.excludePreprints ?? false}
              onChange={(e) => void saveFilters({ ...filters, excludePreprints: e.target.checked })}
            />
          </label>
        </div>
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto px-1" aria-live="polite">
        {turns.length === 0 && !streaming && scope !== 'web' ? (
          <p className="text-sm text-muted">
            {scope === 'library'
              ? 'Ask about the papers you have pinned or added — what they found, where they disagree, what is missing. For writing, use Assist or Draft in the editor.'
              : 'Ask about what you have already written — what a chapter argues, where you covered something, whether you have said it twice.'}
          </p>
        ) : null}
        {turns.map((turn) => (
          <div
            key={turn.id}
            data-role={turn.role}
            className={`rounded-lg px-3 py-2 text-sm ${
              turn.role === 'user' ? 'ml-auto max-w-[90%] bg-accent text-accent-ink' : 'bg-surface'
            }`}
          >
            {turn.role === 'assistant' ? (
              <AnswerText
                text={turn.text}
                citations={turn.citations ?? []}
                onOpen={onOpenPassage}
              />
            ) : (
              turn.text
            )}
            {/* Only in the library scope. Telling a student to add sources is the fix when the
                question was about their library, and no help at all when it was about their own
                draft — see `docs/PENDING.md`, "A.4 refuses in the wrong words". */}
            {turn.outcome === 'not-enough' && turn.scope !== 'document' ? (
              <p className="mt-2 text-xs text-muted">
                Add sources from the Discover tab, then ask again.
              </p>
            ) : null}
            {/* ADR-0060, "Ask first": one press sends the same question to the search. */}
            {turn.offerBeyond && turn.question ? (
              <button
                type="button"
                data-testid="chat-search-beyond"
                disabled={busy}
                onClick={() => void searchBeyond(turn)}
                className="mt-2 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-sunk disabled:opacity-50"
              >
                Search beyond your library for this?
              </button>
            ) : null}
            {turn.beyond ? (
              <BeyondPapers
                turn={turn}
                added={addedPapers}
                adding={adding}
                onAdd={(paper) => void addBeyondPaper(paper)}
              />
            ) : null}
            {turn.research ? (
              <ResearchPapers
                turn={turn}
                added={addedPapers}
                adding={adding}
                onAdd={(paper) => void addBeyondPaper(paper)}
                onAddAll={(papers) => void addAllPapers(papers)}
                t={t}
              />
            ) : null}
            {turn.role === 'assistant' && turn.text.trim() ? (
              <div className="mt-2 flex items-center gap-3 text-xs">
                {/* An answer from abstracts cites papers that are not sources yet; it goes into
                    the thesis only once they are added and asked about on Library. ADR-0074: the
                    same holds for a library answer that also cited a found paper. */}
                {onAddToDocument &&
                turn.outcome !== 'not-enough' &&
                !turn.beyond &&
                !(turn.citations ?? []).some((c) => c.beyond || c.attachment) ? (
                  <button
                    type="button"
                    data-testid="chat-add-to-document"
                    className="font-medium text-accent underline"
                    onClick={() => onAddToDocument(turn.text, turn.citations ?? [])}
                  >
                    Add to document
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid="chat-copy"
                  className="text-muted underline hover:text-ink"
                  onClick={() => void copyAnswer(turn)}
                >
                  {copied?.id === turn.id ? copied.message : 'Copy'}
                </button>
                {turn.stored ? (
                  <span className="ml-auto flex items-center gap-0.5" data-testid="chat-rating">
                    <button
                      type="button"
                      aria-label="Useful answer"
                      aria-pressed={turn.rating === 1}
                      onClick={() => void rate(turn, 1)}
                      className={`rounded p-1 hover:bg-sunk ${turn.rating === 1 ? 'text-accent' : 'text-muted'}`}
                    >
                      <ThumbsUp size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="Not a useful answer"
                      aria-pressed={turn.rating === -1}
                      onClick={() => void rate(turn, -1)}
                      className={`rounded p-1 hover:bg-sunk ${turn.rating === -1 ? 'text-accent' : 'text-muted'}`}
                    >
                      <ThumbsDown size={13} aria-hidden />
                    </button>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {steps.length > 0 ? (
          <ol data-testid="chat-steps" className="space-y-0.5 px-1 text-xs text-muted">
            {steps.map((step, i) => {
              // Searches run side by side: a search line is done when something other than a
              // search has followed it, not merely another search.
              const done = steps.slice(i + 1).some((later) => later.id !== step.id);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list; the same words can recur.
                <li key={`${i}-${step.text}`} data-done={done} data-step={step.id}>
                  <span aria-hidden className="mr-1.5 inline-block w-3">
                    {done ? '✓' : '·'}
                  </span>
                  {stepLabel(step, language, t)}
                </li>
              );
            })}
          </ol>
        ) : null}
        {streaming ? (
          <div className="rounded-lg bg-surface px-3 py-2 text-sm text-muted">{streaming}</div>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <p role="alert" className="px-1 py-2 text-xs text-warn">
          {error}
        </p>
      ) : null}

      {scope === 'library' ? (
        <MentionChips mentions={mentions.mentions} onRemove={mentions.remove} />
      ) : null}
      {offered.length > 0 ? (
        <ul data-testid="chat-offered" className="mt-1 flex flex-wrap gap-1 px-1">
          {offered.map((question) => (
            <li key={question}>
              <button
                type="button"
                className="rounded-md border border-line px-2 py-0.5 text-left text-[12px] text-ink hover:bg-sunk"
                onClick={() => {
                  setDraft(question);
                  requestAnimationFrame(() => boxRef.current?.focus());
                }}
              >
                {question}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {attachments.length > 0 ? (
        <ul data-testid="chat-attachments" className="mt-1 flex flex-wrap gap-1 px-1">
          {attachments.map((a) => (
            <li
              key={a.id}
              data-testid="chat-attachment-chip"
              className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-muted"
            >
              <span aria-hidden>{a.kind === 'image' ? '🖼' : '📄'}</span>
              <span className="max-w-[12rem] truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                className="text-faint hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={ask} className="relative mt-2 flex gap-2 border-t border-line pt-2">
        {attachOffered ? (
          <label
            data-testid="chat-attach"
            title="Attach a picture, PDF, Word or text file to this question (read for this question only)"
            className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line text-muted hover:text-ink ${
              busy || uploading || attachments.length >= 3 ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            <span aria-hidden>{uploading ? '…' : '📎'}</span>
            <span className="sr-only">Attach a file</span>
            <input
              type="file"
              data-testid="chat-attach-input"
              className="sr-only"
              accept="image/png,image/jpeg,image/gif,.pdf,.docx,.txt,.md,.csv"
              multiple
              disabled={busy || uploading || attachments.length >= 3}
              onChange={(e) => {
                void attachFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        ) : null}
        {pickerOpen && typingPrompt !== null ? (
          <PromptPicker
            options={promptOptions}
            query={typingPrompt}
            active={active}
            onPick={applyPrompt}
            onEdit={editPrompt}
            onDelete={deletePrompt}
          />
        ) : null}
        {pickerOpen && typingMention !== null ? (
          <MentionPicker
            query={typingMention}
            options={mentionOptions}
            active={active}
            onPick={pickMention}
          />
        ) : null}
        <label className="sr-only" htmlFor="chat-message">
          {SCOPE_ASK_LABEL[scope]}
        </label>
        <input
          id="chat-message"
          ref={boxRef}
          value={draft}
          disabled={busy}
          maxLength={2000}
          autoComplete="off"
          onChange={(e) => {
            setDraft(e.target.value);
            setDismissed(false);
          }}
          onKeyDown={onBoxKeyDown}
          placeholder={SCOPE_PLACEHOLDER[scope]}
          className="h-9 flex-1 rounded-md border border-line px-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="rounded-md px-3 text-sm disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
        >
          {busy ? '…' : 'Ask'}
        </button>
      </form>
      {savingPrompt ? (
        <SavePromptForm
          key={savingPrompt.editing?.id ?? 'new'}
          initialTitle={savingPrompt.editing?.title ?? suggestPromptTitle(draft)}
          editing={savingPrompt.editing !== null}
          onSubmit={submitPrompt}
          onCancel={() => setSavingPrompt(null)}
        />
      ) : (
        <div className="mt-1 flex min-h-6 items-center justify-between gap-2 px-1 text-[11px] text-faint">
          <span data-testid="chat-box-hint" aria-live="polite">
            {promptNotice ??
              (deep && deepOffered
                ? t('chat.deep.on')
                : scope === 'library' && mentions.hasLibrary
                  ? '@ names a paper · / uses a saved prompt'
                  : '/ uses a saved prompt')}
          </span>
          {deepOffered ? (
            <button
              type="button"
              data-testid="chat-deep-toggle"
              aria-pressed={deep}
              disabled={busy}
              title={t('chat.deep.hint')}
              onClick={() => setDeep((on) => !on)}
              className={`shrink-0 rounded-full border px-2 py-0.5 transition-colors disabled:opacity-50 ${
                deep
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line text-muted hover:text-ink'
              }`}
            >
              {t('chat.deep.toggle')}
            </button>
          ) : null}
          {canSavePrompt ? (
            <button
              type="button"
              data-testid="save-prompt"
              onClick={() => setSavingPrompt({ editing: null })}
              className="shrink-0 text-muted underline hover:text-ink"
            >
              Save as prompt
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Renders an answer: `{{cite:ID}}` as a button that opens the passage it stands on, and `$…$` /
 * `$$…$$` as typeset maths. Equations used to show as their LaTeX source — "$7.44735 \\times
 * 10^{-10}$" — the formula complaint, in chat (found 2026-10-04 comparing with Jenni).
 */
function AnswerText({
  text,
  citations,
  onOpen,
}: {
  text: string;
  citations: Citation[];
  onOpen: (sourceId: string, chunkId: string) => void;
}) {
  // ADR-0074: an answer in parts has "### Part" lines; each is a heading, the rest is prose.
  // Split into blocks first, keyed by where each starts in the answer.
  const blocks: Array<{ heading: boolean; text: string; at: number }> = [];
  let at = 0;
  let prose = '';
  let proseAt = 0;
  for (const line of text.split('\n')) {
    const heading = /^#{1,4}\s+(.+)$/.exec(line.trim());
    if (heading) {
      if (prose.trim()) blocks.push({ heading: false, text: prose.trim(), at: proseAt });
      blocks.push({ heading: true, text: heading[1] ?? '', at });
      prose = '';
      proseAt = at + line.length + 1;
    } else {
      prose += `${line}\n`;
    }
    at += line.length + 1;
  }
  if (prose.trim()) blocks.push({ heading: false, text: prose.trim(), at: proseAt });
  if (blocks.length <= 1 && !blocks[0]?.heading) {
    return <InlineAnswer text={text} citations={citations} onOpen={onOpen} />;
  }
  return (
    <div data-testid="chat-answer-parts" className="space-y-1.5">
      {blocks.map((block) =>
        block.heading ? (
          <h4
            key={`h-${block.at}`}
            data-testid="chat-answer-heading"
            className="pt-1 text-[13px] font-semibold text-ink"
          >
            {block.text}
          </h4>
        ) : (
          <InlineAnswer
            key={`p-${block.at}`}
            text={block.text}
            citations={citations}
            onOpen={onOpen}
          />
        ),
      )}
    </div>
  );
}

/** One run of answer prose: citations as buttons, maths typeset. */
function InlineAnswer({
  text,
  citations,
  onOpen,
}: {
  text: string;
  citations: Citation[];
  onOpen: (sourceId: string, chunkId: string) => void;
}) {
  // Keyed by where the part starts in the answer: unique, and stable while the text is.
  let offset = 0;
  const parts = tokenizeAiText(text).map((token) => {
    const at = offset;
    offset +=
      token.type === 'text'
        ? token.text.length
        : token.type === 'cite'
          ? token.key.length + 8
          : token.latex.length + 2;
    return { token, at };
  });
  return (
    <p className="whitespace-pre-wrap">
      {parts.map(({ token, at }) => {
        if (token.type === 'text') return <span key={`t-${at}`}>{token.text}</span>;
        if (token.type === 'math') {
          let html = '';
          try {
            html = katex.renderToString(token.latex, {
              displayMode: token.display,
              throwOnError: false,
              output: 'html',
            });
          } catch {
            return <code key={`m-${at}`}>{token.latex}</code>;
          }
          return (
            <span
              key={`m-${at}`}
              className={token.display ? 'my-1 block text-center' : undefined}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output from the answer's own LaTeX
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
        const citation = citations.find((c) => c.key === token.key);
        if (!citation) return null;
        // ADR-0083: a file attached to the question is named, not opened: it is not a source.
        if (citation.attachment) {
          return (
            <span
              key={`c-${at}`}
              data-testid="chat-attachment-cite"
              title="A file attached to the question, read for this answer only"
              className="mx-0.5 rounded border border-dashed border-line-strong px-1 text-muted"
            >
              {citation.label}
            </span>
          );
        }
        // ADR-0060: an abstract the search found has no passage to open; it is labelled for what
        // it is, and the list under the answer is where it is added.
        if (citation.beyond) {
          return (
            <span
              key={`c-${at}`}
              data-testid="chat-beyond-cite"
              title={citation.beyond.inLibrary ? 'In your library' : 'Not in your library'}
              className="mx-0.5 rounded border border-dashed border-line-strong px-1 text-muted"
            >
              {citation.label}
            </span>
          );
        }
        return (
          <button
            key={`c-${at}`}
            type="button"
            onClick={() => onOpen(citation.sourceId, citation.chunkId)}
            className="mx-0.5 rounded bg-accent/10 px-1 text-accent underline"
          >
            {citation.label}
          </button>
        );
      })}
    </p>
  );
}

/**
 * ADR-0060: under an answer written from search abstracts — the line that says so, and each paper
 * it cited, marked "Not in your library" with Add. Adding goes through the ordinary resolve path;
 * once the paper is read it is a library source, and the same question on Library cites it.
 */
function BeyondPapers({
  turn,
  added,
  adding,
  onAdd,
}: {
  turn: Turn;
  added: ReadonlySet<string>;
  adding: string | null;
  onAdd: (paper: BeyondPaper) => void;
}) {
  const cited = new Map<string, BeyondPaper>();
  for (const citation of turn.citations ?? []) {
    if (citation.beyond) cited.set(citation.beyond.doi ?? citation.beyond.title, citation.beyond);
  }
  return (
    <div data-testid="chat-beyond" className="mt-2 border-t border-line pt-2">
      <p data-testid="chat-beyond-note" className="text-xs text-muted">
        {turn.beyond?.note}
      </p>
      {cited.size > 0 ? (
        <ul className="mt-1.5 space-y-1.5">
          {[...cited].map(([key, paper]) => (
            <li key={key} data-testid="chat-beyond-paper" className="text-xs">
              <span className="font-medium text-ink">{paper.title}</span>
              <span className="text-muted">
                {[paper.venue, paper.year].filter(Boolean).length > 0
                  ? ` · ${[paper.venue, paper.year].filter(Boolean).join(' · ')}`
                  : ''}
              </span>
              <span className="mt-0.5 flex items-center gap-3">
                {paper.inLibrary ? (
                  <span className="text-ok">In your library</span>
                ) : added.has(key) ? (
                  <span className="text-ok">
                    Added. Once it has been read, ask on Library to cite it.
                  </span>
                ) : (
                  <>
                    <span className="text-warn">Not in your library</span>
                    <button
                      type="button"
                      data-testid="chat-beyond-add"
                      disabled={adding === key}
                      onClick={() => onAdd(paper)}
                      className="font-semibold text-accent underline disabled:opacity-50"
                    >
                      {adding === key ? 'Adding…' : 'Add'}
                    </button>
                  </>
                )}
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
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * ADR-0074: under a library answer that also read abstracts a search found — what was searched,
 * the line that says what the answer stood on, and each found paper it cited, with Add and Add
 * all. Nothing is added without the press; once a paper is read it is a library source and the
 * same question cites it from the library.
 */
function ResearchPapers({
  turn,
  added,
  adding,
  onAdd,
  onAddAll,
  t,
}: {
  turn: Turn;
  added: ReadonlySet<string>;
  adding: string | null;
  onAdd: (paper: BeyondPaper) => void;
  onAddAll: (papers: BeyondPaper[]) => void;
  t: (key: MessageKey, vars?: Vars) => string;
}) {
  const cited = new Map<string, BeyondPaper>();
  for (const citation of turn.citations ?? []) {
    if (citation.beyond) cited.set(citation.beyond.doi ?? citation.beyond.title, citation.beyond);
  }
  const waiting = [...cited].filter(([key, p]) => !p.inLibrary && !added.has(key));
  return (
    <div data-testid="chat-research" className="mt-2 border-t border-line pt-2">
      <p data-testid="chat-research-note" className="text-xs text-muted">
        {turn.research?.note}
      </p>
      {turn.research?.plan && turn.research.plan.length > 0 ? (
        <p data-testid="chat-research-plan" className="mt-0.5 text-[11px] text-faint">
          {t('chat.research.plan', { titles: turn.research.plan.map((p) => p.title).join(' · ') })}
        </p>
      ) : null}
      {turn.research && turn.research.queries.length > 0 ? (
        <p className="mt-0.5 text-[11px] text-faint">
          {t('chat.research.searched', { queries: turn.research.queries.join(' · ') })}
        </p>
      ) : null}
      {cited.size > 0 ? (
        <>
          <p className="mt-1.5 text-xs font-semibold text-ink">{t('chat.research.title')}</p>
          <ul className="mt-1 space-y-1.5">
            {[...cited].map(([key, paper]) => (
              <li key={key} data-testid="chat-research-paper" className="text-xs">
                <span className="font-medium text-ink">{paper.title}</span>
                <span className="text-muted">
                  {[paper.venue, paper.year].filter(Boolean).length > 0
                    ? ` · ${[paper.venue, paper.year].filter(Boolean).join(' · ')}`
                    : ''}
                </span>
                <span className="mt-0.5 flex items-center gap-3">
                  {paper.inLibrary ? (
                    <span className="text-ok">{t('chat.research.inLibrary')}</span>
                  ) : added.has(key) ? (
                    <span className="text-ok">{t('chat.research.added')}</span>
                  ) : (
                    <>
                      <span className="text-warn">{t('chat.research.notInLibrary')}</span>
                      <button
                        type="button"
                        data-testid="chat-research-add"
                        disabled={adding !== null}
                        onClick={() => onAdd(paper)}
                        className="font-semibold text-accent underline disabled:opacity-50"
                      >
                        {adding === key ? t('chat.research.adding') : t('chat.research.add')}
                      </button>
                    </>
                  )}
                  {paper.doi ? (
                    <a
                      href={`https://doi.org/${paper.doi}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted underline hover:text-ink"
                    >
                      {t('chat.research.view')}
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {waiting.length > 1 ? (
            <button
              type="button"
              data-testid="chat-research-add-all"
              disabled={adding !== null}
              onClick={() => onAddAll(waiting.map(([, p]) => p))}
              className="mt-2 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-sunk disabled:opacity-50"
            >
              {adding === '*all*'
                ? t('chat.research.adding')
                : t('chat.research.addAll', { count: waiting.length })}
            </button>
          ) : null}
          {waiting.length > 0 ? (
            <p className="mt-1.5 text-[11px] text-faint">{t('chat.research.addFirst')}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
