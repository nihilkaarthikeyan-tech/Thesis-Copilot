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
