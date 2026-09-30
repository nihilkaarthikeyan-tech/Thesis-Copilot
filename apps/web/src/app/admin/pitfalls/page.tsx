'use client';

/**
 * `/admin/pitfalls` — the pitfall bank (ADR-0039, spec §8).
 *
 * Known technical errors the chapter build's checks and examiner look for, per discipline. The
 * specification's entries came in approved; a student's or supervisor's report waits here as
 * pending until an administrator approves it, edits it, or retires it. Hit counts show which
 * errors the writer keeps making, which is where the prompt needs strengthening (§8.2).
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { problemText, when } from '@/components/admin/kit';
import { Button } from '@/components/ui/button';
import { Badge, Input, PageHeader, Select, Textarea } from '@/components/ui/primitives';
import { isSessionGone, signInUrlFor } from '@/lib/admin-gate';
import { api } from '@/lib/api';

type Pitfall = {
  id: string;
  code: string;
  profile: string;
  profileName: string;
  topic: string;
  wrongPattern: string;
  pattern: string | null;
  detection: string;
  correctStatement: string;
  severity: string;
  source: string | null;
  status: string;
  hits: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type Profiles = { disciplines: Array<{ id: string; displayName: string }> };

const EMPTY = {
  profile: 'engineering_core_v1',
  topic: '',
  wrongPattern: '',
  pattern: '',
  correctStatement: '',
  severity: 'blocking',
  source: '',
};

export default function AdminPitfallsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'RETIRED' | 'ALL'>('ALL');
  const [rows, setRows] = useState<Pitfall[] | null>(null);
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api<Pitfall[]>(`/admin/pitfalls?status=${status}`)
      .then(setRows)
      .catch((e: unknown) => {
        if (isSessionGone(e)) router.replace(signInUrlFor('/admin/pitfalls'));
        else setError(problemText(e, 'Could not load the pitfall bank.'));
      });
  }, [router, status]);

  useEffect(() => {
    load();
    api<Profiles>('/chapter-build/profiles')
      .then(setProfiles)
      .catch(() => undefined);
  }, [load]);

  async function act(id: string, action: 'approve' | 'retire' | 'pending') {
    setBusy(true);
    try {
      await api(`/admin/pitfalls/${id}/${action}`, { method: 'POST', body: '{}' });
      load();
    } catch (e) {
      setError(problemText(e, 'Could not change the entry.'));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/pitfalls', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          pattern: form.pattern.trim() || null,
          source: form.source.trim() || null,
          detection: form.pattern.trim() ? 'both' : 'semantic',
        }),
      });
      setForm(EMPTY);
      setAdding(false);
      load();
    } catch (e) {
      setError(problemText(e, 'Could not add the entry.'));
    } finally {
      setBusy(false);
    }
  }

  const pending = rows?.filter((r) => r.status === 'PENDING').length ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      <PageHeader
        title="Pitfall bank"
        lede="Known technical errors the chapter build checks for, by discipline. Reports from students wait here until you approve them."
      />
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          data-testid="pitfalls-status"
        >
          <option value="ALL">All entries</option>
          <option value="PENDING">Waiting for approval{pending ? ` (${pending})` : ''}</option>
          <option value="APPROVED">Approved</option>
          <option value="RETIRED">Retired</option>
        </Select>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setAdding((v) => !v)}
          data-testid="pitfalls-add"
        >
          {adding ? 'Cancel' : 'Add an entry'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}

      {adding ? (
        <form
          className="mt-4 grid gap-3 rounded-md border border-line bg-surface p-4 text-sm sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="text-xs text-muted" htmlFor="pf-f1">
            Discipline
            <Select
              id="pf-f1"
              value={form.profile}
              onChange={(e) => setForm({ ...form, profile: e.target.value })}
              className="mt-1 w-full"
            >
              <option value="*">Every discipline</option>
              {profiles?.disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-muted" htmlFor="pf-f2">
            Topic
            <Input
              id="pf-f2"
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              className="mt-1 w-full"
              required
            />
          </label>
          <label className="text-xs text-muted sm:col-span-2" htmlFor="pf-f3">
            The wrong statement
            <Textarea
              id="pf-f3"
              value={form.wrongPattern}
              onChange={(e) => setForm({ ...form, wrongPattern: e.target.value })}
              className="mt-1 w-full"
              rows={2}
              required
            />
          </label>
          <label className="text-xs text-muted sm:col-span-2" htmlFor="pf-f4">
            The correct statement
            <Textarea
              id="pf-f4"
              value={form.correctStatement}
              onChange={(e) => setForm({ ...form, correctStatement: e.target.value })}
              className="mt-1 w-full"
              rows={2}
              required
            />
          </label>
          <label className="text-xs text-muted" htmlFor="pf-f5">
            Pattern (a regular expression, optional — with one the check runs in code)
            <Input
              id="pf-f5"
              value={form.pattern}
              onChange={(e) => setForm({ ...form, pattern: e.target.value })}
              className="mt-1 w-full font-mono"
            />
          </label>
          <label className="text-xs text-muted" htmlFor="pf-f6">
            Severity
            <Select
              id="pf-f6"
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value })}
              className="mt-1 w-full"
            >
              <option value="blocking">Blocking</option>
              <option value="warning">Warning</option>
            </Select>
          </label>
          <label className="text-xs text-muted sm:col-span-2" htmlFor="pf-f7">
            Source (where this error was seen, or the reference for the correction)
            <Input
              id="pf-f7"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="mt-1 w-full"
            />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={busy}>
              Add as approved
            </Button>
          </div>
        </form>
      ) : null}

      <div
        className="mt-4 divide-y divide-line rounded-md border border-line bg-surface text-sm"
        data-testid="pitfalls-list"
      >
        {rows === null ? (
          <p className="p-4 text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-muted">Nothing here.</p>
        ) : (
          rows.map((r) => (
            <article key={r.id} className="p-4">
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-muted">{r.code}</span>
                <span className="text-muted">{r.profileName}</span>
                <span className="text-faint">{r.topic}</span>
                <Badge
                  tone={
                    r.status === 'APPROVED' ? 'ok' : r.status === 'PENDING' ? 'warn' : 'neutral'
                  }
                >
                  {r.status.toLowerCase()}
                </Badge>
                <Badge tone={r.severity === 'blocking' ? 'danger' : 'warn'}>{r.severity}</Badge>
                {r.pattern ? <span className="text-faint">pattern</span> : null}
                <span className="ml-auto text-faint">
                  {r.hits} hit{r.hits === 1 ? '' : 's'} · {when(r.updatedAt)}
                </span>
              </p>
              <p className="mt-2">
                <span className="text-muted">Wrong: </span>
                <span className="text-ink">{r.wrongPattern}</span>
              </p>
              <p className="mt-1">
                <span className="text-muted">Correct: </span>
                <span className="text-ink">{r.correctStatement}</span>
              </p>
              {r.source ? <p className="mt-1 text-xs text-faint">{r.source}</p> : null}
              <div className="mt-2 flex gap-2">
                {r.status !== 'APPROVED' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void act(r.id, 'approve')}
                  >
                    Approve
                  </Button>
                ) : null}
                {r.status !== 'RETIRED' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void act(r.id, 'retire')}
                  >
                    Retire
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void act(r.id, 'pending')}
                  >
                    Back to pending
                  </Button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </main>
  );
}
