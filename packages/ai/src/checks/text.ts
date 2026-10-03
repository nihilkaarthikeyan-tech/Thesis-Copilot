/**
 * Text helpers the checks share: paragraphs and sentences of a section's Markdown, normalised
 * forms for matching, and the number and citation patterns several checks read.
 */

import { splitSentences } from '../builder/quality.js';

export const CITE_RE = /\{\{cite:[^}]+\}\}/g;
export const HAS_CITE = /\{\{cite:[^}]+\}\}/;

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁺': '+',
  '⁻': '-',
};

/**
 * Subscript digits to plain digits, so `K₂Br` and `K2Br` are one token; superscript digits and
 * signs likewise (`Fe³⁺` → `Fe3+`, `m²` → `m2`), so a charge or a power is readable by the same
 * patterns (ADR-0045).
 */
export function plainDigits(text: string): string {
  return text
    .replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080))
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g, (d) => SUPERSCRIPT_DIGITS[d] ?? d);
}

export function normalise(text: string): string {
  return plainDigits(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type Paragraph = { text: string; heading: boolean; needsSource: boolean };

export function paragraphsOf(markdown: string): Paragraph[] {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((text) => ({
      text,
      heading: /^###\s/.test(text),
      needsSource: /^\[\[NEEDS SOURCE:/i.test(text) || /^\[\[DATA NEEDED:/i.test(text),
    }));
}

/** Prose paragraphs only: no headings, no needs-source notes. */
export function proseParagraphs(markdown: string): string[] {
  return paragraphsOf(markdown)
    .filter((p) => !p.heading && !p.needsSource)
    .map((p) => p.text);
}

export function sentencesOf(markdown: string): string[] {
  return proseParagraphs(markdown).flatMap((p) => splitSentences(p));
}

export function wordCount(text: string): number {
  return text
    .replace(CITE_RE, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function stripCites(text: string): string {
  return text
    .replace(CITE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** A year-like number, a section or chapter number, a list marker: not a measurement. */
export function isIncidentalNumber(text: string, index: number, match: string): boolean {
  if (/^(1[89]|20)\d{2}$/.test(match)) return true;
  const before = text.slice(Math.max(0, index - 12), index);
  if (
    /\b(chapter|section|figure|fig\.|table|equation|eq\.|objective|hypothesis|h|rq|step|phase|stage)\s*$/i.test(
      before,
    )
  ) {
    return true;
  }
  const after = text.slice(index + match.length, index + match.length + 2);
  if (/^\.\d/.test(after) && /^\d$/.test(match)) return true; // "2.1" section numbers
  return false;
}

/**
 * Measurements: a number with a unit or a percent sign, or a decimal with a statistic beside it.
 * Returns each match with its position in the text.
 */
export function measurementsIn(
  text: string,
): Array<{ value: string; index: number; full: string }> {
  const out: Array<{ value: string; index: number; full: string }> = [];
  const re =
    /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s?(%|°C|°F|K\b|GPa|MPa|kPa|Pa\b|psi|ksi|g\/cm[³3]|kg\/m[³3]|HV|HRC|HRB|HB\b|µm|um\b|nm|mm|cm|km|m\b|in\b|inch(?:es)?|ft\b|lb[sf]?\b|rpm|m\/s|m\/min|mm\/min|mA|kV|V\b|A\b|ms\b|µs|s\b|min\b|h\b|hours?|kN|N\b|kJ|J\b|kW|W\b|kHz|MHz|GHz|Hz|hp\b|mph|mg|kg|g\b|mL|ml|L\b|µL|mol|mM|µM|t\/ha|kg\/ha|wt\.?%|vol\.?%|at\.?%))/g;
  for (const match of text.matchAll(re)) {
    const value = match[1] as string;
    const index = match.index ?? 0;
    if (isIncidentalNumber(text, index, value)) continue;
    out.push({ value, index, full: match[0] });
  }
  return out;
}

/** Every number in a text, for the Results check, normalised (commas removed). */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const match of plainDigits(text).matchAll(
    /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\w])/g,
  )) {
    const value = match[1] as string;
    if (isIncidentalNumber(text, match.index ?? 0, value)) continue;
    out.push(value.replace(/,/g, ''));
  }
  return out;
}

export function containsTerm(text: string, term: string): boolean {
  const key = normalise(term);
  if (!key) return false;
  return ` ${normalise(text)} `.includes(` ${key} `);
}
