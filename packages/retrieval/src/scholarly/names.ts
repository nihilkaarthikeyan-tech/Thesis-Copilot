/**
 * A display name ("Olivier L. de Weck") → a CSL name ({ family: 'de Weck', given: 'Olivier L.' }).
 *
 * arXiv and OpenAlex give names as one string. Stored as a CSL `literal`, a name prints exactly as
 * written — "Zeyad Awwad (2023)" where APA wants "Awwad, Z. (2023)" — because a citation style can
 * only invert and abbreviate a name it knows the parts of. The split is the usual Western one:
 * the last word is the family name, together with any lower-case particles before it. A name it
 * cannot split with confidence (one word, or already inverted with a comma) is left literal, which
 * prints wrongly-formatted but never wrongly-spelled.
 */

import type { CslAuthor } from './resolve.js';

const PARTICLES = new Set([
  'al',
  'bin',
  'da',
  'das',
  'de',
  'del',
  'della',
  'der',
  'di',
  'do',
  'dos',
  'du',
  'la',
  'le',
  'ten',
  'ter',
  'van',
  'von',
]);

const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

export function personName(displayName: string): CslAuthor {
  const name = displayName.replace(/\s+/g, ' ').trim();
  const words = name.split(' ');
  if (words.length < 2 || name.includes(',')) return { literal: name };

  let suffix: string | undefined;
  if (words.length > 2 && SUFFIX.test(words[words.length - 1] ?? '')) suffix = words.pop();

  let start = words.length - 1;
  while (start > 1 && PARTICLES.has((words[start - 1] ?? '').toLowerCase())) start--;
  const family = words.slice(start).join(' ');
  const given = words.slice(0, start).join(' ');
  if (!family || !given) return { literal: name };
  return { family, given, ...(suffix ? { suffix } : {}) };
}

/** A word that can be a name: two or more letters, not an honorific. */
const NAME_WORD = /^\p{L}[\p{L}'’-]+$/u;
const HONORIFIC = /^(ms|mrs|mr|miss|dr|prof|shri|smt|sri|kum)\.?$/i;
const hasLetter = (s: string) => /\p{L}/u.test(s);

/**
 * ADR-0078: the authors as a citation should name them. The scholarly indexes give, for real
 * papers in a student's library: the authors' college as first and last "author" around the
 * people ("Sri Kaliswari College et al., 2025" where Jenni prints "Mathivathana & Alagulakshmi"),
 * a family name of "-" ("- 2026"), an initial as the family name ("A 2026"), and a whole name in
 * the family field ("K. V. Kiruthika"). Each is repaired here, never invented: a name only moves
 * between fields or is dropped, and an author list with no person in it is left as it came.
 */
export function cleanAuthors(authors: readonly CslAuthor[]): CslAuthor[] {
  const repaired = authors.map((a): CslAuthor => {
    if (a.literal !== undefined || a.family === undefined) return a;
    const family = a.family.trim();
    const given = (a.given ?? '').trim();
    // The whole name in the family field, nothing in given.
    if (!given && family.includes(' ')) return personName(family);
    // A family with no letters, or a single initial, and a real name in given: the name is there.
    if (!hasLetter(family) || family.replace(/\./g, '').length === 1) {
      const words = given.split(/\s+/).filter((w) => w && !HONORIFIC.test(w));
      const nameIndex = words.findLastIndex((w) => NAME_WORD.test(w));
      if (nameIndex >= 0) {
        const rest = words.filter((_, i) => i !== nameIndex);
        const initial = hasLetter(family) ? [family] : [];
        return { ...a, family: words[nameIndex] as string, given: [...rest, ...initial].join(' ') };
      }
    }
    return { ...a, family, given };
  });
  const isPerson = (a: CslAuthor) => a.literal === undefined && hasLetter(a.family ?? '');
  const people = repaired.some(isPerson) ? repaired.filter(isPerson) : repaired;
  const seen = new Set<string>();
  return people.filter((a) => {
    const key = `${a.family ?? ''}|${a.given ?? ''}|${a.literal ?? ''}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
