/**
 * Why a Word import's citations were not linked — Jenni build plan R34 (ADR-0113; inventory §12 B).
 *
 * Jenni says at once, after an import: "No citations found — your document must include a
 * references section … for citations to be matched." It tells the student why, not just that.
 * Ours never links a citation typed as text, with or without a references section: a citation in
 * the thesis points at a paper in the library, and an import adds no papers. So the notice says
 * that, says what the file had (a references section or none, and how many citations), and names
 * the one place that turns a pasted reference list into library papers.
 */

/** A references section the import found: its heading, the chapter it came in as, its entries. */
export type ReferencesFound = { heading: string; chapter: string; entries: number };

export type CitationNotice = {
  /** `warn` when citations were left unlinked; `info` when there were none to link. */
  tone: 'warn' | 'info';
  title: string;
  lines: string[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const PASTE = 'Citations tab → Paste a reference';

/** Where the reference list came in: "the chapter “References” (24 entries)". */
function where(found: readonly ReferencesFound[]): string {
  const total = found.reduce((n, f) => n + f.entries, 0);
  const first = found[0] as ReferencesFound;
  const entries = (n: number) => (n === 0 ? 'nothing under it' : plural(n, 'entry', 'entries'));
  if (found.length > 1) {
    return `${found.length} reference lists (${entries(total)}), the first “${first.heading}” in “${first.chapter}”`;
  }
  return first.heading === first.chapter
    ? `the chapter “${first.chapter}” (${entries(first.entries)})`
    : `“${first.heading}” in “${first.chapter}” (${entries(first.entries)})`;
}

export function citationNotice(input: {
  citationLike: number;
  references: readonly ReferencesFound[];
}): CitationNotice {
  const { citationLike: n, references } = input;
  const unlinked = `${plural(n, 'citation')} not linked`;

  if (references.length === 0) {
    if (n === 0) {
      return {
        tone: 'info',
        title: 'No citations found',
        lines: [
          'The file has no references section (a heading such as “References” or “Bibliography”) and no citations such as “(Kumar, 2021)” or “[3]”. Cite from your library as you write.',
        ],
      };
    }
    return {
      tone: 'warn',
      title: unlinked,
      lines: [
        `The file has no references section — a heading such as “References” or “Bibliography” — so nothing in it says which paper ${n === 1 ? 'the citation means' : 'each citation means'}. ${n === 1 ? 'It stays' : 'They stay'} as text.`,
        `To link ${n === 1 ? 'it' : 'them'}, add the papers to your library (${PASTE} takes a whole list), then cite each one from there.`,
      ],
    };
  }

  const list = where(references);
  if (n === 0) {
    return {
      tone: 'info',
      title: 'No citations found in the text',
      lines: [
        `Your reference list — ${list} — came in as text, but no citation such as “(Kumar, 2021)” or “[3]” was found in the text to go with it.`,
        `To cite those papers, paste the list into ${PASTE}: each one is looked up and added to your library.`,
      ],
    };
  }
  return {
    tone: 'warn',
    title: unlinked,
    lines: [
      `A citation in your thesis points at a paper in your library, and an import adds no papers, so ${n === 1 ? 'the citation stays' : 'the citations stay'} as text.`,
      `Your reference list — ${list} — came in as text. Paste it into ${PASTE} to add those papers to your library, then cite each one.`,
      'Your thesis builds its own reference list from what you cite, so the typed one can go once the citations are linked.',
    ],
  };
}
