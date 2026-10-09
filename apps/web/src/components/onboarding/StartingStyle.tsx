'use client';

/**
 * The citation style, asked once at the start (docs/research/coverage-map.md row 4: Jenni asks on
 * its first screen; we used to ask nothing until the Citations tab). The five styles Indian
 * departments ask for most often, and "Other…" for the rest of the catalogue, which is searched in
 * the editor's Citations tab. Optional: skipping it leaves the thesis on the default (APA 7), as
 * before.
 *
 * Saved through the same `PUT /documents/:id/citation-style` the editor's style switch uses, so a
 * choice here is exactly a choice made there.
 *
 * Below the choices, a preview of the style the pointer is on, or the one chosen: one citation and
 * one bibliography entry for an example reference (2026-10-04, `StylePreview`).
 */

import { useEffect, useState } from 'react';
import { StylePreview } from '@/components/StylePreview';
import { Hint } from '@/components/ui/primitives';
import { useT } from '@/i18n/react';
import { api } from '@/lib/api';

export const STARTING_STYLES = [
  { id: 'apa', label: 'APA 7' },
  { id: 'harvard', label: 'Harvard' },
  { id: 'ieee', label: 'IEEE' },
  { id: 'vancouver', label: 'Vancouver' },
  { id: 'chicago-author-date', label: 'Chicago author-date' },
] as const;

/** A style id, "other" (choose later in the editor) or "" (not answered). */
export type StartingStyleChoice = (typeof STARTING_STYLES)[number]['id'] | 'other' | '';

/**
 * Saves the choice on a thesis that has just been created. A failure is not the student's
 * problem at this moment: the thesis exists, keeps the default style, and the style can be set
 * in the Citations tab, so creation carries on regardless.
 */
export async function saveStartingStyle(
  documentId: string,
  choice: StartingStyleChoice,
): Promise<void> {
  if (choice === '' || choice === 'other') return;
  try {
    await api(`/documents/${documentId}/citation-style`, {
      method: 'PUT',
      body: JSON.stringify({ style: choice }),
    });
  } catch {
    // Deliberately ignored; see above.
  }
}

/**
 * Pre-selects the student's default style from Settings (2026-10-04, "document defaults"), once,
 * and only while nothing has been chosen on this form.
 */
export function useDefaultStartingStyle(
  value: StartingStyleChoice,
  onChange: (next: StartingStyleChoice) => void,
): void {
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (applied) return;
    let live = true;
    api<{ defaultCitationStyle?: string | null }>('/settings')
      .then((s) => {
        if (!live) return;
        setApplied(true);
        const id = s.defaultCitationStyle;
        if (value === '' && id && STARTING_STYLES.some((style) => style.id === id)) {
          onChange(id as StartingStyleChoice);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [applied, value, onChange]);
}

export function StartingStyle({
  value,
  onChange,
  compact = false,
}: {
  value: StartingStyleChoice;
  onChange: (next: StartingStyleChoice) => void;
  /** ADR-0145: the setup card's row — the chips only, no preview or hint under them. */
  compact?: boolean;
}) {
  const { t } = useT();
  const options: Array<{ id: Exclude<StartingStyleChoice, ''>; label: string }> = [
    ...STARTING_STYLES,
    { id: 'other', label: t('style.other') },
  ];
  const [hovered, setHovered] = useState<string | null>(null);
  const previewed = hovered ?? (value === '' || value === 'other' ? null : value);
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0" data-testid="starting-style">
      <legend className="mb-1 text-[13px] font-semibold text-ink">
        {t('style.legend')} <span className="font-normal text-muted">{t('style.optional')}</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = value === option.id;
          return (
            <label
              key={option.id}
              onMouseEnter={() => setHovered(option.id === 'other' ? null : option.id)}
              onMouseLeave={() => setHovered(null)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-[13px] transition-colors focus-within:ring-2 focus-within:ring-accent ${
                checked
                  ? 'border-accent bg-accent-soft font-semibold text-ink'
                  : 'border-line text-ink hover:border-line-strong'
              }`}
            >
              <input
                type="radio"
                name="citationStyle"
                value={option.id}
                checked={checked}
                onChange={() => onChange(option.id)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {compact ? null : <StylePreview styleId={previewed} />}
      {compact && value !== 'other' ? null : (
        <Hint>{value === 'other' ? t('style.hintOther') : t('style.hintDefault')}</Hint>
      )}
    </fieldset>
  );
}
