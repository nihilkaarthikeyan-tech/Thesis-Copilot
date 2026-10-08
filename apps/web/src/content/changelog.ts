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
    version: 'v0.1.32',
    date: '2026-10-08',
    title: 'Replies, reviews in the text, and more of what Jenni has',
    changes: [
      'Your guide and you can reply to each other under a comment, with a thumbs-up on any reply.',
      'Proofreading, the tone review and the examiner now show their fixes in the text: Y accepts, N rejects, Accept all takes them all (one Undo brings them back). Examiner points are tagged Major or Minor.',
      'Check one paragraph from its ⋮⋮ handle: spelling, tone or an examiner read on that block only.',
      'Citations side by side read as one bracket — (Kumar, 2021; Rao, 2022) — in the editor and every export.',
      'Any number of chats per thesis, a chat on one collection, and "Allow this time / Always allow / Skip" when a question needs the wider literature.',
      'Archive a thesis and restore it later; copies are named "… (copy)"; switch between your theses from the chapter rail, with one New menu.',
      'Text colour, highlight, a live contents block and a horizontal rule; paper light and paper dark themes; a serif or sans-serif font for the thesis text.',
      'One export dialog with presets (thesis, plain, double-spaced, two-column), advanced options and a live preview; the compliance checks still run against your university template.',
      'The gap analysis opens as an editable chapter with every claim cited; Source quality charts the years and venues your chapter cites; Word import says why citations were not linked.',
      'When a monthly allowance is used up, every screen says which one, how many of how many, and the date it resets.',
      'A Keyboard shortcuts window; "How was this?" after a chapter build or viva set; nothing sticks out of its box at any width.',
    ],
  },
  {
    version: 'v0.1.31',
    date: '2026-10-07',
    title: 'A setup like Jenni’s, and citations from more papers',
    changes: [
      'After the title, two short steps: your sources and citations (style, web search, library search, publish year, indexing and preprints), then how to structure the thesis (Smart headings, Standard thesis chapters, or none).',
      'Indexing: papers found for you can be limited to core international journals, PubMed (MEDLINE), DOAJ, ABDC, ERIH PLUS or SciELO. Scopus, Web of Science and UGC-CARE are coming.',
      'Your planned sections now appear as headings in the chapter, and the first suggestion appears under the first one without you typing.',
      'A new thesis starts with about fifteen papers instead of five, and each section finds more papers when fewer than three cover it.',
      'A suggestion draws on several papers instead of leaning on one, and papers you have already cited make way for others.',
    ],
  },
  {
    version: 'v0.1.30',
    date: '2026-10-07',
    title: 'Edits that fit the sentence',
    changes: [
      'An edit on part of a sentence (Formalise, Shorten and the rest) now fits back into the sentence: no stray full stop in the middle and no missing space, and it starts in lower case where your selection did.',
    ],
  },
  {
    version: 'v0.1.29',
    date: '2026-10-06',
    title: 'Discover from your title',
    changes: [
      'Discover works for a thesis started with Start writing now: the search starts from your thesis title when there is no proposal, instead of asking you to save one first.',
    ],
  },
  {
    version: 'v0.1.28',
    date: '2026-10-05',
    title: 'Claims, tone and attachments',
    changes: [
      'A claims map on the Sources page: what your papers claim, how well each claim is supported, which papers disagree, a direction for your thesis and the limits of the evidence.',
      'Pin sources for one section: with the cursor under a heading, the Sources tab offers “This section”, and suggestions and drafts under that heading draw only on its pins.',
      'Tone of voice, on the Flags tab: the chapter is read against your own writing profile or a paper you choose from your library, and each sentence that clearly differs comes with a rewrite you can accept or dismiss.',
      'Attach a file to a chat question: a picture, a PDF, a Word or text file (up to three). It is read for that question only, cited by its name, and never added to your library.',
      'A suggestion that followed a paper’s wording is asked for again in its own words before you see it as final; the notice says so, and the copy warning stays if it is still close.',
      'Two more edits on a selection: Translate (into the language of your thesis) and As a table (the facts the text compares, as a table with the citations kept).',
      'On the Flags tab, Y resolves and N ignores the focused flag, and Resolve all / Ignore all act on every flag shown.',
      'A claim flagged as unsupported, or not supported by its source, has Find a source, which searches the indexes for that sentence.',
      'With "Search beyond my library" set to On, every library question also searches the literature and the answer combines both.',
    ],
  },
  {
    version: 'v0.1.27',
    date: '2026-10-05',
    title: 'Research deeply',
    changes: [
      'Research deeply: a switch under the chat box plans your question in parts, searches your library and the literature for each, and answers at length with a citation on every finding and advice for your section. About a minute; it uses one deep research question (one on the trial, three a month on the student plan).',
      'Suggestions no longer present a paper’s own aims (“the study aims to…”) as if they were your thesis’s aims.',
      'Suggestions draw on several papers instead of leaning on your own draft or one source, and author names print correctly in citations and the reference list.',
    ],
  },
  {
    version: 'v0.1.26',
    date: '2026-10-05',
    title: 'A faster first session, the paper reader and the Chrome add-on',
    changes: [
      'Start writing now is the first button on a new thesis: the editor opens at once, papers on your title are searched for straight away, and a progress line shows them arriving. A first cited suggestion comes in well under a minute.',
      'A four-step guide for your first minutes in the editor.',
      'Read a paper inside Thesis Copilot: the PDF opens in a reader where you can search it, select a passage and cite it where your cursor was.',
      'The Chrome add-on (0.2.0): save the paper you are reading on a journal site, arXiv or PubMed, or tick several on a PubMed, arXiv or Google Scholar results page; put them in a collection; attach the PDF; then open the paper in Thesis Copilot.',
    ],
  },
  {
    version: 'v0.1.25',
    date: '2026-10-05',
    title: 'Suggestions you can steer, and sharing with roles',
    changes: [
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
      'Import a chapter from a Word file.',
      'Collections in your library, to keep papers for each chapter together.',
      'Import your Zotero library, or one collection, with a read-only key.',
      'Write an equation in words, or from a photo of one, and get it typeset.',
      'Chat can search beyond your library and show papers you can add.',
      'Hindi interface (beta), and citations in the language of your choice.',
      'An email when a long job, such as a chapter build, finishes.',
      'Help pages, this What’s new page, and a demonstration on the home page.',
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
