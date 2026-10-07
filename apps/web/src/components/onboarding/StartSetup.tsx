'use client';

/**
 * ADR-0087 (2026-10-07): Jenni's start, after the title. Two steps, each folding into a line the
 * student can reopen: citation preferences (style, web and library search, years, indexing,
 * preprints — indexing where Jenni has impact factor and cited-by, at the owner's word), then how
 * the thesis is structured (Standard chapters, Smart headings from the title, or none).
 *
 * The preferences narrow the papers found *for* the student; anything they add themselves stays.
 */

import {
  DEFAULT_SOURCE_PREFS,
  INDEX_LIST_LABELS,
  INDEX_LISTS,
  type IndexList,
  type SourcePrefs,
} from '@tc/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Hint, Input } from '@/components/ui/primitives';

export type Structure = 'standard' | 'smart' | 'none';

const STRUCTURES: Array<{ value: Structure; name: string; line: string }> = [
  {
    value: 'smart',
    name: 'Smart headings',
    line: 'AI plans your chapters and their sections from your title. You can rename or remove any of them.',
  },
  {
    value: 'standard',
    name: 'Standard thesis chapters',
    line: 'Introduction, Literature Review, Methodology, Results, Discussion and Conclusion.',
  },
  { value: 'none', name: 'No headings', line: 'One chapter, and you start with just the title.' },
];

type Years = 'all' | 'last5' | 'custom';

