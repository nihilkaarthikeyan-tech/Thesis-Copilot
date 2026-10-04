# Jenni and ours, journey by journey — a user-experience study (2026-10-04)

Not a build plan. What a student meets at each step, in both tools, on the same topic: an MSc thesis
on soil organic carbon in restored and natural mangroves at Pichavaram, Tamil Nadu. Jenni on the
owner's free account; ours on the dev stack with the real models. Timings are from the screen.

## 1. Coming back to the tool

| | Jenni | Ours |
|---|---|---|
| Lands on | The last document, open, cursor where it was | A dashboard: trial banner, "new thesis" form, then the list |
| Document list | A side panel over the editor: search, archive, "+" | Cards with ten links each (Proposal, Sources, Outline, Build, Review, Submit, Journals, Viva, Write, Delete); "Write" is ninth |

Jenni assumes the student came to write. Ours asks them to choose among ten places every time.

## 2. Starting a new piece of work

| Step | Jenni | Ours |
|---|---|---|
| Create | "+" makes an Untitled document at once; the empty page *is* the start screen | Title + "a paper I have written / a topic" + Create |
| Describe it | One prompt box; the placeholder types example prompts by itself; a meter turns from red "Weak prompt" to green "Great prompt: Jenni will reference this" at ~110 characters, instantly (no AI call) | A conversation: up to three questions. The first was a sharp research-design question with four options — better guidance than Jenni gives — but the options are numbered text the student must type, not buttons |
| Other ways in | "Import from Word (.docx)", "Skip and start writing" | "Start from a paper", "Fill it in myself instead" |
| Settings | One screen of chips with good defaults: style, web/library search, year, impact factor, cited-by, preprints | None at the start |
| Earlier answers | Fold into chat bubbles with "Edit" | The conversation stays above |
| Structure | IMRaD / AI headings / none; "Analyzing your topic…" with a skeleton | Proposal: problem statement, four objectives, a gap statement — far more substance |
| Lands in | The full document: every heading, per-section notes written from the prompt (it picked up the student's own argument), cursor in the Introduction | Chapter 1 only, under two explanatory banners that fill half the screen |
| First cited sentence | ~15 s after Start, appears by itself | Did not appear. Ctrl+/ and the Suggest button both did nothing visible (the request ran 3 s and returned nothing; no message) |
| Clicks from "+" to a cited sentence | 4 screens, about a minute, nothing uploaded | Not reached without leaving the editor for Sources |

Faults seen in ours on the way: the related-work panel found **0 works** for a topic where Jenni's
search returned Pichavaram papers in 3 s, yet the drafted gap statement says "Related work found
addresses…"; the topic path offers "See the sources found in your paper"; the editor breadcrumb shows
"Theses / /" because a long title collapses to nothing; the toolbar's "Chart" and "Diagram" labels
overlap; the banner still says "press Ctrl+/" although suggestions now come on a pause.

## 3. Finding papers

| | Jenni | Ours |
|---|---|---|
| Where | A side panel in the editor; the document stays visible | A separate page ("Back to writing →") |
| Start | A suggested query from the document; recent searches | "Discover literature" button; "No search yet" |
| Time | ~3 s | ~80 s, with only "Searching…" |
| Result | A list: type, cited-by, impact factor, open access, the matching passage, Cite / Open quote / Save | 70 candidates in 7 themes, each marked open gap or active area, with a trend line — far deeper, but dense |
| To cite one | "Cite" on the result | Tick, "Add N to the library", go back to the editor, write, wait for a suggestion |
| Words the student sees | Plain | "One search costs one Strong call and one Fast call" — our internal terms |

The editor's Sources tab said "No papers yet" while the Sources page said "5 in the library":
automatic sources had added them and the open panel never refreshed.

## 4. While writing

| | Jenni | Ours |
|---|---|---|
| Suggestion | Ghost text with Accept, Refine, thumbs; hover a citation → evidence card (cited-by, impact factor, open access, quoted passage, Open quote) before accepting | Ghost text; Tab/→ to accept; citations checked in code against the library |
| Refine | Prompt box + presets (stay on topic, complete paragraph, novelty, simplify, no citations, validate evidence, cite from my library); arrows through earlier suggestions | Shift+→ with a typed instruction |
| Section notes | A side panel: document prompt + notes per heading, each with sources to pin and "Generate" (one sentence) | "What this chapter is for" banner per chapter |
| Selection | One menu: Find citations, AI Chat, AI Edit (17 actions), Comment, Review | Five commands |
| Screen readers | The suggestion is announced ("Press right arrow to accept") | Not checked |

## 5. Asking questions

| | Jenni | Ours |
|---|---|---|
| Place | One chat for the account, continued across documents with "Opened new document — New Chat" | Per thesis, a tab in the tools panel |
| Empty state | Blank — no examples (weaker than ours) | A sentence on what to ask and what it answers from |
| Scope | Chips: Web / Library / Current document; each search Off / Ask / On | Library / This thesis / Find papers |
| Extras | Attach a file or image; saved prompts | `@` a paper, `/` saved prompts |
| Answer | ~90 s, agentic, shows its steps, Copy / Add to document | ~2 s, from the library only, Add to document |

## 6. Checking the work

Jenni: one Review panel, five cards, one button each — Claim confidence, Peer Review, Source
Quality, Tone of Voice, Proofread. Results arrive as tracked changes to accept or reject.

Ours: the same kinds of checks exist but are spread across the Flags tab, the Review tab, the
coherence run, proofreading, the citation report, the originality page and the Submit page.

## 7. On a phone

Jenni: compact top bar and a floating toolbar (outline, Cite, undo, redo); usable for reading and
light edits. Ours: a bottom tab bar (Sources, Citations, Chat, Flags, Review); not re-tested today.

## 8. Research gap analysis (Jenni's second workflow), side by side with our gap map

Same topic. Jenni's setup is three conversational steps (topic with the prompt meter, where to
search, filters) ending in a button that says how long it takes: "Start gap analysis · 3–6 min".

