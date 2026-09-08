'use client';

/**
 * `/institution` — PRD FR-9.6, PHASES v2 B4.1.
 *
 * The screen a department administrator opens: how many seats are used, who is using them, how to
 * invite the rest, which formatting template everyone starts on, and the invoice for a period.
 *
 * What is deliberately not here: any thesis. Not a title, not a chapter count that hints at
 * content, not a word of anyone's writing (§12.2). A department pays for seats and has a real
 * interest in whether they are used; it has none in what a student is writing, and a screen that
 * showed it would be read as permission.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Seats = {
  total: number;
  members: number;
  pendingInvites: number;
  used: number;
  free: number;
};

type Institution = {
  id: string;
  name: string;
  seats: Seats;
  seatPriceInr: number;
  billingPeriod: string;
  billingEmail: string | null;
  template: { id: string; name: string } | null;
  templates: Array<{ id: string; name: string; isExample: boolean }>;
};

type Invite = {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  invitedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

type Student = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  joinedAt: string;
  lastActiveAt: string | null;
  documents: number;
  costInr: number;
  usage: Array<{ action: string; used: number; cap: number }>;
};

const when = (value: string | null): string =>
  value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

export default function InstitutionPage() {
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [email, setEmail] = useState('');
  const [period, setPeriod] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{ url: string; filename: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [row, inviteRows, usage] = await Promise.all([
        api<Institution>('/institutions/me'),
        api<Invite[]>('/institutions/me/invites'),
        api<Student[]>('/institutions/me/usage'),
      ]);
      setInstitution(row);
      setInvites(inviteRows);
      setStudents(usage);
      setPeriod(
        (current) =>
          current ||
          (row.billingPeriod === 'monthly'
            ? new Date().toISOString().slice(0, 7)
            : String(new Date().getUTCFullYear())),
      );
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not load this institution.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy('invite');
    setError(null);
    setNotice(null);
    try {
      await api('/institutions/me/invites', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setNotice(`Invited ${email.trim()}. They join when they next sign in.`);
      setEmail('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not invite.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    try {
      await api(`/institutions/me/invites/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not revoke.');
    } finally {
      setBusy(null);
    }
  }

  async function chooseTemplate(templateId: string) {
    setBusy('template');
    try {
      await api('/institutions/me/template', {
        method: 'PUT',
        body: JSON.stringify({ templateId: templateId || null }),
      });
      setNotice('Saved. New theses in this institution start on that template.');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    } finally {
      setBusy(null);
    }
  }

  async function buildInvoice() {
    setBusy('invoice');
    setError(null);
    try {
      const result = await api<{ url: string; filename: string }>(
        `/institutions/me/invoices/${period}`,
        { method: 'POST' },
      );
      setInvoice(result);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not build it.',
      );
    } finally {
      setBusy(null);
    }
  }

  if (!institution) {
    return <p className="p-6 text-sm text-muted">{error ?? 'Loading…'}</p>;
  }

  const pending = invites.filter((i) => i.status === 'PENDING');
  const { seats } = institution;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        / Institution
      </nav>
      <h1 className="mt-2 font-serif text-2xl">{institution.name}</h1>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" data-testid="institution-notice" className="mt-4 text-sm">
          {notice}
        </p>
      ) : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Seats', value: seats.total },
          { label: 'Students', value: seats.members },
          { label: 'Invitations waiting', value: seats.pendingInvites },
          { label: 'Free', value: seats.free },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-line bg-surface p-3">
            <p className="text-xs text-muted">{card.label}</p>
            <p className="mt-1 text-xl" data-testid={`seat-${card.label.toLowerCase()}`}>
              {card.value}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Invite a student</h2>
        <p className="mt-1 text-xs text-muted">
          An invitation holds a seat until it is accepted or revoked, so the count here is what you
          are actually committed to. The student joins the next time they sign in — an account they
          already have keeps its theses.
        </p>
        <form onSubmit={invite} className="mt-3 flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="student@university.ac.in"
            aria-label="Student email"
            className="flex-1 rounded-md border border-line px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={busy !== null || seats.free <= 0}
            className="rounded-md bg-ink px-3 py-1 text-sm text-paper disabled:opacity-50"
          >
            {busy === 'invite' ? 'Inviting…' : 'Invite'}
          </button>
        </form>
        {seats.free <= 0 ? (
          <p className="mt-2 text-xs text-warn">
            All {seats.total} seats are taken. Revoke an invitation below, or ask us for more.
          </p>
        ) : null}

        {pending.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm">
            {pending.map((row) => (
              <li key={row.id} className="flex items-center justify-between">
                <span>
                  {row.email}{' '}
                  <span className="text-xs text-muted">· expires {when(row.expiresAt)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void revoke(row.id)}
                  disabled={busy !== null}
                  className="text-xs underline disabled:opacity-50"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Formatting template</h2>
        <p className="mt-1 text-xs text-muted">
          Every thesis started in this institution begins on this template, so a student never has
          to know which one their department uses.
        </p>
        <select
          value={institution.template?.id ?? ''}
          disabled={busy !== null}
          onChange={(e) => void chooseTemplate(e.target.value)}
          aria-label="Default formatting template"
          className="mt-2 w-full rounded-md border border-line px-2 py-1 text-sm"
        >
          <option value="">No default — students pick their own</option>
          {institution.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isExample ? ' (EXAMPLE — not your university’s rules)' : ''}
            </option>
          ))}
        </select>
      </section>

      <section className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Seats in use</h2>
        {students.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Nobody has taken a seat yet. Invitations appear above until they are accepted.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1">Student</th>
                  <th className="py-1">Joined</th>
                  <th className="py-1">Last active</th>
                  <th className="py-1">Theses</th>
                  <th className="py-1">This month</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-t border-line" data-testid="student-row">
                    <td className="py-1">{s.name ?? s.email}</td>
                    <td className="py-1">{when(s.joinedAt)}</td>
                    <td className="py-1">{when(s.lastActiveAt)}</td>
                    <td className="py-1">{s.documents}</td>
                    <td className="py-1 text-xs text-muted">
                      {s.usage
                        .filter((u) => u.used > 0)
                        .map((u) => `${u.action.toLowerCase()} ${u.used}/${u.cap}`)
                        .join(', ') || 'nothing yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Invoice</h2>
        <p className="mt-1 text-xs text-muted">
          {institution.seatPriceInr > 0
            ? `${seats.used} seat${seats.used === 1 ? '' : 's'} at ₹${institution.seatPriceInr} each, billed ${institution.billingPeriod}.`
            : 'No seat rate has been recorded for this institution, so the invoice will say so rather than guess a number. Tell us what was agreed and we will set it.'}
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label="Billing period"
            placeholder={institution.billingPeriod === 'monthly' ? '2026-09' : '2026'}
            className="w-32 rounded-md border border-line px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => void buildInvoice()}
            disabled={busy !== null}
            className="rounded-md border border-line px-3 py-1 text-sm disabled:opacity-50"
          >
            {busy === 'invoice' ? 'Building…' : 'Build the PDF'}
          </button>
        </div>
        {invoice ? (
          <p className="mt-2 text-sm">
            <a href={invoice.url} className="underline">
              {invoice.filename}
            </a>
          </p>
        ) : null}
      </section>
    </main>
  );
}
