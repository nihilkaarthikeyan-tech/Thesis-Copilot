/**
 * The AI actions in plain words, for the admin screens (2026-09-25). The codes are what the call
 * log records (PRD §8 `AiAction`); nobody running the service should have to know them.
 */

export const ACTION_NAMES: Record<string, string> = {
  ASSIST: 'Autocomplete',
  DRAFT: 'Drafted sections',
  CITE: 'Citation suggestions',
  CHAT: 'Chat with papers',
  COMMAND: 'AI edits',
  COHERENCE: 'Consistency check',
  VIVA: 'Viva preparation',
  CHAPTER_BUILD: 'Chapter builds',
  PROPOSAL: 'Proposal conversation',
  OUTLINE: 'Outline',
  STYLE_PROFILE: 'Writing profile',
  SCOPED_REVISION: 'Supervisor-requested revisions',
  CLASSIFY_COMMENT: 'Sorting supervisor comments',
  SEARCH_QUERIES: 'Literature search',
  PARSE_CITATION: 'Reading pasted references',
  EXTRACT: 'Reading uploaded papers',
  CROSS_PAPER: 'Cross-paper check',
  EMBED: 'Making papers searchable',
};

export const actionName = (code: string): string => ACTION_NAMES[code] ?? code;

/**
 * The monthly allowances in the student's words — one map for the Account, Settings and Pricing
 * pages, which had a copy each and printed "VIVA" and "CHAPTER_BUILD" for the two none of them
 * knew.
 */
export const ALLOWANCE_NAMES: Record<string, string> = {
  ASSIST: 'Assist suggestions',
  DRAFT: 'Draft sections',
  CITE: 'Citation suggestions',
  CHAT: 'Questions to your library',
  COMMAND: 'Section commands',
  COHERENCE: 'Coherence checks',
  VIVA: 'Viva practice',
  CHAPTER_BUILD: 'Chapter builds',
};

export const allowanceName = (code: string): string =>
  ALLOWANCE_NAMES[code] ?? ACTION_NAMES[code] ?? code;

type AllowanceLine = { action: string; used: number; cap: number };

/**
 * The allowances a plan actually includes. A cap of 0 is not an allowance ("Coherence checks
 * 0 / 0" on the trial read like a fault); it is listed apart by `notIncluded`. One that has been
 * used stays, whatever its cap, so a count is never hidden.
 */
export const includedAllowances = <T extends AllowanceLine>(lines: readonly T[]): T[] =>
  lines.filter((line) => line.cap > 0 || line.used > 0);

/** "Coherence checks, Chapter builds" — the plan's zero-cap allowances, or '' when none. */
export const notIncluded = (lines: readonly AllowanceLine[]): string =>
  lines
    .filter((line) => line.cap <= 0 && line.used <= 0)
    .map((line) => allowanceName(line.action))
    .join(', ');
