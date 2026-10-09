# Jenni capability coverage map (2026-10-04)

Research only; nothing was changed. Jenni behaviour is from `docs/JENNI-FINDINGS.md`,
`docs/JENNI-UX-STUDY.md` and `docs/JENNI-FIX-LIST.md`. "Ours" was confirmed by reading the code;
every row names the file(s). Paths are relative to the repo root. `web/` = `apps/web/src/`,
`api/` = `apps/api/src/modules/`, `ui/` = `packages/ui/src/editor/`.

Status: **MATCH** (a student gets the same outcome), **PARTIAL** (exists, but the student meets a
real difference), **MISSING** (no equivalent), **OURS BETTER**.

**Updated after Round 2 (2026-10-08):** 101 rows — **76 MATCH, 8 PARTIAL, 2 MISSING,
15 OURS BETTER.** Every PARTIAL and MISSING row was re-audited one by one against the code on
`main` after Round 2 of `docs/JENNI-BUILD-PLAN.md` (R1–R41, ADRs 0088–0127, released as
v0.1.32), and every MATCH row that Round 2 touched carries a dated note naming the ADR. Two
corrections: row 14 (Refine presets) was marked MATCH on 2026-10-04 with five presets when Jenni
has seven — the rest were built on 2026-10-07 (ADR-0089); row 55 (peer review) is **PARTIAL**, not
MATCH — ours gives anchored Major / Minor points but no ratings, strengths or questions, and the
score card built for it was withheld after evaluation (ADR-0111). None of the nine rows open
before Round 2 closed: seven are the owner's (36 Zotero/Mendeley sync, 38 pre-indexed full text
and the Springer key, 80 co-editing's nginx block and flag, 89 more interface languages, 94 live
chat, 95 videos, 98 a community) and two are deliberate (45 a chat across theses, 49 no
paraphrase under §12.3), with the exact remaining difference written in each row's note. The
previous count in this header (65 / 18 / 3 / 15, written 2026-10-04) had already drifted from the
table, which stood at 77 / 7 / 2 / 15 before this audit.