function Toggle(props: {
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

/** One line for a folded step: what was chosen. */
function prefsLine(prefs: SourcePrefs, styleName: string): string {
  const parts = [
    styleName,
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

export function StartSetup(props: {
  /** The citation-style picker the first step already uses, rendered in the preferences step. */
  stylePicker: React.ReactNode;
  styleName: string;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onStart: (prefs: SourcePrefs, structure: Structure) => void;
  now?: Date;
}) {
  const year = (props.now ?? new Date()).getFullYear();
  const [step, setStep] = useState<'prefs' | 'structure'>('prefs');
  const [prefs, setPrefs] = useState<SourcePrefs>(DEFAULT_SOURCE_PREFS);
  const [years, setYears] = useState<Years>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [structure, setStructure] = useState<Structure>('smart');

  const set = (patch: Partial<SourcePrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const chooseYears = (next: Years) => {
    setYears(next);
    if (next === 'all') set({ yearFrom: null, yearTo: null });
    if (next === 'last5') set({ yearFrom: year - 4, yearTo: null });
  };
  const toggleList = (list: IndexList) =>
    set({
      indexedIn: prefs.indexedIn.includes(list)
        ? prefs.indexedIn.filter((l) => l !== list)
        : [...prefs.indexedIn, list],
    });

  const customValid =
    years !== 'custom' ||
    ((from === '' || /^\d{4}$/.test(from)) &&
      (to === '' || /^\d{4}$/.test(to)) &&
      (from === '' || to === '' || Number(from) <= Number(to)));

  function confirmPrefs() {
    if (years === 'custom') {
      set({ yearFrom: from ? Number(from) : null, yearTo: to ? Number(to) : null });
    }
    setStep('structure');
  }

  return (
    <div className="flex flex-col gap-4" data-testid="start-setup">
      {step === 'prefs' ? (
        <section className="rounded-md border border-line p-4" data-testid="setup-prefs">
          <p className="text-[14px] font-semibold text-ink">
            Let’s set up your sources and citations.
          </p>
          <div className="mt-3">{props.stylePicker}</div>
          <div className="mt-2 divide-y divide-line">
            <Toggle
              label="Web search"
              hint="Find papers on your topic in the scholarly indexes for you, and keep finding them as you write."
              checked={prefs.webSearch}
              onChange={(v) => set({ webSearch: v, librarySearch: v ? prefs.librarySearch : true })}
              testId="setup-web-search"
            />
            <Toggle
              label="Library search"
              hint="Cite the papers you add yourself — PDFs, .bib files, Zotero."
              checked={prefs.librarySearch}
              onChange={(v) => set({ librarySearch: v, webSearch: v ? prefs.webSearch : true })}
              testId="setup-library-search"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 py-1">
            <span className="text-[13.5px] font-semibold text-ink">Publish year</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Chip
                on={years === 'all'}
                onClick={() => chooseYears('all')}
                testId="setup-years-all"
              >
                All
              </Chip>
              <Chip
                on={years === 'last5'}
                onClick={() => chooseYears('last5')}
                testId="setup-years-last5"
              >
                Last 5 years
              </Chip>
              <Chip
                on={years === 'custom'}
                onClick={() => chooseYears('custom')}
                testId="setup-years-custom"
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
                onChange={(e) => setFrom(e.target.value.trim())}
              />
              <span className="text-muted">to</span>
              <Input
                aria-label="To year"
                inputMode="numeric"
                placeholder={String(year)}
                className="w-24"
                value={to}
                onChange={(e) => setTo(e.target.value.trim())}
              />
            </div>
          ) : null}
          <div className="mt-3 py-1">
            <span className="text-[13.5px] font-semibold text-ink">Indexing</span>
            <Hint className="mt-0.5">
              Papers found for you come only from journals on the lists you tick. None ticked: any
              journal.
            </Hint>
            <span className="mt-2 flex flex-wrap gap-1.5" data-testid="setup-indexing">
              <Chip on={prefs.indexedIn.length === 0} onClick={() => set({ indexedIn: [] })}>
                Any
              </Chip>
              {INDEX_LISTS.map((list) => (
                <Chip
                  key={list}
                  on={prefs.indexedIn.includes(list)}
                  onClick={() => toggleList(list)}
                  testId={`setup-index-${list}`}
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
            testId="setup-preprints"
          />
          {!customValid ? (
            <p role="alert" className="mt-2 text-xs text-warn">
              Years are four digits, and the first must not be after the last.
            </p>
          ) : null}
          <div className="mt-4 flex items-center justify-between">
            <Button type="button" variant="secondary" onClick={props.onBack}>
              Back
            </Button>
            <Button
              type="button"
              onClick={confirmPrefs}
              disabled={!customValid}
              data-testid="setup-next"
            >
              Next
            </Button>
          </div>
        </section>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setStep('prefs')}
            className="self-end rounded-md bg-sunk px-3 py-2 text-left text-[13px] text-ink"
            data-testid="setup-prefs-summary"
          >
            {prefsLine(prefs, props.styleName)}
            <span className="ml-2 text-muted underline">Edit</span>
          </button>
          <section className="rounded-md border border-line p-4" data-testid="setup-structure">
            <p className="text-[14px] font-semibold text-ink">
              How would you like to structure your thesis?
            </p>
            <fieldset className="mt-3 flex flex-col gap-2 border-0 p-0">
              <legend className="sr-only">Structure</legend>
              {STRUCTURES.map((option) => {
                const checked = structure === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors ${
                      checked
                        ? 'border-accent bg-accent-soft'
                        : 'border-line hover:border-line-strong'
                    }`}
                  >
                    <input
                      type="radio"
                      name="structure"
                      value={option.value}
                      checked={checked}
                      onChange={() => setStructure(option.value)}
                      className="mt-0.5 accent-accent"
                      data-testid={`setup-structure-${option.value}`}
                    />
                    <span>
                      <span className="block text-[13.5px] font-semibold text-ink">
                        {option.name}
                      </span>
                      <Hint className="mt-0.5">{option.line}</Hint>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {props.error ? (
              <p role="alert" className="mt-2 text-xs text-warn">
                {props.error}
              </p>
            ) : null}
            <div className="mt-4 flex items-center justify-between">
              <Button type="button" variant="secondary" onClick={() => setStep('prefs')}>
                Back
              </Button>
              <Button
                type="button"
                disabled={props.busy}
                onClick={() => props.onStart(prefs, structure)}
                data-testid="setup-start"
              >
                {props.busy ? 'Starting…' : 'Start writing'}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
