'use client';

/**
 * `/app/d/:id/build` — chapter build (ADR-0039).
 *
 * The student picks a chapter, confirms the discipline, paradigm and university, and starts one
 * build. The worker plans the chapter from the blueprint and the thesis's key terms, writes each
 * section from the library, checks it, has the examiner review it, fixes what it can once, and
 * delivers the sections as pending drafts in the chapter with the QA report shown here. Nothing
 * becomes thesis text until the student accepts each block in the editor.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Select } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

type Profile = { disciplineId: string; paradigm: string; universityId: string; language?: string };
type Profiles = {
  disciplines: Array<{
    id: string;
    displayName: string;
    departments: string[];
    defaultParadigms: string[];
    entityTypes: Array<{ code: string; label: string }>;
    specialChecks: string[];
    sensitiveNote: string | null;
  }>;
  paradigms: Array<{ id: string; label: string }>;
  universities: Array<{ id: string; displayName: string; spelling: string; confirmed: boolean }>;
};
type Progress = { stage: string; sectionsTotal: number; sectionsDone: number; note?: string };
type BuildSummary = {
  id: string;
  chapterId: string;
  chapterTitle: string;
  status: string;
  progress: Progress | null;
  createdAt: string;
  finishedAt: string | null;
  blockingOpen: number | null;
  sections: number | null;
  error: string | null;
};
type Overview = {
  profile: Profile;
  suggested: boolean;
  chapters: Array<{
    id: string;
    title: string;
    order: number;
    wordCount: number;
    pendingBuild: boolean;
  }>;
  builds: BuildSummary[];
  remaining: { used: number; cap: number } | null;
  hasCoAuthor: boolean;
};
type Issue = {
  id: string;
  checkId: string;
  severity: 'blocking' | 'warning';
  sectionId: string;
  sentence: string;
  explanation: string;
  suggestedFix: string;
  status: 'open' | 'fixed' | 'accepted_by_user';
  pitfallCode?: string;
  by: 'code' | 'examiner';
  userNote?: string;
};
type Report = {
  sections: Array<{
    id: string;
    title: string;
    status: string;
    words: number;
    citations: number;
    needsSource: string[];
    draftId: string | null;
    note?: string;
  }>;
  checks: Array<{
    checkId: string;
    label: string;
    status: 'pass' | 'fail' | 'warn' | 'skipped';
    open: number;
    fixed: number;
    corrected?: number;
    note?: string;
  }>;
  issues: Issue[];
  evidenceNeeded: Array<{ sectionId: string; note: string }>;
  references: Array<{
    sourceId: string;
    shortRef: string;
    title: string | null;
    year: number | null;
    doi: string | null;
    status: string;
    grounding: string;
    uses: number;
  }>;
  similarity: { copiedRuns: number; checkedWords: number };
  totals: {
    words: number;
    citations: number;
    blockingOpen: number;
    warningsOpen: number;
    fixed: number;
    spentInr: number;
  };
  disclosure: string;
  sensitiveNote?: string;
  universityUnconfirmed: boolean;
};
type Plan = {
  chapterRole: string;
  entities: Array<{
    id: string;
    text: string;
    type: string;
    sourceObjective: number;
    coveredBy: string[];
  }>;
  sections: Array<{ id: string; title: string; isObjectives: boolean }>;
  coverage: Record<string, string[]>;
  uncovered: string[];
};
type BuildView = BuildSummary & { profile: Profile; plan: Plan | null; report: Report | null };

const STAGE_LABEL: Record<string, string> = {
  loading: 'Reading the thesis',
  extracting: 'Finding the key terms',
  planning: 'Planning the chapter',
  evidence: 'Gathering sources',
  drafting: 'Writing',
  assembling: 'Joining the sections',
  checking: 'Running the checks',
  examining: 'Examiner review',
  fixing: 'Fixing flagged sentences',
  delivering: 'Placing the drafts in your chapter',
};

const problem = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;

export function BuildScreen({ documentId }: { documentId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [title, setTitle] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chapterId, setChapterId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [next, doc] = await Promise.all([
      api<Overview>(`/documents/${documentId}/chapter-build`),
      api<{ title: string }>(`/documents/${documentId}`),
    ]);
    setOverview(next);
    setTitle(doc.title);
    setProfile((current) => current ?? next.profile);
    setChapterId((current) => current || next.chapters[0]?.id || '');
    setSelected((current) => current ?? next.builds[0]?.id ?? null);
    return next;
  }, [documentId]);

  useEffect(() => {
    void (async () => {
      try {
        const [, p] = await Promise.all([load(), api<Profiles>('/chapter-build/profiles')]);
        setProfiles(p);
      } catch (e) {
        setError(problem(e, 'Could not load the chapter build screen.'));
      }
    })();
  }, [load]);

  // A running build is polled every few seconds until the worker has finished it.
  const running =
    overview?.builds.some((b) => b.status === 'QUEUED' || b.status === 'RUNNING') ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load().catch(() => undefined), 3000);
    return () => clearInterval(timer);
  }, [running, load]);

  const start = async () => {
    if (!profile || !chapterId) return;
    setBusy(true);
    setError(null);
    try {
      const { buildId } = await api<{ buildId: string }>(`/documents/${documentId}/chapter-build`, {
        method: 'POST',
        body: JSON.stringify({ chapterId, profile }),
      });
      setSelected(buildId);
      await load();
    } catch (e) {
      setError(problem(e, 'Could not start the build. Nothing was charged.'));
    } finally {
      setBusy(false);
    }
  };

  const discipline = profiles?.disciplines.find((d) => d.id === profile?.disciplineId) ?? null;
  const university = profiles?.universities.find((u) => u.id === profile?.universityId) ?? null;
  const chapter = overview?.chapters.find((c) => c.id === chapterId) ?? null;
  const left = overview?.remaining
    ? Math.max(0, overview.remaining.cap - overview.remaining.used)
    : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        / Build a chapter
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Build a chapter
        {title ? <span className="block text-base text-muted">{title}</span> : null}
      </h1>

      <section className="mt-6 rounded-md border border-line bg-surface p-4 text-sm">
        <p>
          The build plans the chapter from your objectives and your discipline’s blueprint, writes
          each section from the sources in your library, joins and checks it, has an examiner review
          it, fixes what it can once, and places every section in your chapter as a draft for you to
          accept or discard. The QA report shows everything that was checked and everything still
          open. Nothing enters the thesis until you accept it.
        </p>

        {profiles && profile ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted" htmlFor="bs-f1">
              Chapter
              <Select
                id="bs-f1"
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
                className="mt-1 w-full"
                data-testid="build-chapter"
              >
                {overview?.chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.order + 1}. {c.title}
                    {c.pendingBuild ? ' (drafts waiting)' : ''}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-muted" htmlFor="bs-f2">
              Discipline{overview?.suggested ? ' (suggested from your field — check it)' : ''}
              <Select
                id="bs-f2"
                value={profile.disciplineId}
                onChange={(e) => {
                  const next = profiles.disciplines.find((d) => d.id === e.target.value);
                  setProfile({
                    ...profile,
                    disciplineId: e.target.value,
                    paradigm:
                      next && !next.defaultParadigms.includes(profile.paradigm)
                        ? (next.defaultParadigms[0] ?? profile.paradigm)
                        : profile.paradigm,
                  });
                }}
                className="mt-1 w-full"
                data-testid="build-discipline"
              >
                {profiles.disciplines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-muted" htmlFor="bs-f3">
              Research paradigm
              <Select
                id="bs-f3"
                value={profile.paradigm}
                onChange={(e) => setProfile({ ...profile, paradigm: e.target.value })}
                className="mt-1 w-full"
                data-testid="build-paradigm"
              >
                {profiles.paradigms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {discipline?.defaultParadigms.includes(p.id)
                      ? ' · usual in this discipline'
                      : ''}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-muted" htmlFor="bs-f4">
              University profile
              <Select
                id="bs-f4"
                value={profile.universityId}
                onChange={(e) => setProfile({ ...profile, universityId: e.target.value })}
                className="mt-1 w-full"
                data-testid="build-university"
              >
                {profiles.universities.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        ) : null}

        {discipline ? (
          <p className="mt-3 text-xs text-muted">
            Key terms this discipline looks for:{' '}
            {discipline.entityTypes.map((t) => t.label).join(', ')}.
            {discipline.specialChecks.length > 0
              ? ` Extra checks: ${discipline.specialChecks.join(', ')}.`
              : ''}
            {discipline.sensitiveNote ? ` ${discipline.sensitiveNote}` : ''}
          </p>
        ) : null}
        {university && !university.confirmed ? (
          <p className="mt-2 text-xs text-warn">
            This university profile has not yet been checked against the university’s own thesis
            manual. Its citation form and spelling are common defaults; confirm them with your
            department.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void start()}
            disabled={
              busy ||
              running ||
              !chapterId ||
              left === 0 ||
              overview?.hasCoAuthor ||
              chapter?.pendingBuild
            }
            data-testid="build-start"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {running ? 'Building…' : busy ? 'Starting…' : 'Build this chapter'}
          </button>
          <span className="text-xs text-muted" data-testid="build-left">
            {left !== null && overview?.remaining
              ? `${left} of ${overview.remaining.cap} chapter builds left this month`
              : 'One build is one unit of your monthly allowance'}
          </span>
        </div>
        {overview?.hasCoAuthor ? (
          <p className="mt-2 text-xs text-warn">
            This thesis has a co-author with live editing, so chapter builds are off for it.
          </p>
        ) : null}
        {chapter?.pendingBuild ? (
          <p className="mt-2 text-xs text-warn">
            This chapter still has built sections waiting for your decision.{' '}
            <Link href={`/app/d/${documentId}/write/${chapter.id}`} className="underline">
              Open it
            </Link>{' '}
            and accept or discard them first.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-warn">
            {error}
          </p>
        ) : null}
      </section>

      {overview && overview.builds.length > 0 ? (
        <section className="mt-6">
          <h2 className="eyebrow">Builds</h2>
          <ul
            className="mt-3 divide-y divide-line rounded-md border border-line bg-surface text-sm"
            data-testid="build-list"
          >
            {overview.builds.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelected(b.id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-2 ${selected === b.id ? 'bg-surface-2' : ''}`}
                >
                  <span>
                    <span className="font-medium text-ink">{b.chapterTitle}</span>
                    <span className="ml-2 text-xs text-muted">
                      {new Date(b.createdAt).toLocaleString()}
                    </span>
                  </span>
                  <StatusBadge build={b} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected ? (
        <BuildDetail
          documentId={documentId}
          buildId={selected}
          running={running}
          onChanged={() => void load()}
        />
      ) : null}
    </main>
  );
}

function StatusBadge({ build }: { build: BuildSummary }) {
  if (build.status === 'RUNNING' || build.status === 'QUEUED') {
    const p = build.progress;
    return (
      <Badge tone="accent">
        {p
          ? `${STAGE_LABEL[p.stage] ?? p.stage}${p.sectionsTotal ? ` · ${p.sectionsDone}/${p.sectionsTotal}` : ''}`
          : 'Queued'}
      </Badge>
    );
  }
  if (build.status === 'DONE') {
    return build.blockingOpen ? (
      <Badge tone="warn">{build.blockingOpen} open blocking</Badge>
    ) : (
      <Badge tone="ok">All checks passed</Badge>
    );
  }
  if (build.status === 'REFUSED') return <Badge tone="warn">Not built · unit returned</Badge>;
  return <Badge tone="danger">Failed · unit returned</Badge>;
}

function BuildDetail({
  documentId,
  buildId,
  running,
  onChanged,
}: {
  documentId: string;
  buildId: string;
  running: boolean;
  onChanged: () => void;
}) {
  const [view, setView] = useState<BuildView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'checks' | 'issues' | 'coverage' | 'references' | 'sections'>(
    'checks',
  );

  const load = useCallback(async () => {
    try {
      setView(await api<BuildView>(`/documents/${documentId}/chapter-build/${buildId}`));
    } catch (e) {
      setError(problem(e, 'Could not load the build.'));
    }
  }, [documentId, buildId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [running, load]);

  if (error) return <p className="mt-6 text-sm text-warn">{error}</p>;
  if (!view) return <p className="mt-6 text-sm text-muted">Loading the build…</p>;

  const report = view.report;
  const plan = view.plan;

  if (view.status === 'QUEUED' || view.status === 'RUNNING') {
    const p = view.progress;
    return (
      <section
        className="mt-6 rounded-md border border-line bg-surface p-4 text-sm"
        data-testid="build-progress"
      >
        <p className="font-medium text-ink">{p ? (STAGE_LABEL[p.stage] ?? p.stage) : 'Queued'}</p>
        {p?.note ? <p className="mt-1 text-xs text-muted">{p.note}</p> : null}
        {p && p.sectionsTotal > 0 ? (
          <div className="mt-3 h-2 w-full overflow-hidden rounded bg-surface-2">
            <div
              className="h-2 bg-accent"
              style={{ width: `${Math.round((p.sectionsDone / p.sectionsTotal) * 100)}%` }}
            />
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted">
          A chapter takes a few minutes. You can leave this page; the build carries on.
        </p>
      </section>
    );
  }

  if (!report) {
    return (
      <section
        className="mt-6 rounded-md border border-line bg-surface p-4 text-sm"
        data-testid="build-failed"
      >
        <p className="text-warn">{view.error ?? 'The build did not finish.'}</p>
        <p className="mt-1 text-xs text-muted">Your allowance unit was returned.</p>
      </section>
    );
  }

  const decide = async (issue: Issue, action: 'accept' | 'reopen') => {
    const note =
      action === 'accept'
        ? (window.prompt('Why is this not a problem here? (kept in the report)') ?? '')
        : undefined;
    if (action === 'accept' && note === null) return;
    try {
      await api(`/documents/${documentId}/chapter-build/${buildId}/issues/${issue.id}`, {
        method: 'POST',
        body: JSON.stringify({ action, note }),
      });
      await load();
      onChanged();
    } catch (e) {
      setError(problem(e, 'Could not record your decision.'));
    }
  };

  const sectionTitle = (id: string) =>
    report.sections.find((s) => s.id === id)?.title ?? (id === 'chapter' ? 'Whole chapter' : id);
  const openIssues = report.issues.filter((i) => i.status === 'open');
  const tabs: Array<[typeof tab, string]> = [
    ['checks', `Checks`],
    ['issues', `Open issues (${openIssues.length})`],
    ['coverage', 'Key terms'],
    ['references', `References (${report.references.length})`],
    ['sections', `Sections (${report.sections.length})`],
  ];

  return (
    <section className="mt-6" data-testid="build-report">
      <div className="rounded-md border border-line bg-surface p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-bold text-ink">QA report · {view.chapterTitle}</h2>
          <StatusBadge build={view} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <dt className="text-muted">Words written</dt>
          <dd className="text-ink">{report.totals.words.toLocaleString()}</dd>
          <dt className="text-muted">Citations</dt>
          <dd className="text-ink">{report.totals.citations}</dd>
          <dt className="text-muted">Fixed by the build</dt>
          <dd className="text-ink">{report.totals.fixed}</dd>
          <dt className="text-muted">Open: blocking / warnings</dt>
          <dd className="text-ink">
            {report.totals.blockingOpen} / {report.totals.warningsOpen}
          </dd>
        </dl>
        {view.status === 'DONE' ? (
          <p className="mt-3 text-xs text-muted">
            The sections are in your chapter as drafts.{' '}
            <Link
              href={`/app/d/${documentId}/write/${view.chapterId}`}
              className="text-accent underline"
              data-testid="build-open-chapter"
            >
              Open the chapter
            </Link>{' '}
            to read each one and accept or discard it. Read the open issues first.
          </p>
        ) : (
          <p className="mt-3 text-xs text-warn">{view.error}</p>
        )}
        {report.sensitiveNote ? (
          <p className="mt-2 text-xs text-muted">{report.sensitiveNote}</p>
        ) : null}
        {report.universityUnconfirmed ? (
          <p className="mt-2 text-xs text-muted">
            The university profile’s citation and spelling rules are unconfirmed defaults.
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-1 border-b border-line text-sm">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-2 ${tab === key ? 'border-b-2 border-accent font-semibold text-ink' : 'text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'checks' ? (
        <table className="mt-3 w-full text-left text-sm" data-testid="build-checks">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 pr-2">Check</th>
              <th className="py-1 pr-2">Result</th>
              <th className="py-1 pr-2">Open</th>
              <th className="py-1">Fixed / corrected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {report.checks
              .filter((c) => c.status !== 'skipped')
              .map((c) => (
                <tr key={c.checkId}>
                  <td className="py-1.5 pr-2">
                    <span className="mr-2 font-mono text-xs text-muted">{c.checkId}</span>
                    {c.label}
                    {c.note ? <span className="ml-1 text-xs text-faint">· {c.note}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Badge
                      tone={c.status === 'pass' ? 'ok' : c.status === 'fail' ? 'danger' : 'warn'}
                    >
                      {c.status === 'pass' ? 'Pass' : c.status === 'fail' ? 'Fail' : 'Warning'}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-2">{c.open}</td>
                  <td className="py-1.5">
                    {c.corrected !== undefined ? `${c.corrected} corrected` : c.fixed}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : null}

      {tab === 'issues' ? (
        <ul className="mt-3 space-y-3" data-testid="build-issues">
          {report.issues.filter((i) => i.status !== 'fixed').length === 0 ? (
            <li className="text-sm text-muted">
              Nothing open. Every check passed or was fixed by the build.
            </li>
          ) : null}
          {report.issues
            .filter((i) => i.status !== 'fixed')
            .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1))
            .map((issue) => (
              <li
                key={issue.id}
                className={`rounded-md border border-line bg-surface p-3 text-sm ${issue.status !== 'open' ? 'opacity-60' : ''}`}
              >
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={issue.severity === 'blocking' ? 'danger' : 'warn'}>
                    {issue.severity}
                  </Badge>
                  <span className="font-mono text-muted">{issue.checkId}</span>
                  <span className="text-muted">{sectionTitle(issue.sectionId)}</span>
                  <span className="text-faint">
                    {issue.by === 'examiner' ? 'examiner review' : 'check'}
                  </span>
                  {issue.pitfallCode ? (
                    <span className="text-faint">pitfall {issue.pitfallCode}</span>
                  ) : null}
                  {issue.status === 'accepted_by_user' ? (
                    <Badge tone="neutral">dismissed by you</Badge>
                  ) : null}
                </p>
                {issue.sentence ? (
                  <p className="mt-2 font-serif text-[15px] text-ink">“{issue.sentence}”</p>
                ) : null}
                <p className="mt-1 text-muted">{issue.explanation}</p>
                {issue.suggestedFix ? (
                  <p className="mt-1 text-ink">Suggested: {issue.suggestedFix}</p>
                ) : null}
                {issue.userNote ? (
                  <p className="mt-1 text-xs text-faint">Your note: {issue.userNote}</p>
                ) : null}
                <div className="mt-2 flex gap-3 text-xs">
                  {issue.status === 'open' ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void decide(issue, 'accept')}
                    >
                      Not a problem here
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void decide(issue, 'reopen')}
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </li>
            ))}
        </ul>
      ) : null}

      {tab === 'coverage' && plan ? (
        <div className="mt-3 text-sm" data-testid="build-coverage">
          {plan.entities.length === 0 ? (
            <p className="text-muted">
              No key terms were found in the objectives. Add objectives on the proposal screen for
              the coverage check to work.
            </p>
          ) : (
            <table className="w-full text-left">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 pr-2">Key term</th>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">From objective</th>
                  <th className="py-1">Introduced in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {plan.entities.map((e) => {
                  const where = plan.coverage[e.id] ?? [];
                  const uncovered = plan.uncovered.includes(e.text);
                  return (
                    <tr key={e.id}>
                      <td className="py-1.5 pr-2 text-ink">{e.text}</td>
                      <td className="py-1.5 pr-2 text-xs text-muted">
                        {e.type.toLowerCase().replace(/_/g, ' ')}
                      </td>
                      <td className="py-1.5 pr-2">{e.sourceObjective || '—'}</td>
                      <td className="py-1.5">
                        {uncovered ? (
                          <Badge tone="danger">not before the objectives</Badge>
                        ) : where.length > 0 ? (
                          where.map(sectionTitle).join(', ')
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {tab === 'references' ? (
        <div className="mt-3 text-sm" data-testid="build-references">
          <table className="w-full text-left">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-2">Source</th>
                <th className="py-1 pr-2">Record</th>
                <th className="py-1 pr-2">Read from</th>
                <th className="py-1">Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.references.map((r) => (
                <tr key={r.sourceId}>
                  <td className="py-1.5 pr-2">
                    <span className="text-ink">{r.shortRef}</span>
                    {r.title ? <span className="block text-xs text-muted">{r.title}</span> : null}
                    {r.doi ? (
                      <a
                        href={`https://doi.org/${r.doi}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent underline"
                      >
                        {r.doi}
                      </a>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Badge tone={r.status === 'RESOLVED' ? 'ok' : 'danger'}>
                      {r.status === 'RESOLVED' ? '✓ resolved' : `✗ ${r.status.toLowerCase()}`}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-2 text-xs text-muted">
                    {r.grounding === 'FULL_TEXT'
                      ? 'full text'
                      : r.grounding === 'ABSTRACT'
                        ? 'abstract only'
                        : 'no text'}
                  </td>
                  <td className="py-1.5">{r.uses}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            Similarity: {report.similarity.copiedRuns} run(s) of twelve or more words copied from a
            source, over {report.similarity.checkedWords.toLocaleString()} words checked.
          </p>
        </div>
      ) : null}

      {tab === 'sections' ? (
        <div className="mt-3 space-y-2 text-sm" data-testid="build-sections">
          {report.sections.map((s) => (
            <div key={s.id} className="rounded-md border border-line bg-surface p-3">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{s.title}</span>
                <Badge
                  tone={
                    s.status === 'passed'
                      ? 'ok'
                      : s.status === 'fixed'
                        ? 'accent'
                        : s.status === 'drafted'
                          ? 'neutral'
                          : s.status === 'failed_validation'
                            ? 'warn'
                            : 'danger'
                  }
                >
                  {s.status.replace(/_/g, ' ')}
                </Badge>
              </p>
              <p className="mt-1 text-xs text-muted">
                {s.words} words · {s.citations} citations
                {s.note ? ` · ${s.note}` : ''}
              </p>
              {s.needsSource.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-xs text-warn">
                  {s.needsSource.map((n) => (
                    <li key={n}>Needs a source: {n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          {report.evidenceNeeded.length > 0 ? (
            <p className="text-xs text-muted">
              {report.evidenceNeeded.length} place(s) need a source the library does not have. Add
              papers on those points and build again, or write them yourself.
            </p>
          ) : null}
          <details className="rounded-md border border-line bg-surface p-3 text-xs text-muted">
            <summary className="cursor-pointer text-ink">
              AI-assistance statement you may paste into the thesis
            </summary>
            <p className="mt-2">{report.disclosure}</p>
          </details>
        </div>
      ) : null}
    </section>
  );
}