**Updated after the build (2026-10-04, evening):** 101 rows — 65 MATCH, 18 PARTIAL, 3 MISSING,
15 OURS BETTER (from 16 / 47 / 24 / 14). Rows marked "Built 2026-10-04" were rechecked against
the merged code. The nine still missing wait on the owner (docs/PENDING.md, "Jenni study — what
only the owner can decide"); PARTIAL rows were not re-audited one by one.

## 1. Starting and landing

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 1 | Return lands in last document | Opens the last document, cursor where it was; document list is a side panel | `web/app/app/page.tsx` (dashboard, cards with ten links) | MATCH | Built 2026-10-04: Continue writing opens the last chapter. 2026-10-08 (ADR-0127): the theses are also a side panel at the top of the chapter rail, so a thesis is switched without leaving the editor |
| 2 | One-click new document | "+" creates Untitled at once; the empty page is the start screen | `web/app/app/page.tsx`, `web/app/app/new/page.tsx` ("Start writing now"), `web/components/AddProposalPrompt.tsx` | MATCH | Built 2026-10-04 (ADR-0062): "Start writing now" makes the thesis ("Untitled thesis" if no title) and opens its first chapter; "Add a proposal" offered on the list and in the editor. 2026-10-08 (ADR-0127): one New ▾ menu (a thesis, Start writing now, import from Word, upload to the library); a chat with no thesis is not offered, see row 45 |
| 3 | Prompt-first start with strength meter | One prompt box, typed example placeholders, Weak→Great meter per keystroke (no AI) | `web/components/proposal/PathAChat.tsx`, `web/app/app/d/[id]/proposal/page.tsx` | MATCH | Built 2026-10-04: Topic meter, rotating examples, answer options as buttons |
| 4 | Citation preference screen at start | One screen of chips: style, web/library, year, impact factor, cited-by, preprints | `web/components/onboarding/StartSetup.tsx`, `Document.meta.sourcePrefs`, `find-sources` filters (ADR-0087) | MATCH | Corrected 2026-10-07: was marked MATCH with only a style choice. Built: style, web/library search, year, **indexing** (in place of impact factor and cited-by, by the owner), preprints, applied to the papers found. 2026-10-08 (ADR-0093): the same settings can be changed from the editor's Sources tab |
| 5 | Heading modes (IMRaD / AI headings / none) | Picker before writing | `StartSetup.tsx` structure step; `documents.controller.ts` `structure` (ADR-0087) | MATCH | Corrected 2026-10-07: there was no picker. Built: Smart headings / Standard thesis chapters / No headings, and the sections as headings in the page |
| 6 | Land in full document with notes, cursor ready, first cited sentence in ~15 s | Every heading + per-section notes from the prompt; suggestion appears by itself | `web/app/app/d/[id]/outline/page.tsx`, `web/components/editor/ScaffoldPanel.tsx` | MATCH | 2026-10-05: ADR-0070 lands in the editor in ~2 s with chapters planned from the title; ADR-0078 offers a cited first sentence before typing (31 s on a new thesis while papers are read, 3–10 s after). 2026-10-08 (ADR-0091, ADR-0092): Start writing now asks up to three questions with suggested answers (Use this / Skip), and the opening sentence comes reliably. Still open: ≤ 20 s to the first cited sentence (the outline call alone is 21–24 s; plan R5) |
| 7 | Import from Word to start | "Import from Word (.docx)" puts the text in the document | `api/sources/upload-rules.ts`, `apps/worker/src/jobs/extract-paper.ts` (seed paper → proposal/outline only) | MATCH | Built 2026-10-04: Import from Word into chapters (split at Heading 1). 2026-10-08 (ADR-0113): the import says why typed citations were not linked |
| 8 | Earlier answers fold into bubbles with Edit | Yes | `web/components/proposal/PathAChat.tsx` | MATCH | Built 2026-10-04: Edit on an earlier answer; the four-turn bound holds |

## 2. Section prompts

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 9 | Per-section notes panel | Document prompt + bullet notes per heading, editable | `web/components/editor/ScaffoldPanel.tsx` (chapter scope note + sub-heading notes, shown not inserted); edited on the outline page | MATCH | Built 2026-10-04: Assist reads the sub-section note under the cursor (A21). 2026-10-08 (ADR-0097): the Sections panel in the rail — each heading's note is edited or added in place, with Draft; a heading typed in the page becomes a section |
| 10 | Configure context per section | Switch sources off or pin chosen sources per heading | `web/components/editor/SourcePins.tsx`, `api/chapters/chapters.controller.ts` (`chapters/:id/pins`) | MATCH | 2026-10-05 (ADR-0085): pins per section — under a heading the Sources tab sets pins for that section alone, which suggestions and drafts there use instead of the chapter's. The literature search stays one switch (Settings). 2026-10-08 (ADR-0093): web/library, year, indexing and preprints can be changed inside the editor |
| 11 | Generate for a section | ~5 s, one sentence as a suggestion | `web/components/editor/DraftMode.tsx`, `api/assist/draft.controller.ts` (Ctrl+Shift+D drafts a whole section as a pending draft block) | OURS BETTER | Ours drafts the section, grounded, behind accept/discard |

## 3. Autocomplete

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 12 | Ghost text on a pause | < 3 s | `ui/ghost-text.ts`, `api/assist/assist.controller.ts` (ADR-0053 pause trigger, ADR-0051 model) | MATCH | 2.7–3.4 s vs 1.9–2.8 s first word. 2026-10-08 (ADR-0088): also in the middle of a sentence after a longer pause, at a word boundary |
| 13 | Visible Accept / Refine / thumbs on a suggestion | Buttons under the ghost text | `ui/ghost-text.ts` (keys only), Suggest button in `web/components/editor/ThesisEditor.tsx` | MATCH | Built 2026-10-04: Suggestion bar: Accept, One word, Refine, Dismiss, thumbs — works on a phone. 2026-10-08 (ADR-0088, R2): Accept asks for the next suggestion at once |
| 14 | Refine presets | Stay on topic, complete paragraph, novelty, simplify, no citations, Validate supporting evidence, Cite from my library | `web/components/editor/GuidedInput.tsx` (Shift+→ free-text instruction) | MATCH | Built 2026-10-04: Five presets on the suggestion bar. Corrected 2026-10-07: the five presets of 2026-10-04 were not Jenni's seven — Validate supporting evidence, Cite from my library, Increase novelty, Simplify language and Re-write without citations had never been added. Built 2026-10-07 (ADR-0089): all of them, grouped as Jenni groups them; Cite from my library says so when nothing fits |
| 15 | Suggestion history / Shift+→ cycle | Arrows step through earlier suggestions | none (Shift+→ is the guided prompt here) | MATCH | Built 2026-10-04: ‹ › on the suggestion bar |
| 16 | Alt+→ accept one word | Yes | `ui/ghost-text.ts` (`Alt-ArrowRight`) | MATCH | — |
| 17 | Ctrl+/ suggest on demand | Yes | `ui/ghost-text.ts`, `ThesisEditor.tsx` | MATCH | Built 2026-10-04: The empty-library notice with a Find papers button |
| 18 | Cited suggestion with an empty library | Cites papers from its own index instantly | `apps/worker/src/jobs/find-sources.ts` (ADR-0037 auto sources), `api/assist/assist.service.ts` (`findingSources`) | MATCH | 2026-10-05: ADR-0070 indexes abstracts first; the first cited suggestion comes in ~14 s on a new thesis. Ours cites only papers in the library, which is the point |
| 19 | Grounding enforced on suggestions | Not enforced; its own review flags its weak citations | `packages/ai/src/builder/postprocess.ts`, `api/assist/assist.service.ts` (`HALLUCINATED_CITE` stripped) | OURS BETTER | — |
| 20 | Ctrl+↑/↓ move block | Yes | none found | MATCH | Built 2026-10-04: Ctrl+Shift+↑/↓. 2026-10-08 (ADR-0094): also a grip beside each block, dragged with the mouse |

## 4. Citations and styles

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 21 | Citation hover card | Title, authors, journal, year, cited-by, impact factor, OA badge, quoted passage, Open quote | `ui/citation.ts` (popover: record, DOI link, full-text/abstract depth, passage, "Open PDF at page N"), `api/sources/sources.controller.ts` (`sources/:id/chunks/:chunkId`) | MATCH | Built 2026-10-04: Cited-by, open-access and citedness badges on the card. 2026-10-08 (ADR-0108): Read beside opens at the cited passage, marked |
| 22 | Evidence card before accepting a suggestion | Hover a citation inside the ghost text | `ui/ghost-text.ts` (label text only) | MATCH | Built 2026-10-04: Evidence chips and card on the suggestion bar, with badges |
| 23 | Select → Find citations (search panel: All/Discover/Library, sort, filter, passage, Cite/Save) | ~4 s | `web/components/editor/CiteSuggestions.tsx` (on sentence end, library passages, direct/partial), `web/components/editor/CitePicker.tsx` | MATCH | 2026-10-05: the Papers tab shows the matching passage of each result with the question's words marked, sort, open-access, Add and Cite here. 2026-10-08 (ADR-0104): Cite in my chapter from the library's details drawer too |
| 24 | `@` cite | Yes | `web/components/editor/CitePicker.tsx`, `api/chapters/citations.controller.ts` (`citations/pick`) | MATCH | — |
| 25 | Style search across 10,000+ | Search, five popular first | `web/components/editor/StyleSearch.tsx`, `packages/citations/src/catalog.ts`, `api/chapters/citation-styles.controller.ts` | MATCH | Also note styles as footnotes (ADR-0029) |
| 26 | Style locale, page numbers toggle, live preview | Per style | `packages/citations/src/render.ts` (locale from style only) | MATCH | 2026-10-04: Citation language (Automatic, UK/US English, German, French, Spanish, Dutch) and a live preview of the style (ADR-0065) |
| 27 | Automatic reference list | At document end; locked on free plan | `web/components/editor/CitationList.tsx`, `packages/export/src/thesis.ts` | OURS BETTER | Never paywalled |
| 28 | Placeholder citation | "/" inserts a placeholder | needs-source notes in draft blocks (`DraftMode.tsx`, `web/app/editor.css` `.needs-source-note`) | MATCH | Built 2026-10-04: Citation-needed placeholder in the “/” menu |

## 5. Finding papers and the library

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 29 | Find papers panel beside the text | ~3 s, suggested query, sort, filter, passage, Cite / Save / Open quote | `ChatPanel.tsx` scope "Find papers" → `api/assist/chat.controller.ts` (`chat/web`) with year/citations/citedness/preprint filters and Add to library | MATCH | Built 2026-10-04: Papers tab beside the text: sort, open-access filter, Add, Cite here. 2026-10-08 (ADR-0104): library filters by year, access and kind; a details drawer that steps ↑ ↓, with Ask AI |
| 30 | Deep discovery / gap map | (gap-analysis workflow, see 63) | `web/app/app/d/[id]/sources/DiscoverPanel.tsx`, `apps/worker/src/jobs/search-literature.ts` (themes, gap class, OpenAlex density trend, snowballing ADR-0052) | OURS BETTER | But ~80 s with only "Searching…", on a separate page |
| 31 | Library collections | Folders | none | MATCH | Built 2026-10-04: Collections strip, bulk add/remove. 2026-10-08 (ADR-0105): Add into a collection, or a new one, while adding (files, Zotero, PDFs, IDs); papers added from Discover or the editor are still filed afterwards |
| 32 | Impact factor / cited-by on library items | On each item | `web/app/app/d/[id]/journals/JournalsScreen.tsx` (journal citedness), `DiscoverPanel.tsx` (citationCount on candidates) | MATCH | Built 2026-10-04: Badges on library rows |
| 33 | PDF upload | 10 PDFs, 25 MB | `api/sources/sources.controller.ts` (`sources/upload`), `SourcesScreen.tsx` | MATCH | 2026-10-08 (ADR-0107): an uploaded PDF names itself from its first page (printed DOI, title, authors with initials, year, abstract). (ADR-0101): Fetch PDF for papers without full text |
| 34 | PDF reader: search, side-by-side, open at quote | In-app | `web/app/app/d/[id]/sources/[sourceId]/PaperReader.tsx`, `web/components/reader/` (pdf.js), `api/sources/sources.controller.ts` (`file/content`, `text`), `web/components/editor/ReadBesidePane.tsx` | MATCH | Built 2026-10-05 (ADR-0068): every paper opens in an in-app reader — PDF drawn with pdf.js (works in production; nothing framed) or the text we hold; Ctrl+F with "x of y"; opens at the cited page with the passage marked; select → Copy with citation / Cite in my chapter / Ask chat; Read beside uses the same view. Not built: saving highlights or notes on a paper. 2026-10-08 (ADR-0100): Explain selection — a box drawn on the page goes to chat as a picture, with questions about that paper. 2026-10-09 (ADR-0130): highlights in four colours and notes on them, saved per paper and per student, drawn again when the paper reopens (PDF and Text view), listed in "Highlights and notes" with jump, recolour, note, delete, and Put in chat / Put note in chapter only on the student's press |
| 35 | .bib / .ris / ID import | Yes | `api/sources/sources.controller.ts` (`sources/import`, `sources/resolve`), `packages/retrieval/src/scholarly/bibliography.ts` | MATCH | Plus library export (`sources/export`, `packages/citations/src/library-export.ts`). 2026-10-08 (ADR-0103): Paste an ID — DOI, arXiv, PubMed, ISBN — with a preview before Add |
| 36 | Zotero / Mendeley account connection | OAuth import | `SourcesScreen.tsx` "From Zotero" (`ZoteroImport.tsx`), `packages/retrieval/src/scholarly/zotero.ts`, `POST /documents/:id/sources/zotero/{collections,import}` | PARTIAL | Built 2026-10-04 (ADR-0062): Zotero by pasted read-only key, whole library or one collection, up to 500 items, read once, key never stored. Not a live sync (by decision, ADR-0059). Mendeley still file-only (needs an Elsevier app, `docs/PENDING.md`); no live Zotero call made yet. 2026-10-08: unchanged by Round 2 (Paste an ID, ADR-0103, and Add into a collection, ADR-0105, do not touch it). The difference that stays: no account connection or sync for Zotero or Mendeley; Mendeley by .bib/.ris file only. The owner's — PRD FR-2.9 says file upload, not OAuth, and Mendeley needs an app registered with Elsevier (docs/PENDING.md) |
| 37 | Browser extension | Chrome extension | `apps/extension` (ADR-0031) | MATCH | 2026-10-08 (ADR-0125): add-on 0.3.0 puts Add buttons into the page on Google Scholar, PubMed, arXiv and MDPI; not yet submitted to the store (the owner, after 0.2.1 is approved) |
| 38 | Full-text index across papers | Pre-indexed open-access full text, instant | per-student fetch: `apps/worker/src/jobs/index-source.ts`, Europe PMC (ADR-0054), CORE fallback | PARTIAL | Minutes per paper; Springer outside PMC stays abstract-only (key pending). 2026-10-08 (ADR-0101): Fetch PDF re-runs the open-copy search (arXiv, Unpaywall, CORE, Europe PMC) on demand and says why when nothing was found. The difference that stays: fetched per student, minutes a paper, nothing pre-indexed; Springer open access outside PMC waits on the owner's API key |

## 6. AI Chat

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 39 | Scopes Web / Library / Current document | Chips, combinable | `ChatPanel.tsx` (Library / This thesis / Find papers; ADR-0016); since 2026-10-04 (ADR-0060) a library question the library has nothing on is answered from the abstracts a scholarly search returns, through the same A.4 prompt, each cited paper marked "Not in your library" with Add | MATCH | 2026-10-05 (ADR-0081): "On" searches on every library question and the answer combines the library and the literature; "Ask first" searches a thin library (ADR-0074); "Off" never |
| 40 | Off / Ask / On permission per source | Asks before searching the web | Settings → "Search beyond my library": Off / Ask first (default) / On (ADR-0060, `beyond-library.ts`) | MATCH | Built 2026-10-04. One setting for the search, not one per source. 2026-10-08 (ADR-0116): asked in the conversation as Allow this time / Always allow / Skip |
| 41 | Agentic answer with visible steps | Plans, searches several times, verifies (~90 s) | "Research deeply" (ADR-0080, 2026-10-05): A.4.1 plans 3–5 parts, the library and every index searched once per part, A.4.2 answers part by part from up to 28 passages, every step shown; `api/assist/chat.service.ts` `askDeep`. Ordinary chat still searches when the library is thin (ADR-0074) | MATCH | Real-model proof: 35 s, 60 abstracts read, 12 kept, 648 words, 13 citations. Library passages are full text; found papers are abstracts. Own allowance (1 trial / 3 paid) |
| 42 | Attachments and images in chat | Attach file/image | none | MATCH | 2026-10-05 (ADR-0083): a paperclip under the chat box takes up to three files — a picture (sent to the model as an image), a PDF, Word or text file (read as one more passage, cited by name). Read for that question only; nothing joins the library |
| 43 | Saved prompts | Yes | `web/components/editor/ChatPrompts.tsx`, `api/prompts/prompts.controller.ts` (`/` in chat) | MATCH | — |
| 44 | Name a paper in chat | — | `web/components/editor/ChatMentions.tsx` (`@`) | OURS BETTER | — |
| 45 | Chat history across documents | One account-wide chat | `api/assist/chat.controller.ts` (`chat/:documentId`, `clear`) | PARTIAL | 2026-10-04: Deliberate: chat is per thesis because it answers from that thesis's own library. 2026-10-08 (ADR-0116): any number of chats per thesis (threads titled by the first question, the last 60 turns kept) and a chat on one collection. Still per thesis: a thread that follows the student across theses, and a chat with no thesis, were left undone on purpose — every chat is grounded in one thesis's library (§10.6) and the usage row, memory block and attachments are keyed to it (ADR-0116 and ADR-0127, "Not done"). A design decision, not a code gap |
| 46 | Add answer to document | Copy / Add to document | `ChatPanel.tsx` "Add to document" (citations become nodes) | MATCH | Built 2026-10-04: Copy on a chat answer |
| 47 | Empty chat guidance | Blank | `ChatPanel.tsx` (scope blurb, placeholder per scope) | OURS BETTER | — |
| 48 | Off-topic refusal | — | `RELEVANCE_FLOOR` in `packages/retrieval`, refund | OURS BETTER | — |

## 7. AI Edit and the selection menu

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 49 | AI Edit actions (17) | Fluency, paraphrase, simplify, strengthen, counter-argument, tense, lists, prose, table, translate, academic, formality, precision, hedge/increase confidence | `web/components/editor/CommandToolbar.tsx` (Expand, Formalise, Simplify, Shorten, Check consistency), `api/assist/chat.controller.ts` (`commands/run`, `citations/role`) | PARTIAL | 2026-10-05 (ADR-0081): 13 — translate (into the thesis language) and as-a-table added to ADR-0066's eleven; no fluency/paraphrase (§12.3) or list-to-prose. 2026-10-08 (ADR-0095): 22 actions in one panel (Ctrl+J) in Jenni's three groups — fix the flow, transitions, remove repetition, strengthen, counter-argument, expand, shorten, formalise, simplify, technical precision, increase confidence, hedge, consistency, active voice, past / present / future tense, bulleted, numbered, prose, table, translate — with a free instruction box, Use my library, What changed and why, and a follow-up box. The difference that stays, by decision: no Paraphrase with tones (§12.3; a detector-evasion instruction is refused in code). 2026-10-09 (ADR-0133): the web switch, as "Search the literature" — the papers found are added to the library first, so the edit cites only library papers |
| 50 | Selection → Find citations | Yes | CiteSuggestions fires on sentence end only | MATCH | 2026-10-04: Find papers on a selected sentence opens the Papers tab searching it |
| 51 | Selection → AI Chat | Yes | none | MATCH | Built 2026-10-04: Ask chat on a selection |
| 52 | Selection → Comment (by the writer) | Inline box under the text | comments created only by the guide (`web/app/guide/[token]/page.tsx`, `api/feedback/feedback.controller.ts`) | MATCH | Built 2026-10-04: Comment on a selection. 2026-10-08 (ADR-0109): replies under a comment |
| 53 | Selection → Review | Yes | none (checks run per chapter) | MATCH | 2026-10-05: "Examiner review" on a selection — one section command, flags on its sentences (ADR-0067). 2026-10-08 (ADR-0126): proofread, tone and examiner on one paragraph from the block handle |

## 8. Reviews

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 54 | Claim confidence | Agent searches databases, flags unsupported claims and weak citations, 22 s | `api/coherence/coherence.service.ts` (UNSUPPORTED_CLAIM, CITATION_SUPPORT ADR-0023), `web/components/editor/FlagsPanel.tsx` | MATCH | 2026-10-05 (ADR-0081): an unsupported or unsupported-by-its-source claim has "Find a source", which searches the indexes for the sentence; Add and Cite from there |
| 55 | Peer review (ratings, strengths, weaknesses, questions) | One button | examiner review inside chapter build only (`api/chapter-build/chapter-build.service.ts`); viva questions (`api/viva/viva.service.ts`) | PARTIAL | Built 2026-10-04: Examiner review of a chapter (ADR-0056). Re-audited 2026-10-08: the 2026-10-04 MATCH was too generous. Ours gives the weaknesses — examiner points anchored in the text, tagged Major / Minor (ADR-0111) — but no ratings (the score card was built and evaluated in four rounds and is not shown, because it did not track presentation or contribution; ADR-0111), no strengths, and no questions for the author (the viva module asks questions, as its own allowance). `packages/ai/prompts/examiner.md` has no strengths or questions field. 2026-10-09: strengths and questions for the author built and evaluated (ADR-0131, `examiner_review.md`), not shown — round 2 failed one of 45 checks; still PARTIAL |
| 56 | Source quality | Card | `web/components/editor/ReferenceHealth.tsx` (retracted, stale, duplicate, unverifiable), `web/app/app/d/[id]/citations/CitationReport.tsx` | OURS BETTER | 2026-10-08 (ADR-0112): a publication-year chart and the venue spread over the chapter's citations |
| 57 | Tone of voice (can take a library PDF as model) | Card | `web/components/onboarding/WritingProfile.tsx`, `api/memory/style.service.ts` (profile steers suggestions) | MATCH | 2026-10-05 (ADR-0084): a tone review on the Flags tab reads a chapter against the student's own writing profile or a chosen library paper and offers a rewrite per sentence that clearly differs; Accept / Dismiss / Accept all / Y / N, one command unit a run |
| 58 | Proofread | British spelling | `web/components/editor/ProofreadPanel.tsx`, `api/assist/chat.controller.ts` (`proofread`, `correctionSize` guard) | MATCH | 2026-10-08 (ADR-0110): corrections shown as tracked changes in the text |
| 59 | Results as tracked changes, Y/N keys, Accept all | Review mode | per-item diff + Apply (`ProofreadPanel.tsx`, `CommandToolbar.tsx`); j/k/a keys for supervisor comments (`web/app/app/d/[id]/review/ReviewQueue.tsx`) | MATCH | 2026-10-05 (ADR-0081): Y / N keys and Resolve all / Ignore all on the Flags tab too. 2026-10-08 (ADR-0110): review mode in the text — struck and new words beside the sentence, Y / N, ↑ ↓, Accept all (one Undo), Reject all, Esc, Try next |
| 60 | One Review panel | Five cards, one button each | Flags tab, Review tab, coherence, proofreading, `/citations`, `/originality`, `/submit` | MATCH | Built 2026-10-04: Every check in one list on the flags tab |
| 61 | Paraphrase-closeness check | — | `web/components/editor/ParaphrasePanel.tsx`, `api/chapters/chapters.controller.ts` (`paraphrase`), `/originality` | OURS BETTER | — |

## 9. Workflows

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 62 | Literature review workflow | Topic → filters → 4 stages, 15–20 min, per-section expert brief (failed in test) | `web/app/app/d/[id]/build/page.tsx`, `api/chapter-build/chapter-build.service.ts`, `apps/worker/src/jobs/chapter-build.ts`, `packages/ai/src/checks/` | OURS BETTER | Ours checks and delivers pending blocks with a QA report; lacks Jenni's topic-specific brief per section. 2026-10-08 (ADR-0124): a whole literature review from one press — themes planned for nothing from the outline and the gap map, every section a pending draft, the QA report, the email — built behind an off flag at a cap of 0 until the owner prices it (₹12.92 a build) |
| 63 | Research gap analysis by claims | 15 claims: under-explored / contested / well-supported, supporting + contrasting citations, direction, "Limits" note | `DiscoverPanel.tsx` (themes by counts, ADR-0041/0046) | MATCH | 2026-10-05 (ADR-0086): the claims map on the Discover tab — up to 15 claims from the library's papers, each under-explored / contested / well-supported with supporting and contrasting papers, a direction and the limits; one strong pass an hour, logged as CROSS_PAPER; beside the count-based gap map. 2026-10-08 (ADR-0123): Open as a document — the claims map becomes an editable chapter of pending drafts, every claim cited |
| 64 | Run in background with stages, clock, "we will email you" | Yes | chapter build in worker (stages on build screen); Discover shows stages and a clock; since 2026-10-04 (ADR-0058) one email when a search, build, examiner review or coherence check ends after a minute with no visible tab watching | MATCH | Email unverified against a real mailbox (`docs/PENDING.md`). 2026-10-08 (ADR-0124): the literature-review build emails by the same rule |
| 65 | "How was this document?" thumbs | After a workflow | `api/assist/assist.controller.ts` (`outcome` telemetry), Feedback box | MATCH | 2026-10-04: Thumbs on suggestions, chat answers and drafted sections. 2026-10-08 (ADR-0115): "How was this?" after a chapter build and a viva set, stored with the run |

## 10. Inserting things

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 66 | "/" insert menu | Text, headings, lists, table, image, equation, chart, TOC, AI declaration, placeholder, cite | toolbar `web/components/editor/FormatToolbar.tsx` | MATCH | Built 2026-10-04: “/” menu. 2026-10-08 (ADR-0094, ADR-0119): the + beside each block opens the menu; contents block, horizontal rule, text colour and highlight added |
| 67 | Table | Yes | `FormatToolbar.tsx` (+ merged cells, ADR-0029 era) | MATCH | — |
| 68 | Image | Yes | `FormatToolbar.tsx` figures, pasted screenshots, `api/chapters` `figures` | MATCH | — |
| 69 | Equation by LaTeX with examples | KaTeX with Quadratic / Maxwell / Piecewise | `ui/math.ts`, `FormatToolbar.tsx` (one LaTeX line, "E = mc^2") | MATCH | Built 2026-10-04: Examples and live preview in the equation field |
| 70 | Equation described in words | Yes | none | MATCH | 2026-10-04: Describe it in words in the equation field; KaTeX-checked LaTeX, read back, Apply to insert (ADR-0063) |
| 71 | Equation from a picture | Yes | none | MATCH | 2026-10-04: "Or take a photo of it" in the equation field; transcribed, KaTeX-checked, Apply to insert (ADR-0064) |
| 72 | Chart | From chat / insert | `web/components/editor/ChartDialog.tsx`, `packages/ui/src/charts/` (ADR-0027) | MATCH | — |
| 73 | Table of contents in the document | Insert | export only (`packages/export/src/thesis.ts`, real Word TOC) | MATCH | 2026-10-04: The open chapter's headings listed under it, live, each a jump. 2026-10-08 (ADR-0119): a contents block in the text — a live list of the headings — kept in every export |
| 74 | AI declaration block | Inserts a statement | `api/export/export.controller.ts` (`export/ai-usage-log`), `packages/export/src/ai-usage.ts` | MATCH | Built 2026-10-04: AI declaration block from the “/” menu |
| 75 | Footnotes, cross-references, diagrams | — | `ui/footnote.ts`, `ui/cross-ref.ts`, `web/components/editor/DiagramDialog.tsx` (ADR-0049) | OURS BETTER | — |
| 76 | Markdown / KaTeX help tabs | Yes | key hints strip in `ThesisEditor.tsx` | MATCH | Built 2026-10-04: Equation cheat sheet. 2026-10-08 (ADR-0118): a Keyboard shortcuts window with the keys and the Markdown the editor understands |

## 11. Collaboration and history

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 77 | Version history with preview and restore | Snapshots, author, Restore | `web/components/editor/VersionHistory.tsx`, `api/chapters/chapters.controller.ts` (`versions`, `restore`, Ctrl+S snapshot, undo banner) | MATCH | Ours adds undo of a restore |
| 78 | Roles editor / commenter / viewer | By invitation or link | `web/components/editor/ShareButton.tsx` (guide = read+comment, `canEdit` co-author), `api/feedback/feedback.controller.ts` | MATCH | Built 2026-10-04: Guide / co-author / reader roles (ADR-0057) |
| 79 | Link access ("anyone with the link") | Yes | none (deliberate: "no secret link") | MATCH | Built 2026-10-04: Read-only link, off by default (ADR-0057) |
| 80 | Live co-editing with named cursors | Yes | `web/lib/collab.ts`, `web/components/editor/CoAuthorEditor.tsx`, `api/collab` (ADR-0028) | PARTIAL | Off by default (flag), only for documents with a co-author; prod needs nginx `/collab/`. 2026-10-08: unchanged by Round 2. The code has been complete since ADR-0028; production needs the host nginx `/collab/` block and the `collaboration` flag on, and the owner said to leave it for now (docs/PENDING.md) |
| 81 | Document cloning | Yes | none in `api/documents/documents.controller.ts` | MATCH | Built 2026-10-04: Make a copy (ADR-0057). 2026-10-08 (ADR-0114): the copy is named "… (copy)"; archive and restore beside it |
| 82 | Read-only sharing | Yes | guide pages `web/app/guide/[token]/`, progress view (`guide/documents/:id/progress`) | MATCH | — |
| 83 | Comments | Inline box under selection | supervisor comments, `web/components/editor/ReviewPanel.tsx`, review queue, `.docx` comment import (`api/feedback/docx-import.service.ts`) | MATCH | Built 2026-10-04: The writer comments on a selection. 2026-10-08 (ADR-0109): replies, edit and delete your own, thumbs — in the review panel, the queue and the guide's page. Corrected: the inventory of 2026-10-07 said replies existed; they did not until ADR-0109 |

## 12. Export and import

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 84 | Word export with native citation fields or hyperlinks | Linked to Word's References | `packages/export/src/docx.ts`, `packages/export/src/thesis.ts` (citations as plain text) | MATCH | Built 2026-10-04: Live Word citation fields (ADR-0055). 2026-10-08 (ADR-0117): citations side by side become one field and one bracket |
| 85 | LaTeX with layouts | Four layouts + options | `packages/export/src/latex.ts` (one, spacing from the template) | OURS BETTER | 2026-10-04: Deliberate: the thesis LaTeX follows the university template (report class, its margins, fonts, numbering); a two-column paper layout does not apply to a thesis. 2026-10-08 (ADR-0121): one export dialog with presets — Thesis, Plain, Double-spaced, Two-column — and the options (paper, font, size, spacing, margins, title page, contents, page numbers, comments) with a live preview; two columns and page numbers reach the LaTeX project too. The Thesis preset still follows the university template |
| 86 | PDF / university template / compliance | — (no template) | `packages/export/src/compliance.ts`, `api/export/thesis-export.service.ts` (docx/pdf/latex/html), Gotenberg, `packages/export/src/word-math.ts` | OURS BETTER | — |
| 87 | Copy to clipboard | Copy button | browser copy only | MATCH | 2026-10-04: A copy reads citations as their labels in Word / Docs; pasting back restores them |
| 88 | Bibliography on free plan | Dropped from free exports | always included | OURS BETTER | — |

## 13. Settings, account, usage

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 89 | Interface languages (16 incl. Hindi) | Yes | `web/i18n/` (typed catalogues, English fallback; ADR-0061): English and Hindi (beta) on the student's main screens — list, new thesis, proposal, editor chrome, Settings, Account, sign-in; picker in Settings and on sign-in; separate from the document language (`api/documents/documents.controller.ts` `:id/language`) | PARTIAL | Built 2026-10-05: two languages, not sixteen; Hindi awaits a native speaker's review (`docs/i18n/hi-review.md`); editor side panels, help and admin stay English. 2026-10-08: unchanged — English and Hindi (beta). Round 2's new strings are English only (the limit message, ADR-0122) or the agent's own Hindi (ADR-0116); the native review and the next language are the owner's |
| 90 | Themes (7 incl. high contrast) | Yes | `web/components/theme.tsx` (light / dark / system) | MATCH | Built 2026-10-04: High contrast switch, works with light/dark. 2026-10-08 (ADR-0120): Paper light and Paper dark added — light, dark, system, paper light, paper dark, each with high contrast |
| 91 | Document defaults (autocomplete, style, font) | One dialog | `web/app/app/settings/page.tsx` (auto-suggest, auto-cite, auto-sources) | MATCH | 2026-10-04: Default citation style for new theses in Settings (font follows the university template). 2026-10-08 (ADR-0120): a font style for the thesis text (default / serif / sans-serif) |
| 92 | Usage bars per allowance | Account menu | `web/app/app/account/page.tsx` (bars), `api/usage/usage.controller.ts`, editor header meter | MATCH | Refund on relevance-floor refusal. 2026-10-08 (ADR-0099): a Usage menu with a bar per allowance, one click away on every screen; (ADR-0122) the limit message with the reset date wherever a cap refuses |
| 93 | Account delete / email change | Yes | `api/account/account.controller.ts` (delete with 7-day cancel, email move ADR-0015, password ADR-0033) | OURS BETTER | — |

## 14. Help, platform, accessibility

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 94 | Live chat support | Intercom | Feedback box, `web/app/contact/page.tsx` | MISSING | 2026-10-08: unchanged; who answers, and where, is the owner's (docs/PENDING.md) |
| 95 | Video tutorials | 11 by topic | `web/components/onboarding/HowSuggestionsWork.tsx` (one 90-second explainer) | PARTIAL | 2026-10-08: unchanged — the one explainer and the /help articles; videos are the owner's |
| 96 | Documentation | Full docs site | `FirstRunHint.tsx` hints only | MATCH | Built 2026-10-04: /help, nine articles |
| 97 | Changelog | Every ~2 weeks | none | MATCH | Built 2026-10-04: /changelog |
| 98 | Community (Discord) | Yes | none | MISSING | 2026-10-08: unchanged; the owner's |
| 99 | Mobile web | Compact bar, floating toolbar | drawers + bottom tab bar in `ThesisEditor.tsx` | MATCH | 2026-10-04: One dismissable banner; floating Suggest above the tab bar; key hints hidden on phones |
| 100 | Screen-reader announcement of suggestions | Reads text + "Press right arrow to accept" | `ui/ghost-text.ts` (`aria-label="suggestion available"`) | MATCH | Built 2026-10-04: The suggestion and how to accept it are announced |
| 101 | Live product demo on home page | Animated real editor | `web/components/marketing/ProductTour.tsx` (stepped tour), stock photo | MATCH | 2026-10-05: The hero card plays a scripted suggestion — typed, streamed with its citation, kept with Tab; still for reduced motion. Not released: owner sees it first |

## 15. What Thesis Copilot has that Jenni lacks

| Capability | Where |
|---|---|
| Supervisor / committee cycle: email-bound shares, comments on passages, scoped AI revisions, review queue (j/k/a), response-to-committee table, `.docx` comment import, live progress view | `api/feedback/`, `web/app/app/d/[id]/review/ReviewQueue.tsx`, `web/components/editor/ReviewPanel.tsx`, `packages/export/src/response-table.ts`, `web/app/guide/` |
| Ten compliance checks, override with reason, signed export artifact (ADR-0044) | `packages/export/src/compliance.ts`, `api/export/thesis-export.service.ts`, `web/app/app/d/[id]/submit/` |
| University and institution templates, discipline/university profiles | `packages/config/src/templates.ts`, `packages/config/src/profiles/`, `api/institution/` |
| Viva preparation | `api/viva/viva.service.ts`, `web/app/app/d/[id]/viva/` |
| Chapter build with S/E/L/T/D checks, examiner review, QA report | `api/chapter-build/`, `packages/ai/src/checks/`, `web/app/app/d/[id]/build/` |
| Grounding enforced in code (`HALLUCINATED_CITE`), relevance floor with refund | `packages/ai/src/builder/postprocess.ts`, `api/assist/assist.service.ts`, `api/assist/chat.service.ts`, `packages/retrieval` |
| Proposal (problem, objectives, gap) and outline with per-section regeneration | `web/app/app/d/[id]/proposal/`, `api/memory/proposal.controller.ts`, `api/memory/outline.controller.ts` |
| Coherence engine: term drift, contradictions, citation support | `api/coherence/coherence.service.ts`, `FlagsPanel.tsx` |
| Reference health, citation report, originality / paraphrase closeness | `ReferenceHealth.tsx`, `CitationReport.tsx`, `api/overlap/overlap.service.ts`, `ParaphrasePanel.tsx` |
| Journal matching with citedness (no invented impact factor) | `api/journals/journals.service.ts`, `JournalsScreen.tsx` |
| Living gap map with OpenAlex density trend and snowballing | `DiscoverPanel.tsx`, `apps/worker/src/jobs/search-literature.ts` |
| Footnotes, note styles, cross-references, diagrams, Word-native equations, merged cells | `ui/footnote.ts`, `ui/cross-ref.ts`, `DiagramDialog.tsx`, `packages/export/src/word-math.ts`, `packages/export/src/table-grid.ts` |
| Provenance on every AI span, draft blocks behind accept, AI-usage log | `ui/provenance.ts`, `ui/draft-block.tsx`, `packages/export/src/ai-usage.ts` |
| Glossary / style profile with the student's own guidance | `api/memory/outline.controller.ts` (`memory/glossary`, `style-profile/guidance`), `WritingProfile.tsx` |
| Deadline and readiness | `api/export/export.controller.ts` (`deadline`, `readiness`) |
| Institution admin with seats and invoices; ₹ pricing; reference list never paywalled | `api/institution/`, `api/billing/`, `web/app/institution/` |

## Summary by status

| Status | 2026-10-04 (first pass) | 2026-10-04 (evening) | 2026-10-08 (after Round 2) |
|---|---|---|---|
| MATCH | 16 | 65 | 76 |
| PARTIAL | 47 | 18 | 8 |
| MISSING | 24 | 3 | 2 |
| OURS BETTER | 14 | 15 | 15 (in the table), plus the areas in section 15 |

(101 rows in sections 1–14.)

## What is still open (2026-10-08)

| # | Row | Status | What remains, exactly | Whose |
|---|---|---|---|---|
| #36 | Zotero / Mendeley account connection | PARTIAL | Zotero by pasted key only, read once; Mendeley by file; no sync | Owner (changes PRD FR-2.9; Elsevier app) |
| #38 | Full-text index across papers | PARTIAL | Fetched per student in minutes, not pre-indexed; Springer OA outside PMC abstract-only | Owner (Springer key); the rest is architecture |
| #45 | Chat history across documents | PARTIAL | Threads per thesis; no thread that follows the student, no chat without a thesis | Decision (grounding per thesis, §10.6) |
| #49 | AI Edit actions | PARTIAL | 22 of Jenni's groups and the web switch (ADR-0133, papers added to the library first); no Paraphrase with tones | Deliberate (§12.3) |
| #55 | Peer review | PARTIAL | Points in the text, Major / Minor; no ratings (card withheld, ADR-0111), strengths or questions | Agent, if a score prompt passes `eval-examiner-scores.ts`; strengths/questions need a prompt change (ADR + eval) |
| #80 | Live co-editing | PARTIAL | Built, off: host nginx `/collab/` block and the flag | Owner (said leave it) |
| #89 | Interface languages | PARTIAL | English and Hindi (beta) of Jenni's sixteen; panels, help, admin English | Owner (Hindi review, next language) |
| #94 | Live chat support | MISSING | — | Owner |
| #95 | Video tutorials | PARTIAL | One explainer and /help | Owner |
| #98 | Community | MISSING | — | Owner |

## MISSING and PARTIAL, by how often a student would hit them (as of 2026-10-04 — kept for the record)

The ordering below is the first pass of 2026-10-04 and is left as it was written, so the
later build can be read against it. Every numbered item in it is now MATCH or OURS BETTER except
#38, #45, #49, #80, #89, #94, #95, #98 (the table above) and #55 (re-audited to PARTIAL on
2026-10-08).

