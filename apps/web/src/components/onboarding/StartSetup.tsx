'use client';

/**
 * ADR-0087 (2026-10-07): Jenni's start, after the title. Two steps, each folding into a line the
 * student can reopen: citation preferences (style, web and library search, years, indexing,
 * preprints — indexing where Jenni has impact factor and cited-by, at the owner's word), then how
 * the thesis is structured (Standard chapters, Smart headings from the title, or none).
 *
 * The preferences narrow the papers found *for* the student; anything they add themselves stays.
 */

import { DEFAULT_SOURCE_PREFS, type SourcePrefs } from '@tc/types';
import { useState } from 'react';
import { prefsLine, SourcePrefsFields } from '@/components/sources/SourcePrefsFields';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/primitives';

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
  const [step, setStep] = useState<'prefs' | 'structure'>('prefs');
  const [prefs, setPrefs] = useState<SourcePrefs>(DEFAULT_SOURCE_PREFS);
  const [valid, setValid] = useState(true);
  const [structure, setStructure] = useState<Structure>('smart');

  return (
    <div className="flex flex-col gap-4" data-testid="start-setup">
      {step === 'prefs' ? (
        <section className="rounded-md border border-line p-4" data-testid="setup-prefs">
          <p className="text-[14px] font-semibold text-ink">
            Let’s set up your sources and citations.
          </p>
          <div className="mt-3">{props.stylePicker}</div>
          <SourcePrefsFields
            value={prefs}
            onChange={setPrefs}
            onValidChange={setValid}
            testIdPrefix="setup"
            now={props.now}
          />
          <div className="mt-4 flex items-center justify-between">
            <Button type="button" variant="secondary" onClick={props.onBack}>
              Back
            </Button>
            <Button
              type="button"
              onClick={() => setStep('structure')}
              disabled={!valid}
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
