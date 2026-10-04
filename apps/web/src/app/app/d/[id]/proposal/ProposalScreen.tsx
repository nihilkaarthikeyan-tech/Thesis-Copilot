'use client';

/**
 * Stage 1 proposal screen — PRD §6.1 `/app/d/:id/proposal`, FR-1.3 and FR-1.4.
 *
 * Two halves. On the left the editable skeleton: working title, problem statement, objectives and
 * the "why this is not yet fully answered" note, pre-filled from the uploaded paper. Nothing is
 * locked (FR-1.4). On the right the gap analysis: what a thesis needs that this paper lacks, and
 * the reference gap, as a checklist the student ticks (FR-1.3 AC).
 *
 * Continue saves the skeleton to `DocumentMemory.scope`, which is what every later prompt reads.
 */

import type { GapAnalysis, PaperExtraction, ProposalScope } from '@tc/types';
import { analyseGap, draftScopeFrom } from '@tc/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FirstRunHint } from '@/components/onboarding/FirstRunHint';
import { type CrossPaper, CrossPaperFlags } from '@/components/proposal/CrossPaperFlags';
import { PathAChat, type ProposalView } from '@/components/proposal/PathAChat';
import { tNow } from '@/i18n';
import { useT } from '@/i18n/react';
import { ApiError, api } from '@/lib/api';

type SeedPaper = {
  id: string;
  filename: string;
  status: 'PENDING' | 'EXTRACTING' | 'DONE' | 'FAILED' | string;
  error: string | null;
  hasExtraction: boolean;
  extraction?: PaperExtraction | null;
};

type DocumentDetail = {
  id: string;
  title: string;
  entryPath: 'A_TOPIC' | 'B_PAPER';
  firstChapterId: string | null;
  /** Path A conversation and the cross-paper flags (PRD §9.1 "(meta)"). */
  meta: {
    proposalChat?: { skeleton?: ProposalScope | null } | null;
    crossPaper?: CrossPaper | null;
  } | null;
  /** `scope` is `{}` until the student saves the proposal for the first time. */
  memory: { scope: Partial<ProposalScope> | null } | null;
};

/**
 * FR-1.4: "downstream prompts read the edited values, never the generated ones." The same has to
 * hold for the screen itself — once a proposal is saved, re-opening it must show what the student
 * wrote, not a fresh draft off the paper, or their edits look silently lost.
 */
function savedScope(detail: DocumentDetail | null): ProposalScope | null {
  const scope = detail?.memory?.scope;
  if (!scope || typeof scope.workingTitle !== 'string' || scope.workingTitle.trim() === '') {
    return null;
  }
  return {
    workingTitle: scope.workingTitle,
    problemStatement: scope.problemStatement ?? '',
    objectives: scope.objectives ?? [],
    whyOpen: scope.whyOpen ?? '',
  };
}

/** How often to re-check a paper that is still being read. */
const POLL_MS = 2_000;

/** Starts outline generation when the thesis still has only its first, empty chapter. */
async function startOutlineIfNone(documentId: string): Promise<void> {
  try {
    const view = await api<{
      generating?: boolean;
      outline?: unknown[];
      chapters?: Array<{ wordCount?: number }>;
    }>(`/documents/${documentId}/outline`);
    const planned = (view.outline?.length ?? 0) > 1 || (view.chapters?.length ?? 0) > 1;
    const written = (view.chapters ?? []).some((c) => (c.wordCount ?? 0) > 0);
    if (view.generating || planned || written) return;
    await api(`/documents/${documentId}/outline/generate`, { method: 'POST', body: '{}' });
  } catch {
    // Best effort: the Outline page still offers "Generate outline".
  }
}

