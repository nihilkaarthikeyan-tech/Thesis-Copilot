'use client';

/**
 * `/app/d/:id/outline` — PRD FR-3.1–3.5, PHASES v2 W8.1, W8.3, W8.6.
 *
 * The template picker, the generated tree, and the editing the student does to it: rename, edit a
 * scope note, move up or down, indent (make a section of the chapter above), outdent, add and
 * delete. Every edit writes the whole tree to `DocumentMemory.outline` — the same record the
 * prompt builder reads (FR-3.4) — so a rename here is the chapter title in the next suggestion.
 *
 * Reordering is buttons rather than drag-and-drop: it is keyboard-reachable, works on a phone,
 * and needs no library. Drag can come later without changing the contract.
 */

import { LANGUAGES } from '@tc/config';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NextAction } from '@/components/NextAction';
import { Progress } from '@/components/Progress';
import { ApiError, api } from '@/lib/api';

type Node = {
  id: string;
  title: string;
  scopeNote: string;
  subTheme?: string;
  mappedFromPaperSection?: string;
  children: Node[];
};

type View = {
  template: string | null;
  language: string;
  suggestedTemplate: string;
  templates: Array<{ key: string; name: string; summary: string; chapters: string[] }>;
  outline: Node[];
  chapters: Array<{
    id: string;
    outlineNodeId: string;
    title: string;
    order: number;
    wordCount: number;
    orphaned: boolean;
  }>;
  glossary: Record<
    string,
    {
      definition?: string;
      usageNote?: string;
      alternatives?: Array<{ paper: string; definition: string }>;
      conflict?: boolean;
    }
  >;
  generating: boolean;
};

const POLL_MS = 2_500;

/** Depth-first list with the path to each node, so edits can address any position. */
function flatten(nodes: Node[], path: number[] = []): Array<{ node: Node; path: number[] }> {
  return nodes.flatMap((node, i) => [
    { node, path: [...path, i] },
    ...flatten(node.children, [...path, i]),
  ]);
}

function updateAt(nodes: Node[], path: number[], fn: (node: Node) => Node | null): Node[] {
  const [head, ...rest] = path;
  if (head === undefined) return nodes;
  return nodes.flatMap((node, i) => {
    if (i !== head) return [node];
    if (rest.length === 0) {
      const next = fn(node);
      return next ? [next] : [];
    }
    return [{ ...node, children: updateAt(node.children, rest, fn) }];
  });
}

function siblingsOf(nodes: Node[], path: number[]): Node[] {
  let list = nodes;
  for (const i of path.slice(0, -1)) list = list[i]?.children ?? [];
  return list;
}

