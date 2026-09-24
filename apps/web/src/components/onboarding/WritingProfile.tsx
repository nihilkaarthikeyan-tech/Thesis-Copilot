'use client';

/**
 * "What the AI has learned about your writing" — PRD FR-4.7 and §9.3's "Re-learn my style",
 * which had an endpoint and no screen; ADR-0025 for the student's own guidance.
 *
 * The style profile was always in every prompt and never on any screen: the student could not see
 * what the model had concluded about them, correct it, or add to it. This shows the profile as the
 * model receives it, lets the student re-learn it once a day, and takes a short note in their own
 * words that every suggestion then follows — "British spelling", "farmers, not respondents".
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Profile = {
  avgSentenceLen: number;
  register: string;
  voice: string;
  transitions: string[];
  voiceNote: string;
};

type Status = {
  humanWords: number;
  thresholdWords: number;
  eligible: boolean;
  profile: Profile | null;
  learnedAt: string | null;
  guidance: string;
  relearnAvailableAt: string | null;
};

const MAX = 300;

export function WritingProfile({ documentId }: { documentId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [guidance, setGuidance] = useState('');
  const [busy, setBusy] = useState<'learn' | 'save' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await api<Status>(`/documents/${documentId}/style-profile`);
    setStatus(next);
    setGuidance(next.guidance);
  }, [documentId]);

  useEffect(() => {
    load().catch(() => setError('Your writing profile could not be loaded.'));
  }, [load]);

  async function learn() {
    setBusy('learn');
    setError(null);
    setMessage(null);
    try {
      const next = await api<Status>(`/documents/${documentId}/style-profile`, { method: 'POST' });
      setStatus(next);
      setMessage('Learned again from your own writing.');
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'It did not finish.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setError(null);
    setMessage(null);
    try {
      const next = await api<Status>(`/documents/${documentId}/style-profile/guidance`, {
        method: 'PUT',
        body: JSON.stringify({ guidance }),
      });
      setStatus(next);
      setGuidance(next.guidance);
      setMessage(next.guidance ? 'Saved. Suggestions follow it from now on.' : 'Cleared.');
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Not saved.');
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return error ? <p className="mt-2 text-xs text-warn">{error}</p> : null;
  }

  const profile = status.profile;
  const relearnAt = status.relearnAvailableAt ? new Date(status.relearnAvailableAt) : null;
  const canRelearn = !relearnAt || relearnAt.getTime() <= Date.now();

  return (
    <section data-testid="writing-profile" className="mt-2 grid gap-3">
      {profile ? (
        <div className="rounded-md border border-line bg-paper p-3">
          <p data-testid="writing-profile-note">{profile.voiceNote}</p>
          <p className="mt-2 text-xs text-muted">
            Sentences of about {Math.round(profile.avgSentenceLen)} words · {profile.register} ·{' '}
            {profile.voice === 'first-person'
              ? 'first person'
              : profile.voice === 'passive'
                ? 'mostly passive'
                : 'mixed voice'}
            {profile.transitions.length > 0 ? ` · ${profile.transitions.join(', ')}` : ''}
          </p>
          <p className="mt-1 text-[11px] text-faint">
            Learned from your own writing
            {status.learnedAt ? ` on ${new Date(status.learnedAt).toLocaleDateString()}` : ''} —
            AI-written text is never counted.
          </p>
        </div>
      ) : (
        <p className="text-muted">
          It learns your style once you have written {status.thresholdWords.toLocaleString()} words
          of your own — you have {status.humanWords.toLocaleString()}. Text the AI wrote does not
          count.
        </p>
      )}

      {profile || status.eligible ? (
        <div>
          <button
            type="button"
            data-testid="writing-profile-learn"
            disabled={busy !== null || !canRelearn}
            onClick={() => void learn()}
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50"
          >
            {busy === 'learn'
              ? 'Learning…'
              : profile
                ? 'Re-learn from my writing'
                : 'Learn my style now'}
          </button>
          {!canRelearn && relearnAt ? (
            <span className="ml-2 text-[11px] text-muted">
              Once a day — again after {relearnAt.toLocaleString()}.
            </span>
          ) : null}
        </div>
      ) : null}

      <div>
        <label htmlFor="writing-guidance" className="font-medium">
          Your guidance
        </label>
        <p className="text-xs text-muted">
          Anything suggestions should always follow, in your own words.
          {profile ? '' : ' It is used once your style has been learned.'}
        </p>
        <textarea
          id="writing-guidance"
          data-testid="writing-guidance"
          rows={2}
          maxLength={MAX}
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder="e.g. British spelling. Call them farmers, not respondents. No first person."
          className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] text-faint">
            {guidance.length}/{MAX}
          </span>
          <button
            type="button"
            data-testid="writing-guidance-save"
            disabled={busy !== null || guidance.trim() === status.guidance}
            onClick={() => void save()}
            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-50"
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {message ? (
        <p role="status" className="text-xs text-ok">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-warn">
          {error}
        </p>
      ) : null}
    </section>
  );
}