export function ProposalScreen({ documentId }: { documentId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [papers, setPapers] = useState<SeedPaper[] | null>(null);
  const [scope, setScope] = useState<ProposalScope | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, list] = await Promise.all([
        api<DocumentDetail>(`/documents/${documentId}`),
        api<SeedPaper[]>(`/documents/${documentId}/seed-papers`),
      ]);
      setDoc(detail);

      // The list omits the extraction body; fetch it for papers that have one.
      const withExtraction = await Promise.all(
        list.map(async (paper) =>
          paper.hasExtraction
            ? await api<SeedPaper>(`/documents/${documentId}/seed-papers/${paper.id}`)
            : paper,
        ),
      );
      setPapers(withExtraction);
    } catch (e) {
      if (e instanceof ApiError && e.problem.status === 401) router.replace('/sign-in');
      else setError(e instanceof Error ? e.message : tNow('proposal.loadError'));
    }
  }, [documentId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep polling while a paper is still being read.
  const stillReading = papers?.some((p) => p.status === 'PENDING' || p.status === 'EXTRACTING');
  useEffect(() => {
    if (!stillReading) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [stillReading, load]);

  const extraction = useMemo(() => papers?.find((p) => p.extraction)?.extraction ?? null, [papers]);

  // A saved proposal wins over anything drafted from the paper. Otherwise pre-fill once, when the
  // extraction first arrives; after that the student's edits stand.
  useEffect(() => {
    if (scope) return;
    const saved = savedScope(doc);
    if (saved) {
      setScope(saved);
      return;
    }
    if (extraction) setScope(draftScopeFrom(extraction));
    else if (doc?.meta?.proposalChat?.skeleton) setScope(doc.meta.proposalChat.skeleton);
  }, [doc, extraction, scope]);

  // FR-1.5: the conversation ends in the same skeleton as FR-1.4, shown in the same form.
  // A skeleton redrafted after the student changed an earlier answer replaces the form's values;
  // the edit banner says so before they send it.
  const onSkeleton = useCallback((view: ProposalView, replace = false) => {
    if (view.skeleton)
      setScope((current) => (replace ? view.skeleton : (current ?? view.skeleton)));
  }, []);
  const pathA = doc?.entryPath === 'A_TOPIC';

  const gap: GapAnalysis | null = useMemo(
    () => (extraction ? analyseGap(extraction) : null),
    [extraction],
  );

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/documents/${documentId}/seed-papers`, { method: 'POST', body: form });
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : tNow('proposal.uploadError'),
      );
    } finally {
      setUploading(false);
    }
  }

  async function saveAndContinue() {
    if (!scope) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/documents/${documentId}/memory/scope`, {
        method: 'PUT',
        body: JSON.stringify(scope),
      });
      const detail = await api<DocumentDetail>(`/documents/${documentId}`);
      // A thesis lands with its chapters (2026-10-04, from the Jenni study): when nothing has been
      // planned yet, the outline is built from this proposal in the background while the student
      // starts writing. OUTLINE is bounded per document (cost.ts) and never touches a chapter
      // that has text, so starting it here cannot cost the student or lose their work.
      await startOutlineIfNone(documentId);
      router.push(
        detail.firstChapterId
          ? `/app/d/${documentId}/write/${detail.firstChapterId}`
          : `/app/d/${documentId}/sources`,
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : tNow('proposal.saveError'),
      );
      setSaving(false);
    }
  }

  if (error && !doc) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
        <Link href="/app" className="mt-4 inline-block text-sm underline">
          {t('proposal.back')}
        </Link>
      </main>
    );
  }

  if (!doc || !papers) return <p className="p-6 text-sm text-muted">{t('common.loading')}</p>;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/app" className="hover:underline">
          {t('common.theses')}
        </Link>
        <span>/</span>
        <span className="text-ink">{doc.title}</span>
        <span>/</span>
        <span>{t('proposal.crumb')}</span>
      </nav>

      <h1 className="text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        {pathA ? t('proposal.headingTopic') : t('proposal.headingPaper')}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        {pathA ? t('proposal.ledeTopic') : t('proposal.ledePaper')}
      </p>
      {!pathA && papers && papers.length === 0 ? (
        <FirstRunHint id="proposal" className="mt-4 max-w-2xl">
          {t('proposal.firstRun')}
        </FirstRunHint>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
        >
          {error}
        </p>
      ) : null}

      {pathA ? (
        <>
          <PathAChat documentId={documentId} initialTitle={doc.title} onSkeleton={onSkeleton} />
          {/* The conversation is a help, not a gate (2026-10-04): when it fails the API says "fill
              the proposal in by hand", and until now there was no form to fill. */}
          {scope ? null : (
            <button
              type="button"
              data-testid="proposal-by-hand"
              className="mt-3 text-sm underline"
              onClick={() =>
                setScope({
                  workingTitle: doc.title,
                  problemStatement: '',
                  objectives: [],
                  whyOpen: '',
                })
              }
            >
              {t('proposal.byHand')}
            </button>
          )}
        </>
      ) : (
        <PaperStatus papers={papers} uploading={uploading} onUpload={upload} />
      )}
      {doc.meta?.crossPaper ? (
        <CrossPaperFlags documentId={documentId} flags={doc.meta.crossPaper} />
      ) : null}

      {scope ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <ProposalForm scope={scope} onChange={setScope} />
          {gap ? <GapChecklist gap={gap} ticked={ticked} onToggle={setTicked} /> : null}
        </div>
      ) : null}

      {scope ? (
        <div className="mt-8 flex items-center gap-4 border-t border-line pt-6">
          <button
            type="button"
            onClick={() => void saveAndContinue()}
            disabled={saving || scope.workingTitle.trim().length === 0}
            className="rounded-md px-4 py-2 text-sm disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
          >
            {saving ? t('common.saving') : t('proposal.continue')}
          </button>
          <Link href={`/app/d/${documentId}/outline`} className="text-sm underline">
            {t('proposal.buildOutline')}
          </Link>
          {/* A topic-path thesis has no paper of its own; its sources come from Discover. */}
          {pathA ? (
            <Link href={`/app/d/${documentId}/sources?tab=discover`} className="text-sm underline">
              {t('proposal.findPapers')}
            </Link>
          ) : (
            <Link href={`/app/d/${documentId}/sources`} className="text-sm underline">
              {t('proposal.seeSources')}
            </Link>
          )}
        </div>
      ) : null}
    </main>
  );
}