My judgement, not measured: ordered by how many sessions of an ordinary thesis student would run
into the gap.

**Every session**
1. #1 Return does not land in the last document (MISSING)
2. #13 No visible Accept / Refine on a suggestion; phone users have no Tab (PARTIAL)
3. #17 Ctrl+/ / Suggest silent when nothing to cite (PARTIAL)
4. #22 No evidence card before accepting a suggested citation (MISSING)
5. #14 No Refine presets, incl. "Validate supporting evidence" (MISSING)
6. #21 Citation card lacks cited-by, citedness, open access (PARTIAL)
7. #66 No "/" insert menu (MISSING)
8. #9 Assist ignores the sub-section note under the cursor (PARTIAL)
9. #99 Mobile: banners and toolbar crowd out the text (PARTIAL)
10. #15 No suggestion history (MISSING)

**Most weeks**
11. #23 / #50 Find a citation for a selected sentence beyond the library (PARTIAL)
12. #29 Find papers buried in Chat, no sort / passage / direct Cite (PARTIAL)
13. #49 Five AI Edit actions instead of seventeen (PARTIAL)
14. #41 Chat cannot answer beyond the library, no visible steps (MISSING)
15. #60 Checks spread over seven places (PARTIAL)
16. #18 / #38 Empty or abstract-only library: no instant full-text citations (PARTIAL)
17. #52 / #83 Student cannot comment on own text (MISSING)
18. #59 No Accept all / keyboard review for AI checks (PARTIAL)
19. #54 Claim check is library-only, proposes no source (PARTIAL)
20. #34 PDF reader is a separate browser tab (PARTIAL)
21. #10 Pins per chapter, not per section (PARTIAL)
22. #39 / #40 One chat scope at a time, no Off/Ask/On (PARTIAL / MISSING)
23. #45 Chat history per thesis only (PARTIAL)
24. #46 / #87 No Copy button (PARTIAL)
25. #69 / #70 / #71 Equations: no examples, no words-to-equation, no picture (PARTIAL / MISSING / MISSING)
26. #100 Screen readers do not hear the suggestion (PARTIAL; every session for those students)

