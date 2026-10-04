/**
 * Interface languages (ADR-0061): a typed message catalogue per language, English as the source
 * and the fallback. No React and no Next here, so the unit tests and the server layouts can use
 * it as it is.
 *
 * This is the language of the screens — menus, buttons, labels. It is not the thesis's language
 * (PRD §2.2, a property of the document that decides what the AI writes in), and the two never
 * read each other.
 */

import { en, type MessageKey } from './en';
import { hi } from './hi';

export type { MessageKey } from './en';

export type Language = 'en' | 'hi';

/** In the picker. Each name is written in its own language, so nobody needs to read another. */
export const LANGUAGES: ReadonlyArray<{ id: Language; name: string; beta: boolean }> = [
  { id: 'en', name: 'English', beta: false },
  { id: 'hi', name: 'हिन्दी (बीटा)', beta: true },
];

export const DEFAULT_LANGUAGE: Language = 'en';

/** Read by the server layouts for first paint; the localStorage copy has the same name. */
export const LANGUAGE_COOKIE = 'tc-lang';

const CATALOGUES: Record<Language, Partial<Record<MessageKey, string>>> = { en, hi };

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'hi';
}

export function parseLanguage(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export type Vars = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** The raw template: the language's own string, or English when it has none. */
export function template(language: Language, key: MessageKey): string {
  return CATALOGUES[language][key] ?? en[key];
}

/** `{name}` → `vars.name`. An unknown placeholder is left as written, so a gap is visible. */
export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export function translate(language: Language, key: MessageKey, vars?: Vars): string {
  return fill(template(language, key), vars);
}

/**
 * A template cut at its placeholders, for a slot that is an element rather than text (a `<kbd>`,
 * a link): `'{tab} keeps it'` → `[{ slot: 'tab' }, { text: ' keeps it' }]`. Word order differs
 * between languages, so the element goes wherever the translation puts its placeholder.
 */
export function splitTemplate(text: string): Array<{ text: string } | { slot: string }> {
  const parts: Array<{ text: string } | { slot: string }> = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ slot: match[1] ?? '' });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The placeholder names a template uses, for the catalogue tests. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '').sort();
}

/**
 * The language of the page in front of the student, for code that runs outside a render — an
 * event handler or a stream callback setting a notice — where a hook's value would be the one
 * from whenever the callback was made. `LanguageProvider` keeps it current.
 */
let current: Language = DEFAULT_LANGUAGE;

export function setCurrentLanguage(language: Language): void {
  current = language;
}

export function tNow(key: MessageKey, vars?: Vars): string {
  return translate(current, key, vars);
}