function PaperStatus({
  papers,
  uploading,
  onUpload,
}: {
  papers: SeedPaper[];
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  const { t } = useT();
  // No paper yet, or only ones that could not be read: offer the upload (again). A failed paper
  // does not count against the allowance (2026-10-04); before, this was a dead end.
  const allFailed = papers.length > 0 && papers.every((p) => p.status === 'FAILED');
  if (papers.length === 0 || allFailed) {
    return (
      <>
        {allFailed ? (
          <div className="mt-8 space-y-1 text-sm">
            {papers.map((paper) => (
              <p key={paper.id} className="text-warn">
                {paper.filename}: {paper.error ?? t('proposal.couldNotBeReadLower')}
              </p>
            ))}
          </div>
        ) : null}
        <section className="mt-8 rounded-lg border border-dashed border-line p-8 text-center">
          <p className="text-sm">
            {allFailed ? t('proposal.tryAnother') : t('proposal.uploadPrompt')}
          </p>
          <p className="mt-1 text-xs text-muted">{t('proposal.fileKinds')}</p>
          <label className="mt-4 inline-block cursor-pointer rounded-md px-4 py-2 text-sm bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors">
            {uploading ? t('proposal.uploading') : t('proposal.chooseFile')}
            <input
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
              }}
            />
          </label>
        </section>
      </>
    );
  }

  return (
    <section className="mt-8 space-y-2">
      {papers.map((paper) => (
        <div
          key={paper.id}
          className="flex items-center justify-between rounded-md border border-line bg-paper px-4 py-3 text-sm"
        >
          <span className="font-medium">{paper.filename}</span>
          <span className={paper.status === 'FAILED' ? 'text-warn' : 'text-muted'}>
            {paper.status === 'DONE'
              ? t('proposal.read')
              : paper.status === 'FAILED'
                ? (paper.error ?? t('proposal.couldNotBeRead'))
                : t('proposal.reading')}
          </span>
        </div>
      ))}
    </section>
  );
}

