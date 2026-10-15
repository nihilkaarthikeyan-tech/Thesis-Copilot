/**
 * An author and year written into the running text without brackets (ADR-0155, the Word test of
 * 2026-10-16): "The study by Bagla 2026 highlights…", "Findings from Kodali 2026 indicate…". The
 * model copies the passage tag it was shown ("Bagla 2026") into the prose. It is not APA, and the
 * same paper is cited properly by its marker in the same suggestion anyway.
 *
 * Fixed in code, not in the prompt (no prompt change without an evaluation round), with a closed
 * pattern: the first author's surname of a passage in the request, an optional "et al.", then
 * that passage's own year, bare (not in brackets). Only when that paper's marker is in the same
 * text, so the citation the student sees is unchanged:
 *
 *   - "The study by Bagla 2026 highlights" → "One study highlights", or "This study" when the
 *     paper was already named before (an earlier marker in the text, or its name before the
 *     cursor). The lead-in's noun is kept ("The review by …" → "One review"); "research" and
 *     "work" become "study".
 *   - any other place ("Findings from Kodali 2026 indicate") → "Findings from one study indicate".
 *
 * Nothing else changes. No marker is added, removed or moved (§10.6). A name and year with no
 * marker of that paper in the text is left as it is: rewriting it would lose the attribution.
 */

const MARKER = /\{\{cite:\s*([^#}\s]+)[^}]*\}\}/g;

export type PassageRef = { id: string; shortRef: string };

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Bagla 2026" → { name: "Bagla", year: "2026" }; a title fallback ("Power on the Roof 2025") is none. */
function parseShortRef(shortRef: string): { name: string; year: string } | null {
  const match = /^(.+?)\s+((?:19|20)\d{2})$/.exec(shortRef.trim());
  if (!match) return null;
  const name = (match[1] ?? '').replace(/\.+$/, '').trim();
  // A surname is at most three words ("van der Berg") and has no title punctuation.
  if (!name || name.split(/\s+/).length > 3 || /[:;,?!]/.test(name)) return null;
  if (!/^\p{Lu}/u.test(name)) return null;
  return { name, year: match[2] as string };
}

/** The paper a passage id belongs to: `S3` of `S3#c2`. */
const paperOf = (id: string): string => id.split('#')[0]?.trim() ?? id;

const NOUNS: Record<string, string> = {
  study: 'study',
  paper: 'paper',
  review: 'review',
  analysis: 'analysis',
  survey: 'survey',
  report: 'report',
  article: 'article',
  research: 'study',
  work: 'study',
};

export function rewriteBareAuthorYear(
  text: string,
  passages: readonly PassageRef[],
  before = '',
): { text: string; rewritten: number } {
  const papers = new Map<string, { name: string; year: string }>();
  for (const passage of passages) {
    const parsed = parseShortRef(passage.shortRef);
    if (parsed) papers.set(paperOf(passage.id), parsed);
  }
  if (papers.size === 0) return { text, rewritten: 0 };

  let out = text;
  let rewritten = 0;
  for (const [paper, { name, year }] of papers) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}(])((?:the|a|an|one)\\s+(study|paper|review|analysis|survey|report|article|research|work)\\s+(?:by|of|from)\\s+|(?:research|work)\\s+by\\s+)?${escapeRe(name)}(?:\\s+et\\s+al\\.?)?,?\\s+${year}(?![\\p{N})\\]])`,
      'giu',
    );
    out = out.replace(
      pattern,
      (
        whole: string,
        _lead: string | undefined,
        noun: string | undefined,
        offset: number,
        all: string,
      ) => {
        const markers = [...all.matchAll(MARKER)];
        if (!markers.some((m) => m[1] === paper)) return whole;
        const earlier =
          markers.some((m) => m[1] === paper && (m.index ?? 0) < offset) ||
          new RegExp(`(?<![\\p{L}])${escapeRe(name)}(?![\\p{L}])`, 'u').test(before);
        const kind = NOUNS[(noun ?? 'study').toLowerCase()] ?? 'study';
        const phrase = `${earlier ? 'this' : 'one'} ${kind}`;
        const head = all.slice(0, offset);
        const startsSentence =
          head.trim() === '' || /[.!?]["'”’)\]]*\s+$/.test(head) || /\n\s*$/.test(head);
        rewritten++;
        return startsSentence ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
      },
    );
  }
  return { text: out, rewritten };
}
