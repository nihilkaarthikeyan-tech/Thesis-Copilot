/**
 * How much of what you cite have you actually read? (2026-09-21)
 *
 * Every `Source` already carries a `groundingLevel` — `NONE`, `ABSTRACT` or `FULL_TEXT` — written
 * only when something was genuinely fetched and read (one of this codebase's standing rules: never
 * assert a fact the code has not observed). Until now it was a badge on the sources screen and
 * nothing more.
 *
 * It answers a question no other writing tool can ask, because no other writing tool knows which
 * papers you have: **you cite this work heavily and you have only ever seen its abstract.**
 *
 * That is the single most common way a viva goes wrong. An examiner picks the reference you leaned
 * on hardest and asks what the authors actually did. A student who read the abstract can describe
 * the finding and not the method, and the examiner knows immediately.
 *
 * ## What this is not
 *
 * It is not a score, a grade, or a percentage of "quality". A thesis legitimately cites some works
 * once, in passing, from the abstract — that is what a passing reference *is*. The warning is
 * deliberately shaped around **weight**: a source cited once at abstract depth is fine and is not
 * mentioned; the same source cited nine times is the thing to say out loud.
 *
 * It also never blocks anything. There is no gate here and no export refusal — it is information
 * a supervisor would give you, given earlier.
 */

/** Cited this often at abstract-only depth, and it stops being a passing reference. */
export const HEAVY_CITE_THRESHOLD = 3;

export type SourceDepth = {
  sourceId: string;
  shortRef: string;
  title: string | null;
  groundingLevel: 'NONE' | 'ABSTRACT' | 'FULL_TEXT';
  /** How many citation nodes across the whole document point at this source. */
  citeCount: number;
};

export type ReadingDepth = {
  totals: { sources: number; cited: number; fullText: number; abstract: number; none: number };
  /**
   * The ones worth naming: cited at least `HEAVY_CITE_THRESHOLD` times and never read past the
   * abstract. Ordered by how much the thesis leans on them.
   */
  atRisk: SourceDepth[];
  /** Cited, and nothing was ever fetched for them at all — not even an abstract. */
  unread: SourceDepth[];
  /** One sentence for the UI, or null when there is nothing worth saying. */
  headline: string | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function readingDepth(sources: readonly SourceDepth[]): ReadingDepth {
  const cited = sources.filter((s) => s.citeCount > 0);

  const totals = {
    sources: sources.length,
    cited: cited.length,
    fullText: cited.filter((s) => s.groundingLevel === 'FULL_TEXT').length,
    abstract: cited.filter((s) => s.groundingLevel === 'ABSTRACT').length,
    none: cited.filter((s) => s.groundingLevel === 'NONE').length,
  };

  const atRisk = cited
    .filter((s) => s.groundingLevel === 'ABSTRACT' && s.citeCount >= HEAVY_CITE_THRESHOLD)
    .sort((a, b) => b.citeCount - a.citeCount);

  const unread = cited
    .filter((s) => s.groundingLevel === 'NONE')
    .sort((a, b) => b.citeCount - a.citeCount);

  return { totals, atRisk, unread, headline: headlineFor(totals, atRisk, unread) };
}

/**
 * The sentence a supervisor would actually say.
 *
 * Silent when there is nothing to report. A tool that always has a warning is a tool people stop
 * reading, and a thesis that cites everything at full text deserves to be left alone.
 */
function headlineFor(
  totals: ReadingDepth['totals'],
  atRisk: readonly SourceDepth[],
  unread: readonly SourceDepth[],
): string | null {
  if (totals.cited === 0) return null;

  if (unread.length > 0) {
    return (
      `${plural(unread.length, 'source')} you cite ${unread.length === 1 ? 'has' : 'have'} nothing ` +
      'fetched at all — not even an abstract. An examiner asking about one of these has nothing to ' +
      'hear, and neither do you.'
    );
  }

  if (atRisk.length > 0) {
    const worst = atRisk[0];
    return (
      `You lean on ${plural(atRisk.length, 'source')} that you have only read the abstract of. ` +
      `${worst ? `${worst.shortRef} alone is cited ${worst.citeCount} times.` : ''} ` +
      'Examiners pick the reference you used most and ask what the authors actually did.'
    ).trim();
  }

  if (totals.abstract > 0) {
    return (
      `Every source you lean on has been read in full. ${plural(totals.abstract, 'other')} ` +
      `${totals.abstract === 1 ? 'is' : 'are'} cited from the abstract only, which is normal for a ` +
      'passing reference.'
    );
  }

  return `All ${plural(totals.cited, 'cited source')} have been read in full.`;
}
