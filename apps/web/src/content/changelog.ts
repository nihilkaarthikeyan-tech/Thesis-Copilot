/**
 * What changed, for students — the data behind `/changelog` (2026-10-04, from the Jenni study:
 * Jenni keeps a public changelog).
 *
 * Written from the release history (git tags v0.1.10 onward, `CLAUDE.md` "Current state" and
 * `docs/BUILD_LOG.md`), in the student's words: what they can now do, or what no longer goes
 * wrong. Changes only an administrator sees are named as such and not described. The
 * "Unreleased" entry lists what is built and merged but not yet on the live site.
 *
 * Adding a release is one edit: move the unreleased lines into a new entry at the top with its
 * version and date. `changelog.spec.ts` checks the shape (dates, order, no empty lines).
 */

export type ChangelogEntry = {
  /** `v0.1.24`, or null for work that is built but not yet released. */
  version: string | null;
  /** The release date, `YYYY-MM-DD` (the day the work was merged, for the unreleased entry). */
  date: string;
  /** One short headline for the release. */
  title: string;
  /** Each change in a sentence a student understands. */
  changes: readonly string[];
};

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: null,
    date: '2026-10-04',
    title: 'Suggestions you can steer, and sharing with roles',
    changes: [
      'Research deeply: a switch under the chat box plans your question in parts, searches your library and the literature for each, and answers at length with a citation on every finding and advice for your section. About a minute; it uses one deep research question (one on the trial, three a month on the student plan).',
      'Every suggestion has Accept, One word, Refine and Dismiss on screen, so it can be kept on a phone too.',
      'Refine offers ready-made changes (shorter, more formal, closer to your topic, complete the paragraph, a contrasting finding) or your own instruction.',
      'Step back to an earlier suggestion with ‹ › after Refine has replaced it.',
      'Mark a suggestion as useful or not with the thumbs on the suggestion bar.',
      'Read the passage behind a suggested citation before you accept it.',
      'Suggestions read the note of the section your cursor is in, not only the chapter’s.',
      'A "/" menu inserts tables, equations, charts, diagrams, footnotes, an AI declaration and a "citation needed" marker.',
      'Equations come with examples, a live preview and a cheat sheet.',
      'Find papers beside your text, add them to your library and cite them where your cursor is.',
      'Selected-text edits can be replaced, inserted below, tried again or discarded.',
      'Comment on your own text; your comments are listed under Review.',
      'Ask chat about a selected passage, and copy a chat answer.',
      'Every check is named in one list on the Flags tab.',
      'Examiner review: a strict examiner reads a chapter you wrote against the passages it cites and flags sentences.',
      'Choose how citations go into the Word file: plain text, linked to the references, or Word citations.',
      'Your library finds possible duplicates (with Merge) and lists papers without full text so you can add the PDF.',
      'Cited-by, open-access and journal-citedness badges on library papers and citations.',
      'Full text from Europe PMC when a publisher’s PDF cannot be fetched.',
      'Sharing has roles: Guide, Co-author or Reader, changed in place; a read-only link you can turn on and off; and Make a copy of a thesis.',
      'Choose your citation style when you create a thesis; a new thesis arrives with its chapters from the outline.',
      'Returning students land back in the chapter they last wrote.',
      'Move a paragraph, table or figure up or down with Ctrl+Shift+↑ / ↓ (⌘+Shift on a Mac).',
      'A High contrast switch in Settings, which works with light, dark and system themes.',
      'Change an earlier answer in the topic conversation with Edit, while turns remain.',
      'Clearer messages: why Suggest has nothing to offer, and "the server could not be reached" instead of "Failed to fetch".',
    ],
  },
  {
    version: 'v0.1.24',
    date: '2026-10-04',
    title: 'Citations that hold, and better places to look',
    changes: [
      'Citations and equations in AI-written text now survive edits: a later suggestion no longer changes an earlier citation, and Apply no longer removes citations from the selected text.',
      'Narrative citations print as "Kumar (2021) found…" instead of "(Kumar, 2021) found…".',
      'Discover now includes conference papers, reviews, dissertations and books, and leaves out retracted papers.',
      'Expand from my citations shows what your sources cite, recent work citing them, and related work.',
      'The gap map shows how much is published on each theme, and searches again for thin themes.',
      'Add a chat answer to your chapter with its citations.',
      'Diagrams drawn from the steps and links you type, with no AI involved.',
      'A journals page suggests where you might submit, from your thesis and library.',
      'Paste a paragraph into the originality check to see where it follows a source too closely.',
      'Every thesis download carries a SHA-256 fingerprint.',
      'Suggestions appear when you pause, unless you switch that off in Settings.',
      'Suggestions improved, after a measured comparison on real theses.',
      'Clearer first minutes: a new thesis opens its proposal, and a new chapter puts the cursor in place.',
    ],
  },
  {
    version: 'v0.1.23',
    date: '2026-10-01',
    title: 'Build a chapter',
    changes: [
      'Build a chapter: it plans the chapter from your objectives, writes each section from your library, checks it and has an examiner read it. Every section arrives as a draft you accept or discard.',
      'Planning is free; a build is one unit of your monthly allowance. The quality report downloads as PDF or HTML.',
    ],
  },
  {
    version: 'v0.1.22',
    date: '2026-09-30',
    title: 'Tested instructions behind the AI',
    changes: [
      'Citation suggestions, the proposal, the outline, literature searches and viva questions now use instructions tested against real theses and kept only where they did better.',
      'A passage is never shown as direct support for a figure it does not give.',
    ],
  },
  {
    version: 'v0.1.21',
    date: '2026-09-30',
    title: 'First round of tested instructions',
    changes: [
      'The first set of tested instructions behind suggestions and drafts.',
      'Sentences with "et al." are kept whole.',
    ],
  },
  {
    version: 'v0.1.20',
    date: '2026-09-30',
    title: 'Writing that reads better',
    changes: [
      'Suggestions and drafts no longer repeat themselves, add filler or end on a dangling connective.',
      'When nothing in your library covers what you are writing, papers can be found and added for you.',
      'The coherence check warns when a cited finding is about a different material or setting.',
      'A review chapter warns about paragraphs that cite nothing.',
    ],
  },
  {
    version: 'v0.1.19',
    date: '2026-09-29',
    title: 'The trial, shown',
    changes: [
      'The days left in your free trial are shown on your theses and account pages.',
      'The 14-day trial applies only to accounts created from this release on.',
    ],
  },
  {
    version: 'v0.1.18',
    date: '2026-09-29',
    title: 'The free trial lasts 14 days',
    changes: [
      'The free trial ends 14 days after sign-up. Your theses stay and you can keep writing; the AI features then need a plan.',
    ],
  },
  {
    version: 'v0.1.17',
    date: '2026-09-29',
    title: 'Administrators, in the open',
    changes: [
      'An administrator can open your thesis to read it, never to change it. Every time, it is recorded and you are emailed.',
    ],
  },
  {
    version: 'v0.1.16',
    date: '2026-09-29',
    title: 'For administrators',
    changes: ['A change for administrators only; nothing changed for students.'],
  },
  {
    version: 'v0.1.15',
    date: '2026-09-29',
    title: 'One look, and links that open',
    changes: [
      'Every page shares one look.',
      'Downloads, figures and "Open PDF" links now open from anywhere.',
      'Long lists come in pages.',
    ],
  },
  {
    version: 'v0.1.14',
    date: '2026-09-28',
    title: 'A warning about your address',
    changes: [
      'If someone tries to sign up with the email address of your account, you are told by email.',
    ],
  },
  {
    version: 'v0.1.13',
    date: '2026-09-28',
    title: 'A new logo',
    changes: ['A new logo and site icons.'],
  },
  {
    version: 'v0.1.12',
    date: '2026-09-28',
    title: 'New home and sign-in pages',
    changes: ['A redesigned home page, sign-in and sign-up.'],
  },
  {
    version: 'v0.1.11',
    date: '2026-09-28',
    title: 'Google sign-in',
    changes: ['Google sign-in no longer needs to be pressed twice.'],
  },
  {
    version: 'v0.1.10',
    date: '2026-09-26',
    title: 'Passwords',
    changes: [
      'Your account can have a password: add one under Account, choose one at sign-up, or set one from "Forgot password". Signing in with an emailed code still works.',
    ],
  },
];

/** "4 October 2026" — how the page prints an ISO date, in UTC so it never shifts a day. */
export function formatChangelogDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