| | Jenni | Ours (Discover) |
|---|---|---|
| While running | Three named stages with a running clock; "Safe to close this tab – you will receive an email". The "detailed steps" rotate generic lines ("Organizing my thoughts", "Exploring possibilities") | "Searching…" |
| Time | 9 min 54 s (it said 3–6) | ~80 s |
| Result | A new document: 67 works → **15 claims**, each *under-explored / contested / well-supported*, in a table with supporting and contrasting citations and a suggested direction; then ~3,400 words of evidence with figures from the papers; ends with "Limits of this retrieval" | 70 candidates in **7 themes**, each marked open gap or active area from how many papers there are, with a trend line; papers to tick and add |
| Fit to the thesis | The four under-explored claims were this thesis's own openings (paired restored-versus-natural cores at Pichavaram; Sentinel-2 SOC there; depth-resolved sampling) | Themes are topical; why a gap is open is left to the student |
| Faults | Repeats a citation in a row ("(Bourgeois et al., 2024), (Bourgeois et al., 2024)"); its 39 references are behind the paywall | — |
| After | Opens the document with the Review panel already beside it | Stays on the Sources page |

The difference is the unit: Jenni reasons over **claims** (what papers assert, where they disagree),
ours over **counts** (how much is published per theme). A committee asks the first question.

## 9. Account, plans, help

| | Jenni | Ours |
|---|---|---|
| Usage | The account menu shows a bar per allowance (uploads, autocompletes, edits, chats, reviews, workflows). The failed workflow run was not charged | Usage bars on the Account page; "Assist 0/50 · Draft 0/2" in the editor header |
| Settings | One dialog: Account (email, change, delete), Preferences (16 interface languages incl. Hindi and British English; 7 themes incl. high-contrast and "paper"; web/library search Off/Ask/On), Connections (Zotero, Mendeley, Chrome extension), Document defaults (autocomplete, citation style, font) | Settings and Account pages; light/dark |
| Price (India) | "50% local discount": Plus ₹1,427/month or ₹570.83/month yearly; Pro ₹3,449 or ₹1,379.58. Plus: 5,000 autocompletes, 500 edits, 500 chats, 10 reviews, 10 workflows a month | ₹299 planned |
| Help | Send a message (live chat), 11 video tutorials by topic, documentation, changelog, Discord | "How suggestions work (90 seconds)", Feedback |
| Citation style | Search 10,000+ styles, five most popular first, a locale per style, page numbers on/off, live preview of in-text, bibliography and captions | All CSL styles (ADR-0019) |
| Comments | Select → Comment → a box under the text | Comments with the guide/committee cycle |

