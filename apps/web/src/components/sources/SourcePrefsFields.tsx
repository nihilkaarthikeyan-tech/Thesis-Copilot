'use client';

/**
 * The source settings (ADR-0087): web and library search, publish years, indexing, preprints.
 * One set of fields for the start of a thesis (`StartSetup`) and for the editor's Sources tab
 * (Jenni build plan R6), so the two can never offer different choices.
 *
 * Controlled: the parent holds the `SourcePrefs`. Custom years are typed as text and reach the
 * value only when they are valid; `onValidChange` says whether what is on the screen can be saved.
 */

import { INDEX_LIST_LABELS, INDEX_LISTS, type IndexList, type SourcePrefs } from '@tc/types';
import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { Hint, Input } from '@/components/ui/primitives';

type Years = 'all' | 'last5' | 'custom';

export function Toggle(props: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-[13.5px] font-semibold text-ink">{props.label}</span>
        <Hint className="mt-0.5">{props.hint}</Hint>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        data-testid={props.testId}
        onClick={() => props.onChange(!props.checked)}
        className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${
          props.checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            props.checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function Chip(props: { on: boolean; onClick: () => void; children: string; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      data-testid={props.testId}
      onClick={props.onClick}
      className={`rounded-md border px-2.5 py-1 text-[13px] transition-colors ${
        props.on
          ? 'border-accent bg-accent-soft font-semibold text-ink'
          : 'border-line text-muted hover:border-line-strong'
      }`}
    >
      {props.children}
    </button>
  );
}

/** One line for the settings as chosen: what a folded step or a closed panel shows. */
export function prefsLine(prefs: SourcePrefs, styleName?: string): string {
  const parts = [
    ...(styleName ? [styleName] : []),
    `Web search: ${prefs.webSearch ? 'On' : 'Off'}`,
    `Library search: ${prefs.librarySearch ? 'On' : 'Off'}`,
  ];
  if (prefs.yearFrom || prefs.yearTo)
    parts.push(`${prefs.yearFrom ?? '…'}–${prefs.yearTo ?? 'now'}`);
  if (prefs.indexedIn.length)
    parts.push(prefs.indexedIn.map((l) => INDEX_LIST_LABELS[l]).join(', '));
  if (!prefs.preprints) parts.push('No preprints');
  return parts.join(' · ');
}

function yearsOf(prefs: SourcePrefs, year: number): Years {
  if (prefs.yearFrom === null && prefs.yearTo === null) return 'all';
  if (prefs.yearFrom === year - 4 && prefs.yearTo === null) return 'last5';
  return 'custom';
}

const FOUR_DIGITS = /^\d{4}$/;

export function SourcePrefsFields(props: {
  value: SourcePrefs;
  /** A state setter: every change is applied to the latest value, so quick changes all land. */
  onChange: Dispatch<SetStateAction<SourcePrefs>>;
  onValidChange?: (valid: boolean) => void;
  /** `setup` at the start of a thesis, `prefs` in the editor. */
  testIdPrefix: string;
  now?: Date;
}) {
  const { value: prefs, onChange, testIdPrefix: id } = props;
  const year = (props.now ?? new Date()).getFullYear();
  const [years, setYears] = useState<Years>(() => yearsOf(prefs, year));
  const [from, setFrom] = useState(prefs.yearFrom ? String(prefs.yearFrom) : '');
  const [to, setTo] = useState(prefs.yearTo ? String(prefs.yearTo) : '');

  const set = (patch: Partial<SourcePrefs> | ((p: SourcePrefs) => Partial<SourcePrefs>)) =>
    onChange((p) => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) }));

  const customValid =
    years !== 'custom' ||
    ((from === '' || FOUR_DIGITS.test(from)) &&
      (to === '' || FOUR_DIGITS.test(to)) &&
      (from === '' || to === '' || Number(from) <= Number(to)));

  const { onValidChange } = props;
  useEffect(() => {
    onValidChange?.(customValid);
  }, [customValid, onValidChange]);

  const chooseYears = (next: Years) => {
    setYears(next);
    if (next === 'all') set({ yearFrom: null, yearTo: null });
    if (next === 'last5') set({ yearFrom: year - 4, yearTo: null });
    if (next === 'custom') setCustom(from, to);
  };
  const setCustom = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    const ok =
      (nextFrom === '' || FOUR_DIGITS.test(nextFrom)) &&
      (nextTo === '' || FOUR_DIGITS.test(nextTo)) &&
      (nextFrom === '' || nextTo === '' || Number(nextFrom) <= Number(nextTo));
    if (ok) {
      set({
        yearFrom: nextFrom ? Number(nextFrom) : null,
        yearTo: nextTo ? Number(nextTo) : null,
      });
    }
  };
  const toggleList = (list: IndexList) =>
    set((p) => ({
      indexedIn: p.indexedIn.includes(list)
        ? p.indexedIn.filter((l) => l !== list)
        : [...p.indexedIn, list],
    }));

  return (
    <>
      <div className="mt-2 divide-y divide-line">
        <Toggle
          label="Web search"
          hint="Find papers on your topic in the scholarly indexes for you, and keep finding them as you write."
          checked={prefs.webSearch}
          onChange={(v) =>
            set((p) => ({ webSearch: v, librarySearch: v ? p.librarySearch : true }))
          }
          testId={`${id}-web-search`}
        />
        <Toggle
          label="Library search"
          hint="Cite the papers you add yourself — PDFs, .bib files, Zotero."
          checked={prefs.librarySearch}
          onChange={(v) => set((p) => ({ librarySearch: v, webSearch: v ? p.webSearch : true }))}
          testId={`${id}-library-search`}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 py-1">
        <span className="text-[13.5px] font-semibold text-ink">Publish year</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Chip on={years === 'all'} onClick={() => chooseYears('all')} testId={`${id}-years-all`}>
            All
          </Chip>
          <Chip
            on={years === 'last5'}
            onClick={() => chooseYears('last5')}
            testId={`${id}-years-last5`}
          >
            Last 5 years
          </Chip>
          <Chip
            on={years === 'custom'}
            onClick={() => chooseYears('custom')}
            testId={`${id}-years-custom`}
          >
            Custom
          </Chip>
        </span>
      </div>
      {years === 'custom' ? (
        <div className="mt-1 flex items-center justify-end gap-2">
          <Input
            aria-label="From year"
            inputMode="numeric"
            placeholder="From"
            className="w-24"
            value={from}
            onChange={(e) => setCustom(e.target.value.trim(), to)}
          />
          <span className="text-muted">to</span>
          <Input
            aria-label="To year"
            inputMode="numeric"
            placeholder={String(year)}
            className="w-24"
            value={to}
            onChange={(e) => setCustom(from, e.target.value.trim())}
          />
        </div>
      ) : null}
      <div className="mt-3 py-1">
        <span className="text-[13.5px] font-semibold text-ink">Indexing</span>
        <Hint className="mt-0.5">
          Papers found for you come only from journals on the lists you tick. None ticked: any
          journal.
        </Hint>
        <span className="mt-2 flex flex-wrap gap-1.5" data-testid={`${id}-indexing`}>
          <Chip on={prefs.indexedIn.length === 0} onClick={() => set({ indexedIn: [] })}>
            Any
          </Chip>
          {INDEX_LISTS.map((list) => (
            <Chip
              key={list}
              on={prefs.indexedIn.includes(list)}
              onClick={() => toggleList(list)}
              testId={`${id}-index-${list}`}
            >
              {INDEX_LIST_LABELS[list]}
            </Chip>
          ))}
        </span>
        <Hint className="mt-1">Scopus, Web of Science and UGC-CARE are coming.</Hint>
      </div>
      <Toggle
        label="Include preprints"
        hint="Papers not yet peer reviewed (arXiv and similar)."
        checked={prefs.preprints}
        onChange={(v) => set({ preprints: v })}
        testId={`${id}-preprints`}
      />
      {!customValid ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          Years are four digits, and the first must not be after the last.
        </p>
      ) : null}
    </>
  );
}
