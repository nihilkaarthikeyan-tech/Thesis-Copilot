/**
 * What an uploaded PDF says about itself on its first page (Jenni build plan R20, ADR-0107): a
 * DOI if one is printed, else the title, the authors with their initials, a year and the abstract.
 * Jenni, given the same synthetic test PDF, lost the author's initial, kept line-break hyphens and
 * dropped the abstract; ours kept the file name as the title and read nothing at all.
 *
 * Heuristics on text, not layout (pdf text has no font sizes here), so each part is returned only
 * when it is plainly there, and the worker prefers the DOI's record over all of it. Never invents:
 * a part it cannot find is left out.
 */

import { personName } from './names.js';
import type { CslAuthor } from './resolve.js';

export type FirstPage = {
  doi?: string;
  title?: string;
  authors?: CslAuthor[];
  year?: number;
  abstract?: string;
};

/** How much of the text counts as the first page when the page boundaries are not known. */
export const FIRST_PAGE_CHARS = 4_000;

/** "temper-\nature" → "temperature": a word broken at the end of a line, not a real hyphen. */
export function joinBrokenWords(text: string): string {
  return text.replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, '$1$2');
}

const HEADER =
  /\b(journal|vol\.|volume|issue|issn|doi|https?:|www\.|©|copyright|received|accepted|published|licen[cs]e|open access|preprint|arxiv|page \d|pp\.)\b/i;
const AFFILIATION =
  /\b(department|dept\.|university|universit[éy]|institute|institut|college|school|faculty|centre|center|laborator|hospital|ministry|corresponding|e-?mail|@)\b/i;
const ABSTRACT_START = /^\s*(abstract|summary)\b\s*[:.—–-]?\s*/i;
const ABSTRACT_END =
  /^\s*(key\s?words?|index terms|(\d+\.?\s*)?introduction|(\d+\.?\s*)?background|1\.\s+\S|jel\b|highlights)\b/i;

/** A person's name as it is printed in a byline: two to five capitalised words or initials. */
function looksLikeName(part: string): boolean {
  const words = part.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) =>
    /^(\p{Lu}[\p{L}'’-]*\.?|\p{Lu}\.(\p{Lu}\.)*|van|von|de|da|del|der|la|le|bin|binti)$/u.test(w),
  );
}

/** The names in a byline, before the affiliations: "A. Test Author, B. Kumar and C. Rao, Dept …". */
function bylineNames(line: string): CslAuthor[] {
  const beforeAffiliation = line.split(AFFILIATION)[0] ?? line;
  return beforeAffiliation
    .replace(/[\d*†‡§¹²³⁴⁵⁶⁷⁸⁹]+/g, ' ')
    .split(/\s*,\s*|\s+and\s+|\s*;\s*|\s*&\s*/)
    .map((part) => part.trim())
    .filter(looksLikeName)
    .map((name) => personName(name));
}

export function readFirstPage(text: string): FirstPage {
  const page = joinBrokenWords(text.slice(0, FIRST_PAGE_CHARS));
  const out: FirstPage = {};

  const doi = /\b(10\.\d{4,9}\/[^\s"<>]+)/i.exec(page)?.[1]?.replace(/[.,;)\]]+$/, '');
  if (doi) out.doi = doi.toLowerCase();

  const lines = page.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const abstractAt = lines.findIndex((l) => ABSTRACT_START.test(l));

  // The abstract: the "Abstract" line's own text, then the lines after it, to the next heading.
  if (abstractAt >= 0) {
    const parts: string[] = [];
    const first = (lines[abstractAt] ?? '').replace(ABSTRACT_START, '').trim();
    if (first) parts.push(first);
    for (const line of lines.slice(abstractAt + 1)) {
      if (ABSTRACT_END.test(line)) break;
      if (!line) {
        if (parts.length > 0 && parts.join(' ').length > 200) break;
        continue;
      }
      parts.push(line);
    }
    const abstract = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (abstract.split(' ').length >= 20) out.abstract = abstract.slice(0, 3_000);
  }

  // Title and byline: in the lines before the abstract (or the first dozen), the first byline is
  // the line with names before an affiliation; the title is the run of lines just above it.
  const head = lines.slice(0, abstractAt >= 0 ? abstractAt : 12).filter(Boolean);
  const bylineAt = head.findIndex((l) => bylineNames(l).length > 0 && !HEADER.test(l));
  if (bylineAt > 0) {
    const authors = bylineNames(head[bylineAt] as string);
    if (authors.length > 0) out.authors = authors;
    const titleLines: string[] = [];
    for (let i = bylineAt - 1; i >= 0; i--) {
      const line = head[i] as string;
      if (HEADER.test(line) || AFFILIATION.test(line)) break;
      titleLines.unshift(line);
      if (titleLines.length >= 4) break;
    }
    const title = titleLines.join(' ').replace(/\s+/g, ' ').trim();
    if (title.length >= 10 && title.length <= 400) out.title = title;
  }

  const year = /\b(19[5-9]\d|20[0-4]\d)\b/.exec(head.join(' '))?.[1];
  if (year) out.year = Number(year);
  return out;
}