## 10. Failure and edge states

- Jenni's failed literature-review run (first pass) said "Something went wrong… Please try again";
  afterwards the Workflows page showed "No runs yet" — the failure left no trace and no retry.
- Ours, with the API down, shows the raw words "Failed to fetch" and a link back.
- Ours, asked for a suggestion with nothing to cite, does nothing visible (section 2).
- Ours, the proposal's related-work search: it sends the student's whole message ("…Audience:
  examiners in environmental science. Argue that…" plus their answer "2") to OpenAlex as one search
  and gets **0**; the words "Pichavaram mangrove soil organic carbon" get **465**. A failed search is
  also recorded as "0 found", so "nothing exists" and "the search broke" look the same.

## 11. Phone and screen reader (ours)

At 375 px the editor works, but the two banners and a two-row toolbar fill most of the screen before
the text, and the banner speaks of Ctrl+/ and Tab. Our suggestion is announced to screen readers only
as "suggestion available"; Jenni reads the suggestion itself and "Press right arrow to accept".

## 12. Inserting things (equations, tables, declarations)

Jenni's "/" menu: Text, H1–H4, bulleted and numbered lists, code, **Table, Image, Equation, Chart**,
quote, divider, **Table of Contents**, **AI Declaration**, Placeholder Citation, Cite.

- **Equation** opens a dialog with three ways in: **KaTeX** (with "Quadratic", "Maxwell's",
  "Piecewise" examples), **Describe** ("describe your equation in plain English", with "Quadratic
  formula", "Integral of sin x", "Matrix 2×2" to try) and **Image** (a picture of an equation). A
  student who does not know LaTeX can still write one.
- **AI Declaration** inserts a "Declaration of AI Usage" heading and the standard journal-style
  statement (used Jenni AI for clarity; reviewed and takes full responsibility).
- Ours: a toolbar button opens one LaTeX line with "E = mc^2" as the placeholder — no examples, no
  words-to-equation, no picture. (Our AI-usage report exists, inside the export.)

## 13. First impression (public home page)

| | Jenni | Ours |
|---|---|---|
| Hero | "Meet Your Intelligent Research Assistant"; one button "Start writing – it's free"; "Loved by over 6 million academics" | "A thesis editor that only cites papers you've read"; "Made for master's and PhD students in India"; two buttons; "14-day free trial, no card · Nothing deleted if you stop paying" |
| Below the fold | The real editor, **animated**: a chat answer types itself out with citations beside a cited abstract | A stock photograph of a student with one static evidence card |
| Signed in | The app is on its own domain and opens the last document | A signed-in student opening the site sees the sales page and "Start writing free" |
| At ~800 px | Clean | Our navigation wraps ("Thesis / Copilot", "Sign / in", "How it / works") |

## 14. What students say about Jenni (outside the product)

From review sites and threads (summarised, 2026-10): Trustpilot 3.6–3.8 from ~150 reviews. The most
frequent complaints are **billing**: renewals without clear notice, a cancel button hard to find,
charges after cancelling, refunds refused ("generally not refundable"; cancelling is desktop-only per
its own docs). On Reddit the most repeated complaint is **citations that are wrong or do not exist**,
then prose that reads worse than general chatbots, and a free tier too small to judge it by. Praise
goes to the library, PDF chat and saving time on citations. A journalism piece reported thousands of
undisclosed paid TikTok promotions for AI study apps including Jenni.

## 15. Their documentation and release pace

- Docs: Getting started, Writing (editor, headings, maths, images, version history), AI tools
  (autocomplete, section prompts, chat, saved prompts, editing, reviews), Research (citations,
  library, PDF reader, browser extension, open-access papers, academic terminology), Collaboration
  (sharing, comments, read-only sharing, **document cloning**), Export/Import, Account (plans,
  settings, language, login, mobile, privacy).
- **Sharing has roles** — Editor, Commenter, Viewer — by invitation or by link, and live co-editing
  with named cursors (the roles shipped 2026-09-23; the share dialog shows them once an email is
  entered). *This corrects the first pass, which said "no roles".*
- Reviews open as tracked changes with a review mode: Y accept, N reject, arrows, Accept all.
  Proofread follows British spelling; Tone of Voice can take a library PDF as the model; Peer Review
  gives ratings, strengths, weaknesses, questions and comment threads.
- Privacy page: "Your writing is not used to train Jenni models"; providers not named.
- Free plan: autocompletes 10 a day; AI edits 5, chats 5, workflows 3 — **one-time, not monthly**.
- Changelog, roughly every two weeks: viewer/commenter roles (09-23), charts from chat (09-09),
  prompt guidance (08-26), citation filters (08-12), concept visuals from chat (07-29).
- Its "open access" copies include ResearchGate uploads (a link seen in the gap-analysis document),
  and the gap analysis cited 39 papers without adding any to the student's library.

## 16. Speed

Not compared fairly yet: our local page is the unminified development build. Needs the same
measurement against our production site.

## 17. Peer Review (run once on the 3,430-word gap analysis)

- Runs as an agent with a "0/12 sections" counter and named steps ticked off ("Analyzing
  Manuscript Claims", "Assessing Sentinel-2 Potential", "Validating SOC Data"…), including **its own
  database searches** (expandable queries such as "Pichavaram mangrove restoration soil…").
- 1 min 35 s. A "review completed" toast; a download button.
- Result: scores — Soundness 2/4, Presentation 3/4, Contribution 3/4, **overall 7/10**; a summary
  ("major revisions are needed…"); Weaknesses (5), Strengths (4), **Questions for the authors (4)**.
  The weaknesses were substantive: optical Sentinel-2 sees only the top ~5 cm of soil, which
  contradicts the deep-carbon emphasis; regional Indian Sundarbans evidence (found by its own search)
  challenges the global "75% plateau"; the title wrongly suggests primary fieldwork.
- **24 comments anchored to sentences** (7 Major, 17 Minor) from "Jenni AI", each with thumbs and
  resolve; clicking one scrolls to the highlighted sentence and expands it with citations; the list
  sorts and filters.
- Ours: the chapter build's examiner review and the viva questions do parts of this, but only inside
  a chapter build; there is no one-button review of any text with scores, anchored comments and
  questions.

## 18. AI Edit (one run: "Add a counter argument")

- ~4 s. The result appears as a **preview card under the selection**, not in the text: "Thought for 4
  seconds", "See edits" (a comparison), "What changed and why", thumbs, a follow-up prompt box with
  Web/Library switches, and four choices — **Replace selection, Insert below, Try again, Discard**.
- The counter-argument (open drying is cheap and accessible to small fishers) came with **no
  citation**.

## 19. Smaller surfaces

- **Find citations** on a selected sentence: results in under 6 s with the matching passage; on
  topic but not local (Lake Victoria, Bangladesh). **Bug:** closing it leaves a stray "@" in the
  text (the source of the "spoilage@" seen earlier; both removed).
- **Share** on the free plan: no invite-by-email field at all — only Restricted / Anyone with the
  link. Roles appear to be paid (the docs do not say so).
- **Chat** is remembered per document (reopening the document restored its conversation); "All
  Chats" lists them with search, titled by the first question.
- **Saved prompts**: an empty state "Create your first saved prompt" with one button.
- **Library details drawer**: Ask AI, Edit, previous/next arrows, cited-by, impact factor, volume and
  issue, accessed date, the PDF file (open, delete), collections, DOI and URL with copy, abstract.
- **After a workflow**: "How was this document?" thumbs prompt, shown again later in the document.

## What stands out, without concluding

- **Jenni removes decisions.** One place to land, one prompt, defaults on every setting, everything
  in panels beside the text. Ours asks the student to choose where to go far more often.
- **Jenni shows progress.** Skeletons, "Thinking", "Analyzing", a meter that reacts per keystroke.
  Ours shows "Searching…" for 80 s, or nothing at all.
- **Ours has more substance where it appears** — the proposal, the themed gap map, grounding enforced
  in code, the supervisor cycle — but a new student has to get through more steps to reach it, and in
  today's run never reached a first cited sentence without leaving the editor.
- **Jenni is weaker** on a blank chat, on sentences it cites from papers the student never added, and
  on a free plan that hides references and drops the bibliography from exports.

Not observed: Jenni's emails (sent to the owner's inbox), an empty-library state (its library is
per account and already holds a paper), and review results on a long document.