**At milestones**
27. #84 Word export citations are dead text (MISSING) — once per export, but costly
28. #3 / #2 / #6 / #4 / #8 / #7 Start: no meter, extra screens, no notes-to-cursor landing, no preference screen, no answer editing, no Word import (PARTIAL / MISSING)
29. #63 Gap analysis by counts, not claims (PARTIAL)
30. #64 / #65 No "we will email you" on long runs; no per-result rating (PARTIAL)
31. #55 No on-demand peer review of a chapter (PARTIAL)
32. #57 No tone review (PARTIAL)
33. #73 / #74 TOC and AI declaration not insertable (PARTIAL)
34. #26 No style locale or preview (PARTIAL)
35. #36 No Zotero / Mendeley account link (PARTIAL)
36. #31 / #32 No collections; no quality signals on library rows (MISSING / PARTIAL)
37. #85 One LaTeX layout (PARTIAL)
38. #78 / #79 / #80 / #81 No viewer role, no link access, co-editing behind a flag, no cloning (PARTIAL / MISSING / PARTIAL / MISSING)
39. #91 / #90 / #89 No style/font defaults, no high contrast, English-only interface (PARTIAL / PARTIAL / MISSING)

**Rarely**
40. #94–#98, #101 Help: live chat, docs, changelog, community, tutorials, live demo (MISSING / PARTIAL)
41. #20 Move block with Ctrl+↑/↓ (MISSING); #76 math help tab (PARTIAL)
