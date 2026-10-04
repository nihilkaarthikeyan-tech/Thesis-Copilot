/**
 * The citation locale — the language of a style's terms and dates (2026-10-04, from the Jenni
 * study, coverage-map row 26; ADR-0065).
 *
 * A CSL style says *where* "and", "edited by", "edn", "Accessed" and a date go; the locale says
 * what they are. APA with en-GB writes "2 January 2024" and 'single quotes' where en-US writes
 * "January 2, 2024" and “double quotes”; Harvard writes "und" with de-DE.
 *
 * Only locales citeproc can actually load are offered:
 *
 *   - `@citation-js/plugin-csl` 0.8.2 bundles five (checked in
 *     `node_modules/@citation-js/plugin-csl/lib/locales.json`): en-US, nl-NL, fr-FR, de-DE, es-ES.
 *     Any other id is silently dropped by its `engines.js` (`locales.has(locale) ? locale :
 *     undefined`), so en-GB rendered exactly as en-US until this package shipped it.
 *   - en-GB is `locales/locales-en-GB.xml`, verbatim from the CSL locales repository
 *     (CC BY-SA 3.0), registered into the same registry the first time anything renders.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';

export type CitationLocale = {
  /** The CSL locale id, stored on `Document.citationLocale`. */
  readonly id: string;
  /** What the student picks from a list. */
  readonly label: string;
};

/** Every locale a student can choose. Each is checked to be loadable by a unit test. */
export const CITATION_LOCALES: readonly CitationLocale[] = [
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'de-DE', label: 'German' },
  { id: 'fr-FR', label: 'French' },
  { id: 'es-ES', label: 'Spanish' },
  { id: 'nl-NL', label: 'Dutch' },
];

/** The locale every style rendered in before the choice existed, unless it declared its own. */
export const FALLBACK_LOCALE = 'en-US';

const byId = new Map(CITATION_LOCALES.map((l) => [l.id, l]));

export function isCitationLocale(id: string): boolean {
  return byId.has(id);
}

export function citationLocaleLabel(id: string): string {
  return byId.get(id)?.label ?? id;
}

/** Locale files this package ships beyond the plugin's own five: id → file in `locales/`. */
const SHIPPED: Readonly<Record<string, string>> = { 'en-GB': 'locales-en-GB.xml' };

const here = fileURLToPath(new URL('.', import.meta.url));

/** `locales/` sits beside `src/` in the source tree and beside `dist/` in a build. */
function findLocalesDir(from: string): string {
  let dir = from;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'locales');
    if (existsSync(join(candidate, 'locales-en-GB.xml'))) return candidate;
    dir = join(dir, '..');
  }
  throw new Error(`Could not locate packages/citations/locales starting from ${from}`);
}

type LocaleRegister = { has: (id: string) => boolean; add: (id: string, xml: string) => void };

let registered = false;

/** Makes the shipped locale files loadable by citeproc. Idempotent; called by every render. */
export function ensureLocalesRegistered(): void {
  if (registered) return;
  const csl = plugins.config.get('@csl') as { locales: LocaleRegister };
  const dir = findLocalesDir(here);
  for (const [id, file] of Object.entries(SHIPPED)) {
    if (!csl.locales.has(id)) csl.locales.add(id, readFileSync(join(dir, file), 'utf8'));
  }
  registered = true;
}

/** Whether citeproc can load this locale right now (the plugin's five plus the shipped ones). */
export function isLocaleLoadable(id: string): boolean {
  ensureLocalesRegistered();
  const csl = plugins.config.get('@csl') as { locales: LocaleRegister };
  return csl.locales.has(id);
}

/**
 * The locale a document's citations render in, or null for "the style's own" — what every
 * document rendered in before the choice existed (the style's declared locale, else en-US).
 *
 * The student's choice wins. Without one it follows the document's language (§2.2), but only
 * where that is unambiguous: a German thesis gets German terms, a thesis whose language is
 * explicitly "en-GB" gets British ones. Plain "en" — the default, and what nearly every thesis
 * has — keeps the style's own locale, so no existing English document changes (ADR-0065).
 */
export function citationLocaleFor(
  choice: string | null | undefined,
  documentLanguage: string | null | undefined,
): string | null {
  if (choice && isCitationLocale(choice)) return choice;
  const tag = (documentLanguage ?? '').trim();
  if (!tag) return null;
  const exact = CITATION_LOCALES.find((l) => l.id.toLowerCase() === tag.toLowerCase());
  if (exact) return exact.id;
  const primary = tag.split(/[-_]/)[0]?.toLowerCase() ?? '';
  if (primary === 'en') return null;
  const matches = CITATION_LOCALES.filter((l) => l.id.split('-')[0]?.toLowerCase() === primary);
  return matches.length === 1 ? (matches[0] as CitationLocale).id : null;
}