export function OutlineScreen({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [outline, setOutline] = useState<Node[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'outline' | 'glossary'>('outline');

  const load = useCallback(async () => {
    try {
      const next = await api<View>(`/documents/${documentId}/outline`);
      setView(next);
      setOutline((current) => (dirty && current ? current : next.outline));
    } catch (e) {
      if (e instanceof ApiError && e.problem.status === 401) router.replace('/sign-in');
      else setError(e instanceof Error ? e.message : 'Could not load the outline.');
    }
  }, [documentId, router, dirty]);

  useEffect(() => {
    void load();
  }, [load]);

  // The outline job runs in the worker; poll while it is in flight.
  useEffect(() => {
    if (!view?.generating) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [view?.generating, load]);

  const wordCountByNode = useMemo(
    () => new Map((view?.chapters ?? []).map((c) => [c.outlineNodeId, c.wordCount])),
    [view],
  );
  const chapterIdByNode = useMemo(
    () => new Map((view?.chapters ?? []).map((c) => [c.outlineNodeId, c.id])),
    [view],
  );

  async function generate(template?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/documents/${documentId}/outline/generate`, {
        method: 'POST',
        body: JSON.stringify(template ? { template } : {}),
      });
      setDirty(false);
      setNotice('Generating the outline from your proposal, gap map and paper…');
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not start it.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!outline) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ created: number; orphaned: string[] }>(
        `/documents/${documentId}/memory/outline`,
        { method: 'PUT', body: JSON.stringify({ outline }) },
      );
      setDirty(false);
      setNotice(
        `Saved.${result.created ? ` ${result.created} new chapter${result.created === 1 ? '' : 's'} created.` : ''}${
          result.orphaned.length
            ? ` ${result.orphaned.length} chapter(s) no longer in the outline are kept below.`
            : ''
        }`,
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteChapter(nodeId: string) {
    const chapterId = chapterIdByNode.get(nodeId);
    const words = wordCountByNode.get(nodeId) ?? 0;
    if (chapterId && words > 0) {
      const ok = window.confirm(
        `That chapter has ${words} words written. Deleting it removes the text as well. Delete anyway?`,
      );
      if (!ok) return;
    }
    setError(null);
    try {
      if (chapterId) {
        await api(`/documents/${documentId}/chapters/${chapterId}`, {
          method: 'DELETE',
          body: JSON.stringify({ wordCount: words }),
        });
      }
      setOutline((current) => (current ? current.filter((n) => n.id !== nodeId) : current));
      setDirty(false);
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not delete it.',
      );
    }
  }

  function edit(path: number[], fn: (node: Node) => Node | null) {
    setOutline((current) => (current ? updateAt(current, path, fn) : current));
    setDirty(true);
  }

  function move(path: number[], delta: -1 | 1) {
    setOutline((current) => {
      if (!current) return current;
      const parentPath = path.slice(0, -1);
      const index = path.at(-1) as number;
      const swap = (list: Node[]): Node[] => {
        const to = index + delta;
        if (to < 0 || to >= list.length) return list;
        const next = [...list];
        [next[index], next[to]] = [next[to] as Node, next[index] as Node];
        return next;
      };
      if (parentPath.length === 0) return swap(current);
      return updateAt(current, parentPath, (parent) => ({
        ...parent,
        children: swap(parent.children),
      }));
    });
    setDirty(true);
  }

  /** Indent: become a section of the sibling above. Outdent: become a sibling of the parent. */
  function indent(path: number[]) {
    setOutline((current) => {
      if (!current) return current;
      const index = path.at(-1) as number;
      if (index === 0) return current;
      const parentPath = path.slice(0, -1);
      const shift = (list: Node[]): Node[] => {
        const node = list[index] as Node;
        const host = list[index - 1] as Node;
        const next = list.filter((_, i) => i !== index);
        next[index - 1] = { ...host, children: [...host.children, node] };
        return next;
      };
      if (parentPath.length === 0) return shift(current);
      return updateAt(current, parentPath, (parent) => ({
        ...parent,
        children: shift(parent.children),
      }));
    });
    setDirty(true);
  }

  function outdent(path: number[]) {
    setOutline((current) => {
      if (!current || path.length < 2) return current;
      const index = path.at(-1) as number;
      const parentPath = path.slice(0, -1);
      const parentIndex = parentPath.at(-1) as number;
      const grandPath = parentPath.slice(0, -1);
      let node: Node | null = null;
      let withoutChild = updateAt(current, parentPath, (parent) => {
        node = parent.children[index] ?? null;
        return { ...parent, children: parent.children.filter((_, i) => i !== index) };
      });
      if (!node) return current;
      const insert = (list: Node[]): Node[] => {
        const next = [...list];
        next.splice(parentIndex + 1, 0, node as Node);
        return next;
      };
      withoutChild =
        grandPath.length === 0
          ? insert(withoutChild)
          : updateAt(withoutChild, grandPath, (g) => ({ ...g, children: insert(g.children) }));
      return withoutChild;
    });
    setDirty(true);
  }

  function addChapter() {
    setOutline((current) => [
      ...(current ?? []),
      {
        id: `ch${(current?.length ?? 0) + 1}-new-chapter-${Date.now().toString(36)}`,
        title: 'New chapter',
        scopeNote: 'Say what this chapter must establish, and what it must not cover.',
        children: [],
      },
    ]);
    setDirty(true);
  }

  if (!view || !outline) return <p className="p-6 text-sm text-muted">Loading the outline…</p>;

  const rows = flatten(outline);
  const orphans = view.chapters.filter((c) => c.orphaned);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>
        <span>/</span>
        <Link href={`/app/d/${documentId}/proposal`} className="hover:underline">
          Proposal
        </Link>
        <span>/</span>
        <span>Outline</span>
      </nav>

      <h1 className="text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Outline
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        This tree is what every suggestion reads: the chapter you are in, its scope note, and its
        neighbours. Edit it freely — a rename here is the title the AI sees next.
      </p>

      <NextAction documentId={documentId} className="mt-6" />
      <Progress documentId={documentId} className="mt-4" />

      <div className="mt-6 flex border-b border-line text-sm">
        {(
          [
            ['outline', 'Chapters'],
            ['glossary', `Glossary (${Object.keys(view.glossary).length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 ${tab === key ? 'border-b-2 border-ink font-medium' : 'text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 text-sm">
          {notice}
        </p>
      ) : null}

      {tab === 'glossary' ? (
        <GlossaryEditor
          documentId={documentId}
          glossary={view.glossary}
          onSaved={() => void load()}
          onError={setError}
        />
      ) : (
        <>
          <section className="mt-6 rounded-md border border-line bg-surface p-4">
            <label className="text-sm font-medium" htmlFor="thesis-language">
              Language
            </label>
            <p className="mt-1 text-xs text-muted">
              What the thesis is written in. Suggestions, drafts and chat all answer in it.
            </p>
            <select
              id="thesis-language"
              data-testid="language-picker"
              value={view.language}
              onChange={(e) => {
                const language = e.target.value;
                setView((v) => (v ? { ...v, language } : v));
                void api(`/documents/${documentId}/language`, {
                  method: 'PUT',
                  body: JSON.stringify({ language }),
                }).catch(() => setError('Could not change the language.'));
              }}
              className="mt-2 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm md:w-72 font-semibold text-ink transition-colors hover:bg-sunk"
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </section>

          <section className="mt-6 rounded-md border border-line bg-surface p-4">
            <h2 className="eyebrow">Template</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {view.templates.map((t) => (
                <label
                  key={t.key}
                  className={`cursor-pointer rounded-md border p-3 text-sm ${
                    (view.template ?? view.suggestedTemplate) === t.key
                      ? 'border-ink'
                      : 'border-line'
                  }`}
                >
                  <span className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="template"
                      className="mt-1"
                      checked={(view.template ?? view.suggestedTemplate) === t.key}
                      onChange={() =>
                        void api(`/documents/${documentId}/template`, {
                          method: 'PUT',
                          body: JSON.stringify({ template: t.key }),
                        }).then(() => load())
                      }
                    />
                    <span>
                      <span className="block font-medium">{t.name}</span>
                      <span className="block text-xs text-muted">{t.summary}</span>
                      <span className="mt-1 block text-xs text-muted">
                        {t.chapters.join(' · ')}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || view.generating}
                onClick={() => void generate()}
                className="rounded-md px-4 py-2 text-sm disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
                data-testid="generate-outline"
              >
                {view.generating
                  ? 'Generating…'
                  : outline.length > 1
                    ? 'Regenerate outline'
                    : 'Generate outline'}
              </button>
              <span className="text-xs text-muted">
                Chapters you have written in are never overwritten or deleted.
              </span>
            </div>
          </section>

          <section className="mt-6" data-testid="outline-tree">
            <div className="flex items-baseline justify-between">
              <h2 className="eyebrow">
                {outline.length} chapter{outline.length === 1 ? '' : 's'} ·{' '}
                {rows.length - outline.length} section
                {rows.length - outline.length === 1 ? '' : 's'}
              </h2>
              <div className="flex gap-3 text-sm">
                <button type="button" onClick={addChapter} className="underline">
                  Add chapter
                </button>
                <button
                  type="button"
                  disabled={!dirty || saving}
                  onClick={() => void save()}
                  className="rounded-md px-3 py-1 disabled:opacity-40 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
                  data-testid="save-outline"
                >
                  {saving ? 'Saving…' : dirty ? 'Save outline' : 'Saved'}
                </button>
              </div>
            </div>

            <ul className="mt-3 space-y-2">
              {rows.map(({ node, path }) => {
                const depth = path.length - 1;
                const words = wordCountByNode.get(node.id);
                const chapterId = chapterIdByNode.get(node.id);
                const siblings = siblingsOf(outline, path);
                const index = path.at(-1) as number;
                return (
                  <li
                    key={node.id}
                    data-testid="outline-node"
                    data-depth={depth}
                    className="rounded-md border border-line bg-surface p-3"
                    style={{ marginLeft: depth * 20 }}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        aria-label={`Title of ${node.title}`}
                        value={node.title}
                        onChange={(e) => edit(path, (n) => ({ ...n, title: e.target.value }))}
                        className="flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-medium font-semibold text-ink transition-colors hover:bg-sunk"
                      />
                      <div className="flex shrink-0 gap-1 text-xs">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={index === 0}
                          onClick={() => move(path, -1)}
                          className="rounded border border-line px-2 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={index === siblings.length - 1}
                          onClick={() => move(path, 1)}
                          className="rounded border border-line px-2 disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          aria-label="Make a section of the item above"
                          disabled={index === 0}
                          onClick={() => indent(path)}
                          className="rounded border border-line px-2 disabled:opacity-30"
                        >
                          →
                        </button>
                        <button
                          type="button"
                          aria-label="Promote to chapter"
                          disabled={depth === 0}
                          onClick={() => outdent(path)}
                          className="rounded border border-line px-2 disabled:opacity-30"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${node.title}`}
                          onClick={() =>
                            depth === 0 ? void deleteChapter(node.id) : edit(path, () => null)
                          }
                          className="rounded border border-line px-2 text-warn"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <textarea
                      aria-label={`Scope note for ${node.title}`}
                      value={node.scopeNote}
                      rows={2}
                      onChange={(e) => edit(path, (n) => ({ ...n, scopeNote: e.target.value }))}
                      className="mt-2 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-xs font-semibold text-ink transition-colors hover:bg-sunk"
                    />
                    <p className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                      <span className="font-mono">{node.id}</span>
                      {node.subTheme ? <span>theme: {node.subTheme}</span> : null}
                      {node.mappedFromPaperSection ? (
                        <span>from your paper: “{node.mappedFromPaperSection}”</span>
                      ) : null}
                      {typeof words === 'number' ? <span>{words} words written</span> : null}
                      {chapterId ? (
                        <Link
                          href={`/app/d/${documentId}/write/${chapterId}`}
                          className="underline"
                        >
                          Open
                        </Link>
                      ) : depth === 0 ? (
                        <span>chapter created on save</span>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>

            {orphans.length > 0 ? (
              <div className="mt-6 rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
                <p className="font-medium">Chapters no longer in the outline</p>
                <p className="mt-1 text-xs text-muted">
                  Kept, with their text. Add a chapter with the same title to bring one back, or
                  delete it here.
                </p>
                <ul className="mt-2 space-y-1">
                  {orphans.map((c) => (
                    <li key={c.id} className="flex items-center justify-between">
                      <Link href={`/app/d/${documentId}/write/${c.id}`} className="underline">
                        {c.title}
                      </Link>
                      <span className="text-xs text-muted">
                        {c.wordCount} words{' '}
                        <button
                          type="button"
                          onClick={() => void deleteChapter(c.outlineNodeId)}
                          className="ml-2 text-warn underline"
                        >
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}

/** W8.6: view and edit the terms in memory; conflicts from the cross-paper pass are shown. */
function GlossaryEditor({
  documentId,
  glossary,
  onSaved,
  onError,
}: {
  documentId: string;
  glossary: View['glossary'];
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  // A stable per-row key: a term can be renamed to empty, so the index alone is not enough and
  // the term alone is not unique while the student is typing a new one.
  const [terms, setTerms] = useState(() =>
    Object.entries(glossary).map(([term, value], i) => ({
      key: `g${i}`,
      term,
      definition: value.definition ?? '',
      usageNote: value.usageNote ?? '',
      alternatives: value.alternatives ?? [],
      conflict: Boolean(value.conflict),
    })),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const map: Record<string, unknown> = {};
      for (const t of terms) {
        if (!t.term.trim()) continue;
        map[t.term.trim()] = {
          definition: t.definition,
          ...(t.usageNote ? { usageNote: t.usageNote } : {}),
          ...(t.alternatives.length ? { alternatives: t.alternatives, conflict: t.conflict } : {}),
        };
      }
      await api(`/documents/${documentId}/memory/glossary`, {
        method: 'PUT',
        body: JSON.stringify({ glossary: map }),
      });
      onSaved();
    } catch (e) {
      onError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not save the glossary.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6" data-testid="glossary-editor">
      <p className="text-sm text-muted">
        Every term here goes into the block the AI reads, so it uses your definitions rather than
        the field's general ones.
      </p>
      <ul className="mt-4 space-y-3">
        {terms.map((t, i) => (
          <li key={t.key} className="rounded-md border border-line bg-surface p-3">
            <div className="flex gap-2">
              <input
                aria-label={`Term ${i + 1}`}
                value={t.term}
                onChange={(e) =>
                  setTerms((list) =>
                    list.map((x, j) => (i === j ? { ...x, term: e.target.value } : x)),
                  )
                }
                className="w-56 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-medium font-semibold text-ink transition-colors hover:bg-sunk"
              />
              <input
                aria-label={`Definition of ${t.term}`}
                value={t.definition}
                onChange={(e) =>
                  setTerms((list) =>
                    list.map((x, j) => (i === j ? { ...x, definition: e.target.value } : x)),
                  )
                }
                className="flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              />
              <button
                type="button"
                aria-label={`Remove ${t.term}`}
                onClick={() => setTerms((list) => list.filter((_, j) => j !== i))}
                className="rounded border border-line px-2 text-xs text-warn"
              >
                ×
              </button>
            </div>
            <input
              aria-label={`Usage note for ${t.term}`}
              placeholder="How you use it, where that differs from general usage"
              value={t.usageNote}
              onChange={(e) =>
                setTerms((list) =>
                  list.map((x, j) => (i === j ? { ...x, usageNote: e.target.value } : x)),
                )
              }
              className="mt-2 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-xs font-semibold text-ink transition-colors hover:bg-sunk"
            />
            {t.conflict && t.alternatives.length > 0 ? (
              <div className="mt-2 rounded-md border border-warn/40 bg-warn/5 p-2 text-xs">
                <p className="font-medium text-warn">Your papers define this differently</p>
                {t.alternatives.map((a) => (
                  <p key={`${a.paper}-${a.definition}`} className="mt-1">
                    {a.paper}: {a.definition}{' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        setTerms((list) =>
                          list.map((x, j) =>
                            i === j
                              ? {
                                  ...x,
                                  definition: a.definition,
                                  alternatives: [],
                                  conflict: false,
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      use this one
                    </button>
                  </p>
                ))}
                <button
                  type="button"
                  className="mt-1 underline"
                  onClick={() =>
                    setTerms((list) =>
                      list.map((x, j) =>
                        i === j ? { ...x, alternatives: [], conflict: false } : x,
                      ),
                    )
                  }
                >
                  keep mine
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-3 text-sm">
        <button
          type="button"
          onClick={() =>
            setTerms((list) => [
              ...list,
              {
                key: `g${Date.now().toString(36)}`,
                term: '',
                definition: '',
                usageNote: '',
                alternatives: [],
                conflict: false,
              },
            ])
          }
          className="underline"
        >
          Add a term
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-md px-3 py-1 disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
        >
          {saving ? 'Saving…' : 'Save glossary'}
        </button>
      </div>
    </section>
  );
}
