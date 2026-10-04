/**
 * The citation locale choice in the Citations tab (ADR-0065).
 *
 * The "automatic" option names what automatic currently means, so the student is never left
 * guessing which English they are getting.
 */

export type LocaleState = {
  /** The locale the labels and bibliography were actually rendered in. */
  locale?: string;
  /** What the thesis asks citeproc for; null means the style's own locale. */
  localeOverride?: string | null;
  locales?: ReadonlyArray<{ id: string; label: string }>;
};

export function automaticLocaleLabel(data: LocaleState): string {
  const name = data.locales?.find((l) => l.id === data.locale)?.label ?? data.locale;
  if (!name) return 'Automatic';
  return data.localeOverride
    ? `Automatic: ${name}, from the thesis language`
    : `Automatic: ${name}, the style’s own`;
}
