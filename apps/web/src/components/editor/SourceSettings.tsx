'use client';

/**
 * Jenni build plan R6: the source settings, from inside the editor. The same fields as at the
 * start of the thesis (ADR-0087), shown as one line until the student opens them, saved with
 * `PUT /documents/:id/source-prefs`. Free: nothing here calls a model.
 *
 * They govern the papers found *for* the student from now on, and whether the student's own
 * papers are cited; nothing already in the library is removed. Which papers one chapter or
 * section cites is the pins below (ADR-0085), Jenni's "select sources".
 */

import { readSourcePrefs, type SourcePrefs } from '@tc/types';
import { useState } from 'react';
import { prefsLine, SourcePrefsFields } from '@/components/sources/SourcePrefsFields';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';

export function SourceSettings(props: { documentId: string; meta: unknown }) {
  const [saved, setSaved] = useState<SourcePrefs>(() => readSourcePrefs(props.meta));
  const [draft, setDraft] = useState<SourcePrefs>(saved);
  const [open, setOpen] = useState(false);
  const [valid, setValid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ sourcePrefs: SourcePrefs }>(
        `/documents/${props.documentId}/source-prefs`,
        { method: 'PUT', body: JSON.stringify(draft) },
      );
      setSaved(result.sourcePrefs);
      setDraft(result.sourcePrefs);
      setOpen(false);
      setNote('Saved. Papers found for you from now on follow these; your library stays as it is.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the settings. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-3 rounded-md border border-line px-3 py-2" data-testid="source-settings">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[12.5px] text-muted">
            <span className="block font-semibold text-ink">Source settings</span>
            <span data-testid="source-settings-line">{prefsLine(saved)}</span>
          </span>
          <button
            type="button"
            className="shrink-0 text-[12.5px] text-accent underline"
            onClick={() => {
              setDraft(saved);
              setNote(null);
              setOpen(true);
            }}
            data-testid="source-settings-open"
          >
            Change
          </button>
        </div>
        {note ? (
          <p className="mt-1 text-[12px] text-muted" role="status">
            {note}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-line p-3" data-testid="source-settings">
      <p className="text-[13.5px] font-semibold text-ink">Source settings</p>
      <SourcePrefsFields
        value={draft}
        onChange={setDraft}
        onValidChange={setValid}
        testIdPrefix="prefs"
      />
      <p className="mt-2 text-[12px] text-muted">
        To choose which papers this chapter or section cites, pin them below.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!valid || busy}
          data-testid="source-settings-save"
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