function ProposalForm({
  scope,
  onChange,
}: {
  scope: ProposalScope;
  onChange: (next: ProposalScope) => void;
}) {
  const { t } = useT();
  const field = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm';

  return (
    <section className="space-y-5">
      <div>
        <label className="text-sm font-medium" htmlFor="workingTitle">
          {t('common.workingTitle')}
        </label>
        <input
          id="workingTitle"
          className={field}
          value={scope.workingTitle}
          onChange={(e) => onChange({ ...scope, workingTitle: e.target.value })}
        />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="problemStatement">
          {t('proposal.problem')}
        </label>
        <p className="text-xs text-muted">{t('proposal.problemHint')}</p>
        <textarea
          id="problemStatement"
          rows={4}
          className={field}
          value={scope.problemStatement}
          onChange={(e) => onChange({ ...scope, problemStatement: e.target.value })}
        />
      </div>

      <div>
        <span className="text-sm font-medium">{t('proposal.objectives')}</span>
        <p className="text-xs text-muted">{t('proposal.objectivesHint')}</p>
        <ul className="mt-1 space-y-2">
          {scope.objectives.map((objective, index) => (
            // Index is the identity here: these are positional rows the student edits in place.
            // biome-ignore lint/suspicious/noArrayIndexKey: the list is positional and reorderable
            <li key={index} className="flex gap-2">
              <input
                aria-label={t('proposal.objective', { n: index + 1 })}
                className={`${field} mt-0`}
                value={objective}
                onChange={(e) => {
                  const next = [...scope.objectives];
                  next[index] = e.target.value;
                  onChange({ ...scope, objectives: next });
                }}
              />
              <button
                type="button"
                aria-label={t('proposal.removeObjective', { n: index + 1 })}
                className="px-2 text-muted hover:text-warn"
                onClick={() =>
                  onChange({ ...scope, objectives: scope.objectives.filter((_, i) => i !== index) })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-2 text-sm underline"
          onClick={() => onChange({ ...scope, objectives: [...scope.objectives, ''] })}
        >
          {t('proposal.addObjective')}
        </button>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="whyOpen">
          {t('proposal.whyOpen')}
        </label>
        <p className="text-xs text-muted">{t('proposal.whyOpenHint')}</p>
        <textarea
          id="whyOpen"
          rows={3}
          className={field}
          placeholder={t('proposal.whyOpenPlaceholder')}
          value={scope.whyOpen}
          onChange={(e) => onChange({ ...scope, whyOpen: e.target.value })}
        />
      </div>
    </section>
  );
}

function GapChecklist({
  gap,
  ticked,
  onToggle,
}: {
  gap: GapAnalysis;
  ticked: Set<string>;
  onToggle: (next: Set<string>) => void;
}) {
  const { t } = useT();
  return (
    <aside className="rounded-md border border-line bg-paper p-5">
      <h2 className="text-balance text-[17px] font-bold leading-snug text-ink">
        {t('proposal.gapTitle')}
      </h2>
      <p className="mt-1 text-xs text-muted">{t('proposal.gapHint')}</p>

      <ul className="mt-4 space-y-3">
        {gap.items.map((item) => (
          <li key={item.id} className="flex gap-3">
            <input
              type="checkbox"
              id={`gap-${item.id}`}
              className="mt-1"
              checked={ticked.has(item.id)}
              onChange={(e) => {
                const next = new Set(ticked);
                if (e.target.checked) next.add(item.id);
                else next.delete(item.id);
                onToggle(next);
              }}
            />
            <label htmlFor={`gap-${item.id}`} className="text-sm">
              <span className={item.present ? 'text-muted' : 'font-medium'}>{item.label}</span>
              <span className="block text-xs text-muted">{item.detail}</span>
            </label>
          </li>
        ))}
      </ul>
    </aside>
  );
}
