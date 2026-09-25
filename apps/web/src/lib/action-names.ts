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
