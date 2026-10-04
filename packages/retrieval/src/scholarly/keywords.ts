/**
 * A question → the words worth searching for, for the indexes that do not rank natural language.
 *
 * OpenAlex and Semantic Scholar take "what does the literature say about rooftop solar in India?"
 * and rank it well. arXiv's API treats every word as a term, and PubMed ANDs them — so "what",
 * "does" and "literature" either flood the result or empty it. Both are asked for the content
 * words only.
 */

const STOPWORDS = new Set(
  (
    'a about above across after again against all also am an and any are as at be because been ' +
    'before being below between both but by can could did do does doing done during each either ' +
    'else ever few for from further get gets got had has have having how however if in into is it ' +
    'its itself just many may me might more most much must my no nor not of off on once only or ' +
    'other our out over own per same she should since so some such than that the their them then ' +
    'there these they this those through to too under until up upon us very was we were what when ' +
    'where whether which while who whom whose why will with within without would you your ' +
    // Words a student uses to ask about the literature, which describe every paper equally.
    'article articles evidence find finding literature paper papers publication publications ' +
    'research say says show shows study studies tell work works'
  ).split(' '),
);

/**
 * Words a student uses to describe a thesis rather than its subject: the degree, the kind of
 * document, who will read it, what it sets out to do. "MSc thesis on mangroves … Audience:
 * examiners … Argue that …" sent whole to OpenAlex found 0 works; its subject words found 465
 * (2026-10-04, docs/JENNI-FIX-LIST.md item 2).
 */
const THESIS_NOISE = new Set(
  (
    'msc mphil phd thesis dissertation proposal topic audience examiner examiners argue argues ' +
    'arguing using comparing compare'
  ).split(' '),
);

/** Up to `max` distinct content words, in the order the student wrote them. */
export function keywordsOf(text: string, max = 6, extraStopwords?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const token of text.split(/[^\p{L}\p{N}-]+/u)) {
    const word = token.replace(/^-+|-+$/g, '');
    if (!word) continue;
    const lower = word.toLowerCase();
    // Short words are almost always function words; an acronym ("AI", "5G") is the exception.
    const acronym = word.length === 2 && (word === word.toUpperCase() || /\d/.test(word));
    if ((word.length < 3 && !acronym) || STOPWORDS.has(lower) || extraStopwords?.has(lower)) {
      continue;
    }
    if (!out.includes(lower)) out.push(lower);
    if (out.length === max) break;
  }
  return out;
}

/**
 * The searches for a proposal's early gap check (FR-1.5), most specific first: the topic's subject
 * words, then — only when there were more than two — the first half of them, which in a student's
 * description is the subject before the setting and method. Empty when nothing is left to search.
 */
export function topicSearchTerms(text: string, max = 6): string[] {
  const words = keywordsOf(text, max, THESIS_NOISE);
  if (words.length === 0) return [];
  const searches = [words.join(' ')];
  if (words.length > 2)
    searches.push(words.slice(0, Math.max(2, Math.ceil(words.length / 2))).join(' '));
  return searches;
}

/**
 * Text for OpenAlex's `search=`, which refuses `?` and `*`: it reads them as wildcards, and a
 * stemmed search with a wildcard is an HTTP 400 ("Wildcards (* or ?) require exact (no-stem)
 * search" — observed 2026-09-24, when every chat question ending in "?" was coming back empty).
 * A question ends in one and a title can contain one; neither means anything to a relevance
 * search, so both go.
 */
export function openAlexSearchText(text: string): string {
  return text.replace(/[?*]/g, ' ').replace(/\s+/g, ' ').trim();
}
