'use client';

/**
 * Long jobs that email when they finish — ADR-0058.
 *
 * A page polling a running search, chapter build, examiner review or coherence check adds
 * `watching=1` to its poll while the tab is visible; the API turns that into the heartbeat the
 * worker reads. A hidden tab still polls (so the page is current when the student returns) but
 * does not count as looking, so the email still goes.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** `?watching=1` or `&watching=1` when the tab is visible, otherwise nothing. */
export function watchingParam(hasQuery = false): string {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return '';
  return `${hasQuery ? '&' : '?'}watching=1`;
}

let cached: Promise<boolean> | null = null;

/** The "Email me when a long job finishes" setting (default on); null while it loads. */
export function useJobEmailSetting(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    cached ??= api<{ emailWhenJobDone?: boolean }>('/settings')
      .then((s) => s.emailWhenJobDone !== false)
      .catch(() => {
        cached = null;
        return false;
      });
    let live = true;
    void cached.then((value) => {
      if (live) setOn(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return on;
}

/** The line a running job shows when the email will come. */
export const JOB_EMAIL_NOTE = 'You can close this — we’ll email you when it is ready.';
