# Everything found, kept for the build-and-fix phase

The owner's instruction (2026-10-04): study Jenni from every angle first — user flow, task flow,
UI/UX, ease for the end user — and build and fix everything **at the end**, in one go. This file
collects every finding so nothing is lost before then. Evidence for each is in
`docs/JENNI-UX-STUDY.md` (journeys), `docs/JENNI-FINDINGS.md` (features and stack) and
`docs/JENNI-COMPARISON.md` (test sheet). Not ranked; no decision is taken here.

## A. Faults in ours, seen on screen

1. A suggestion asked for with nothing to cite (Ctrl+/ or Suggest) does nothing visible — no message.
2. The proposal's related-work search sends the student's whole message (plus their answer "2") to
   OpenAlex as one search and finds 0; the key words find 465. A failed search is also shown as
   "0 found".
3. The drafted gap statement says "Related work found addresses…" when 0 were found.
4. The topic path offers "See the sources found in your paper".
5. The editor breadcrumb shows "Theses / /" when the title is long.
6. The toolbar's "Chart" and "Diagram" labels overlap.
7. The editor banner still says "press Ctrl+/" though suggestions now come on a pause; on a phone
   it speaks of keys the phone does not have.
8. The editor's Sources tab says "No papers yet" while the Sources page shows 5 (automatic sources
   added them; the open panel does not refresh).
9. The Sources page shows students our internal words: "one Strong call and one Fast call".
10. Discover takes ~80 s with only "Searching…" — no stages, no estimate.
11. A server failure shows the raw words "Failed to fetch".
12. On a phone, two banners and a two-row toolbar fill most of the screen before the text.
13. A suggestion is announced to screen readers only as "suggestion available" (not its text, not
    how to accept).
14. The proposal's question offers numbered options the student must type instead of tap.
15. A new topic-path thesis lands on Chapter 1 only, under two banners, with no outline and no
    first suggestion.
16. Each thesis card carries ten links; "Write" is ninth; a returning student does not land back
    where they were writing.
17. Checks are spread over seven places (Flags, Review, coherence, proofreading, citation report,
    originality, Submit).
18. Springer Nature open-access papers outside PubMed Central stay abstract-only (key needed,
    `docs/PENDING.md`).
19. Our Word export writes citations as plain text, not Word citation fields.
20. Chat answers only from the library; no search beyond it.
21. Autocomplete reads the chapter scope note, not a note for the section under the cursor.
22. Equations: one LaTeX line with "E = mc^2" as the only hint — no examples, no "describe it in
    words", no picture of an equation. (The original complaint was formulas students could not
    understand.)
23. The public home page shows a stock photo where Jenni shows its product working; the navigation
    wraps at ~800 px; a signed-in student opening the site lands on the sales page.
24. No AI-declaration block a student can insert into the text (our AI-usage report lives only in
    the export).
25. No one-button review of any text that returns scores, weaknesses, strengths, questions and
    sentence-anchored comments with severity (ours lives inside the chapter build and viva).
26. Our selection commands write straight into a draft block; Jenni's AI Edit shows a preview with
    "what changed and why", a comparison, and Replace / Insert below / Try again / Discard.

## B. What Jenni does that makes it easy (observed, not yet decided)

- Lands a returning student in the last document; the document list is a side panel.
- "+" makes the document at once; the empty page is the start screen.
- A prompt meter that turns from "Weak" to "Great" as the student types (no AI call); example
  prompts typed into the placeholder.
- Citation settings on one screen of chips with defaults (style, web/library, year, impact factor,
  cited-by, preprints).
- Earlier answers fold into bubbles with "Edit".
- Lands with every heading and per-section notes written from the prompt, cursor in the first
  section, a cited suggestion within ~15 s.
- Hover a citation in a suggestion → evidence card (cited-by, impact factor, open access, quoted
  passage, Open quote) before accepting.
- Refine presets on a suggestion (validate evidence, cite from my library, simplify, novelty…) and
  arrows through earlier suggestions.
- Find papers as a panel beside the text, ~3 s, Cite straight from a result.
- One Review panel: five checks, one button each, results as tracked changes.
- Chat scope chips (Web / Library / Current document) with Off / Ask / On; asks before searching
  the web.
- Selection menu: Find citations, AI Chat, AI Edit (17 actions), Comment, Review.
- Research gap analysis by **claim** (well-supported / contested / under-explored, supporting and
  contrasting citations, a suggested direction), with named stages, a clock, "safe to close, we will
  email you", and a "Limits of this retrieval" note.
- Usage bars per allowance in the account menu; a failed run is not charged.
- Settings in one dialog: 16 interface languages (Hindi, British English), seven themes including
  high contrast, Zotero/Mendeley connections, document defaults.
- Help: live chat, 11 video tutorials, docs, changelog, Discord.
- Word export with native citation fields or hyperlinks; LaTeX with four layouts.
- Style picker: search 10,000+ styles, locale, page numbers, live preview.
- Inline comment box under the selection.
- "/" insert menu: table, image, equation, chart, table of contents, AI Declaration, placeholder
  citation.
- Equation by LaTeX, by plain-English description, or from a picture, with examples.
- A live, animated product demo on the home page.
- Document cloning; read-only links; viewer/commenter/editor roles.
- Review mode with Y/N keys and Accept all.
- "How was this document?" thumbs after a workflow.
- Peer Review as an agent: its own searches, scores (soundness, presentation, contribution, /10),
  weaknesses, strengths, questions for the authors, 24 anchored comments tagged Major/Minor.
- AI Edit preview with explanation and four outcomes.
- Library details drawer with step-through arrows and Ask AI.
- Suggestions read aloud to screen readers with how to accept.

## C. Where Jenni is weak (keep ours better here)

- A new chat is blank, with no examples.
- Cites papers the student never added; its own review then flags them.
- Repeats a citation back to back in generated text.
- Closing "Find citations" leaves a stray "@" in the student's text.
- AI Edit's counter-argument came without a citation.
- Inviting collaborators by email is not available on the free plan.
- Free plan hides references and drops the bibliography from exports (though the list is in the
  page).
- A failed workflow leaves no trace and no retry; generic "Organizing my thoughts" step lines.
- Gap analysis took 9 min 54 s against a promised 3–6.
- Sharing has Editor/Commenter/Viewer roles and live co-editing (corrected 2026-10-04 from the
  docs), but no supervisor or committee workflow, no university templates or compliance checks, no
  viva preparation, no Indian-rupee plan at our price.
- Billing is its most-complained-about area (renewals, cancel only on desktop, no refunds).
- Its open-access copies include ResearchGate uploads — a licensing grey area we should not copy.
