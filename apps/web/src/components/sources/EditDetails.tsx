'use client';

/**
 * "Edit details" (Jenni build plan R15, ADR-0102): a paper's details, corrected in place — the
 * fields its kind has (a journal article's journal, volume, issue and pages; a book's publisher;
 * a thesis's university…). Saved with `PUT /sources/:id/details`; every citation of the paper, in
 * every chapter and the bibliography, follows on its next render. Free.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import {
  authorLines,
  DETAIL_KINDS,
  parseAuthorLines,
  type SourceDetails,
} from '@/lib/source-details';

export function EditDetails(props: {
  sourceId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [details, setDetails] = useState<SourceDetails | null>(null);
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SourceDetails>(`/sources/${props.sourceId}/details`)
      .then((d) => {
        setDetails(d);
        setAuthors(authorLines(d.authors));
        setYear(d.year ? String(d.year) : '');
      })
      .catch(() => setError('The details could not be read.'));
  }, [props.sourceId]);

  if (!details) {
    return <p className="mt-2 text-sm text-muted">{error ?? 'Reading the details…'}</p>;
  }
  const kind = DETAIL_KINDS.find((k) => k.type === details.type) ?? DETAIL_KINDS[0];
  const set = (patch: Partial<SourceDetails>) => setDetails((d) => (d ? { ...d, ...patch } : d));
  const yearValid = year === '' || /^\d{4}$/.test(year);

  async function save() {
    if (!details) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/sources/${props.sourceId}/details`, {
        method: 'PUT',
        body: JSON.stringify({
          ...details,
          authors: parseAuthorLines(authors),
          year: year ? Number(year) : null,
        }),
      });
      props.onSaved();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'The details were not saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  const label = 'block text-[12px] font-semibold text-muted';
  const idBase = `details-${props.sourceId}`;
  return (
    <form
      className="mt-3 grid gap-2 rounded-md border border-line bg-paper p-3 text-sm"
      data-testid="edit-details"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className={label}>
        Kind
        <select
          value={details.type}
          onChange={(e) => set({ type: e.target.value })}
          className="mt-1 block w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
          data-testid="details-type"
        >
          {DETAIL_KINDS.map((k) => (
            <option key={k.type} value={k.type}>
              {k.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label} htmlFor={`${idBase}-title`}>
        Title
      </label>
      <Input
        id={`${idBase}-title`}
        value={details.title}
        onChange={(e) => set({ title: e.target.value })}
        data-testid="details-title"
      />
      <label className={label}>
        Authors — one per line, "Family, Given"; an organisation as its name
        <textarea
          value={authors}
          onChange={(e) => setAuthors(e.target.value)}
          rows={Math.min(6, Math.max(2, authors.split('\n').length + 1))}
          className="mt-1 block w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
          data-testid="details-authors"
        />
      </label>
      <label className={label} htmlFor={`${idBase}-year`}>
        Year
      </label>
      <Input
        id={`${idBase}-year`}
        value={year}
        inputMode="numeric"
        onChange={(e) => setYear(e.target.value.trim())}
        className="w-28"
        data-testid="details-year"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {kind?.fields.map((field) => (
          <div key={field.key}>
            <label className={label} htmlFor={`${idBase}-${field.key}`}>
              {field.label}
            </label>
            <Input
              id={`${idBase}-${field.key}`}
              value={details[field.key]}
              onChange={(e) => set({ [field.key]: e.target.value } as Partial<SourceDetails>)}
              className="mt-1"
              data-testid={`details-${field.key}`}
            />
          </div>
        ))}
      </div>
      {!yearValid ? (
        <p role="alert" className="text-xs text-warn">
          The year is four digits.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-warn">
          {error}
        </p>
      ) : null}
      <p className="text-[12px] text-muted">
        Every citation of this paper, in every chapter and the bibliography, follows these details.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={saving || !yearValid || !details.title.trim()}
          data-testid="details-save"
        >
          {saving ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </form>
  );
}
