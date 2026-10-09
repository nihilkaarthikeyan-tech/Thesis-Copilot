# Build plan from the Jenni study (started 2026-10-04)

Source of every item: `docs/JENNI-FIX-LIST.md` (numbers below refer to its section A) and
`docs/research/coverage-map.md`. Order: faults first, then Jenni's core flow, then the larger
features. Each item is built, tested (unit + typecheck + lint; a browser check for anything a student
sees), committed locally. Nothing is pushed or released until the owner says so.

Items that change cost or need a decision only the owner can take are listed at the end and are
**not** built until answered.

## Batch 1 — faults (no new features)

| # | Item | Status |
|---|---|---|
| 1 | Suggest / Ctrl+/ with nothing to cite: say why, offer Find papers || Done 2026-10-04 |
| 2 | Proposal related-work search: key words, not the whole conversation; retry broader; a failed search is shown as failed, not "0 found" || Done 2026-10-04 |
| 3 | When nothing was found, the model is told so in plain words (no "related work found…") || Done 2026-10-04 |
| 4 | Topic path: no "sources found in your paper" || Done 2026-10-04 |
| 14 | Proposal options as buttons the student can tap || Done 2026-10-04 |
| 5 | Breadcrumb: long title truncated, never empty || Done 2026-10-04 |
| 6 | Toolbar: Chart / Diagram labels overlap || Done 2026-10-04 |
| 7 | Editor banner: accurate (suggestions on a pause), no keyboard talk on a phone || Done 2026-10-04 |
| 8 | Sources panel refreshes when automatic sources add papers || Done 2026-10-04 |
| 9, 40 | No internal words ("Strong call", "Fast call") on student pages || Done 2026-10-04 |
| 10 | Discover shows stages and an estimate while it runs || Done 2026-10-04 |
| 11 | A friendly message, not "Failed to fetch", when the server cannot be reached || Done 2026-10-04 |
| 12 | Phone: banners collapse to one line; the text comes first || Done 2026-10-04 |
| 13 | Screen readers hear the suggestion and how to accept it || Done 2026-10-04 |
| 31 | Build: chapter label "2. Chapter 1 — …" || Done 2026-10-04 |
| 32 | Build: discipline suggestion from the field; no internal check codes; one language list || Done 2026-10-04 |
| 33 | Submit: human field names, not "studentName" || Done 2026-10-04 |
| 34 | Journals: no "No subject overlap" on every match; "you cite" only when cited || Done 2026-10-04 |
| 35 | Usage: plain names for VIVA / CHAPTER_BUILD; hide allowances that are 0 || Done 2026-10-04 |
| 36 | Settings copy matches the real default || Done 2026-10-04 |

## Batch 2 — Jenni's core flow

| Item | Status |
|---|---|
| A returning student lands back in the last chapter they wrote | Done 2026-10-04 |
| The thesis lands with an outline (all chapters) after the proposal, cursor in the first | Done 2026-10-04 |
| Suggestion bar: Accept / Refine / thumbs on screen (works on a phone) | Done 2026-10-04 |
| Evidence card on a suggested citation before accepting | Done 2026-10-04 |
| Refine presets (validate evidence, cite from my library, simplify, stay on topic, complete paragraph) | Partly: 2026-10-07 code check found only stay on topic and complete paragraph (plus shorter, formal, contrasting) — the rest is Round 2, R3. **Done 2026-10-07 (R3, ADR-0089)** |
| Find papers as a panel beside the text with Cite on each result | Done 2026-10-04 |
| "/" insert menu: table, equation, chart, diagram, table of contents, AI declaration, placeholder citation | Done 2026-10-04 (no table of contents: the export builds a real one) |
| Equations: examples, a cheat sheet, describe-in-words | Done 2026-10-04 — examples, live preview, cheat sheet; describe-in-words waits for the owner (new prompt) |
| Selection edits as a preview with "what changed and why", Replace / Insert below / Try again / Discard | Done 2026-10-04 — Replace / Insert below / Try again / Discard on the existing diff; "why" waits for the owner (new prompt) |
| One Review panel listing every check with one button each | Done 2026-10-04 — "Every check, in one list" on the flags tab |
| A student can comment on their own text | Done 2026-10-04 |
| Word export: citations as Word citation fields (optional hyperlinks) | Done 2026-10-04 — ADR-0055; opening in real Word is in PENDING |

## Batch 3 — larger features

| Item | Status |
|---|---|
| One-button peer review of any text: scores, weaknesses, strengths, questions, anchored comments | Done 2026-10-04 — Examiner review of a chapter, flags on each sentence (ADR-0056; the chapter build's examiner, no new prompt) |
| Gap analysis by claim (supported / contested / under-explored) on top of the theme map | Done 2026-10-05 (ADR-0086, the claims map on the Discover tab); opened as an editable chapter 2026-10-08 (R38, ADR-0123) |
| Chat that can search beyond the library (asks first), shows its steps | Done 2026-10-04 — ADR-0060: the off-topic refusal offers the search (or runs it, setting On); answers from up to 8 abstracts through the existing A.4 prompt, steps shown, each paper "Not in your library" with Add. Playwright spec written, not run; real-model check in PENDING |
| More selection actions (counter-argument, hedge/strengthen a claim, tense, to table, translate) | Done 2026-10-05 (ADR-0066, ADR-0081: thirteen actions incl. translate and as-a-table) and 2026-10-07 (R8, ADR-0095: the rest, 22 in one panel) |
| Library: duplicate detection, missing-PDF view | Done 2026-10-04 — possible duplicates with Merge (snapshots first), "Without full text" with Add the PDF |
| Interface language (Hindi, Tamil…) | Done 2026-10-05 — Hindi (beta) on the student's main screens, English fallback (ADR-0061); Tamil after the Hindi review (PENDING) |

## Beyond the batches (fix list items, 2026-10-04)

| Item | Status |
|---|---|
| Earlier suggestions kept: ‹ › on the suggestion bar steps back to one before Refine replaced it | Done 2026-10-04 |
| Assist reads the note of the sub-section under the cursor, not only the chapter's (A21) | Done 2026-10-04 |
| Ask chat about a selected passage | Done 2026-10-04 |
| Start flow: topic meter with examples, citation style at creation, signed-in home header, list first | Done 2026-10-04 |
| Cited-by, open-access and journal-citedness badges (library, hover card, evidence card); Copy on a chat answer | Done 2026-10-04 |
| Sharing: roles (guide / co-author / reader), a read-only link, make a copy | Done 2026-10-04 (ADR-0057) |
| Help pages at /help: nine task-based articles checked against the screens, linked from the site and the editor | Done 2026-10-04 |
| A changelog at /changelog, from typed data (`apps/web/src/content/changelog.ts`) | Done 2026-10-04 |
| Citation style preview (one in-text citation, one bibliography entry, an example reference) in the editor's style search and at thesis creation; `GET /citation-styles/:id/preview` | Done 2026-10-04 |
| Import from Word: a `.docx` becomes chapters at each Heading 1 (append, or replace an empty thesis) | Done 2026-10-04 |
| Library collections (folders): strip with counts, filter, tick rows → add / remove, rename, delete (papers stay); copied with a thesis | Done 2026-10-04 (migration 0036); browser spec not yet run |
| Read a paper's PDF beside the chapter (hover card "Read beside", Sources tab "Read PDF"), at the cited page, resizable; new tab on a phone | Done 2026-10-04; production needs the host vhost's `X-Frame-Options` → `SAMEORIGIN` (`docs/PENDING.md`) |
| "Safe to close — we'll email you": one email when a literature search, chapter build, examiner review or coherence check ends after more than a minute with no visible tab watching; a setting to turn it off (coverage-map row 64) | Done 2026-10-04 (ADR-0058); Playwright not run |
| Citation locale (coverage-map row 26): "Language of the citations" in the Citations tab — Automatic, English (UK), English (US), German, French, Spanish, Dutch; bibliography, labels, preview and every export follow it | Done 2026-10-04 (ADR-0065, migration 0038); browser spec written, not run |
| Matching passage on each Find papers result (row 23): the abstract's best-matching sentence(s), verbatim, labelled "From the abstract", searched words in bold | Done 2026-10-04; browser spec extended, not run |
| Import from Zotero by API key: user ID + read-only key, collections dropdown, whole library or one collection, up to 500 items, into the .bib import's resolve pipeline; key never stored or logged (coverage-map row 36, ADR-0059 row 36) | Done 2026-10-04 (ADR-0062); no live Zotero call yet (no key); Mendeley in `docs/PENDING.md` |
| "Start writing now" on the thesis list and /app/new: thesis made ("Untitled thesis" if no title), first chapter opens; "Add a proposal" on the list and in the editor (coverage-map row 2, ADR-0059 row 2) | Done 2026-10-04 (ADR-0062) |
| Chat scoped to a collection | Not done on 2026-10-04: chat takes at most ten `sourceIds` (the `@` mentions); a collection needs its own server-side scope. **Done 2026-10-08 (R30, ADR-0116)** |

## Also fixed on the way (found while building)

- One label per paper where its passages are cited side by side ("(Jimenez 2021)" ×3), in
  suggestions, chat and drafts.
- Chapter lists printed "1. Chapter 1 — Introduction".
- Journals: OpenAlex no longer returns `x_concepts` for journals, so every topic fit was zero;
  topics are read instead.
- A new thesis's only chapter becomes the outline's first instead of a detached copy.

## Found while building

| # | Item | Source | Code today | Build | Done when |
|---|---|---|---|---|---|
| R41 | **Dark mode and typography like Jenni's**: Inter for the interface and the thesis text (15/24), headings 30/20 px bold, the warm Flexoki palette (open source) in dark and light | Owner, 2026-10-07: "the dark mode I don't like… looks like AI generated… the typography… copy from Jenni" | Navy dark, periwinkle accent, Satoshi + Spectral serif (ADR-0034) | Round 1 shown as `demo/Thesis-Copilot-look-round-1.pdf` (real screens, in-browser override, no code change); build after the owner picks A (purple) or B (our blue) | Every main screen in both themes, high contrast kept, landing pages follow |
| R40 | **Citations side by side read "(Gadekar et al., 2026)(Raja et al., 2026)"** — no space, not merged | Seen in the R1 browser run, 2026-10-07 | Two citation nodes render as two brackets | Adjacent citations render as one: "(Gadekar et al., 2026; Raja et al., 2026)" in the editor and every export (numeric styles: "[3, 7]") | The R1 paragraph reads as one bracket, in the page and in .docx |

## Owner decisions (not built until answered)

- Count only **kept** suggestions against the allowance (Jenni does); today every shown suggestion
  counts. Raises AI spend per student; needs the cost model re-run against the ₹100 ceiling.
- Refine presets shipped without a new prompt (they ride the existing guided instruction).
- New prompts (peer review, new edit actions, describe-an-equation, "what changed and why") are not from
  Appendix A; each needs an ADR and an eval round like ADR-0010.
- Springer Nature Open Access API key (`docs/PENDING.md`).


---

# Round 2 — everything still to build after the full Jenni study (2026-10-07)

**Why this round.** On 2026-10-07 the owner had the agent use Jenni end to end — first in the
owner's account, then in a brand-new account from the first screen after sign-in — clicking every
button, running every review and workflow, and testing Jenni's Chrome extension
(`docs/JENNI-FULL-INVENTORY.md`, sections 0–13). The owner then asked for one list of *everything*
planned from that study and from this conversation, with nothing missed.

**How this list was made.**
1. Sources read in full: every owner message in the conversation of 2026-10-05 → 07 (152 messages);
   every gap cell in the inventory (78 lines, sections 1–13); `docs/JENNI-FIX-LIST.md` (40 faults,
   30 observations); `docs/research/coverage-map.md` (open rows); this file's Round 1 (unfinished
   rows); the inventory's build list (§14) and Jenni's faults (§13.7).
2. Every candidate was then **checked against the code** (2026-10-07), not against the docs. Status:
   **Have** (built — not on this list), **Partial** (what exists is named), **Missing**.
3. Order: what a student feels first (the writing area, the first session), then sources, reviews,
   documents and export, workflows, the add-on. Owner decisions and outside accounts at the end.

**Corrections found by the code check (the docs were wrong):**
- Round 1 above marks "Refine presets (validate evidence, cite from my library, simplify, stay on
  topic, complete paragraph)" **Done 2026-10-04**. The code (`SuggestionBar.tsx` `REFINE_PRESETS`)
  has only Shorter, More formal, Stay closer to my topic, Complete this paragraph, A contrasting
  finding, and a free box. Validate, Cite from my library, Simplify, Increase novelty and Re-write
  without citations are **not built** → R3.
- The inventory (13.3) says ours has "comments with replies". The `Comment` model has no reply or
  parent field; comments can be resolved, accepted or rejected, not answered → R22.

**Rules for every item** (PRD and CLAUDE.md, unchanged): the ₹100 ceiling with the cap taken before
any provider call; grounding (cite only what was read); flag, don't fix (nothing enters the thesis
without the student's action); no humanise features; new prompts need an ADR and an eval round;
one ADR per changed decision; a browser check for anything a student sees. **Jenni's faults are
not copied** (inventory §13.7: doubled citations, citations moved between claims, a citation after
the full stop, silent failures, an MDPI issue saved instead of the article, a paid wall that only
hides the references).

**Already built from this conversation (for the record, v0.1.31, ADR-0087):** the manager's
"citations go round three papers" (15-paper start, two passages per paper, cited papers step back,
three papers per section); sources-and-citations step with **indexing** instead of impact factor
and cited-by; Smart / Standard / No headings; headings written into the page; a first sentence
under the first heading without typing.

## Tier 1 — the writing area and the first session (launch-critical)

| # | Item | Source | Code today | Build | Done when |
|---|---|---|---|---|---|
| R1 | **Suggestions in the middle of a sentence** after a pause | Owner 07:41 ("while we start to write it shows AI suggestion"); inv. §12 C1; §14 item 8 | **Missing** — `ghost-text.ts` `atSentenceBoundary` returns early unless the text ends in `.!?…` (ADR-0078 chose this to save units) | A mid-sentence trigger after a longer pause, only after a few words at a word boundary; never right after a heading, a citation, or non-prose. ADR with the expected rise in Assist use | Typing half a sentence and stopping brings a grey continuation within ~2 s, in the browser; trigger unit tests |
| R2 | **Accept chains straight on** | inv. §10, §13.1 | **Partial** — happens only if the accepted text ends a sentence (timer re-arms) | Request the next suggestion once, right after Accept (not after Dismiss) | Accept → next grey text without a keystroke |
| R3 | **Refine presets**: Increase novelty, Simplify language, Re-write without citations, **Validate supporting evidence**, **Cite from my library** | inv. §10, §13.3; fix list B; Round 1 (wrongly marked done) | **Partial** — 5 presets + free box exist (above) | Add the five on the guided-instruction path; Validate rewrites the claim to what its cited passage says (grounded); Cite from my library says so when nothing fits (Jenni is silent) | Each returns a changed suggestion or a plain message; ‹ › keeps history |
| R4 | **3–4 questions at the start, with AI-suggested answers the student can take or change** | Owner 07:33 ("ask the prompts like questions, 3–4 from the user, and the AI must give the suggestion, they can take it or not") | **Partial** — the proposal path asks questions with tap options; *Start writing now* asks none (only preferences and structure) | After the title: up to four short questions (aim, method, setting, key terms), each with an AI-suggested answer to accept, edit or skip; answers feed the outline and suggestions | A new thesis via Start writing now shows the questions with suggestions; skipping all still works |
| R5 | **A faster, fuller start**: title written from the topic, the prompt cleaned up, **sub-headings (H3)**, first cited sentence ≤ 20 s | inv. §9, §13.1 (Jenni: title 3 s, sentence 17 s) | **Partial** — H2 only; no title suggestion; ~40 s to the first sentence | Suggested title; H3 under H2 in Smart headings; start the first sentence before the whole outline is written | ≤ 20 s to the first cited sentence on the real stack, measured |
| R6 | **Suggestion settings inside the editor** (web, library, select sources, year, indexing, preprints) | inv. §10, §12 C2 | **Partial** — `sourcePrefs` set only at creation; no PATCH | A toolbar panel that reads/writes `Document.meta.sourcePrefs` | Change a setting mid-chapter → next found papers follow it |
| R7 | **Block handle** beside every paragraph: + insert; menu Turn into, Cite, Highlight, AI Chat, AI Edit, Review ▸, Duplicate, Delete | inv. §10, §13.3; §14 item 1 | **Missing** — keyboard move only (`move-block.ts`) | A `packages/ui` extension with the handle and menu | Every menu item works on a paragraph in the browser |
| R8 | **AI Edit as one panel (Ctrl+J)**: a free prompt box with web/library switches; presets filterable by typing; missing presets (paraphrase tones, fluency, transitions, strengthen argument, increase confidence, bullet / numbered / prose, technical precision); a **follow-up box**; **"What changed and why"** | inv. §10, §13.3, §13.9; fix list 26 | **Partial** — 13 actions, word diff, Replace / Insert below / Try again / Discard; no box, no Ctrl+J, no reasons, no follow-up | The panel and presets; reasons need a new prompt (ADR + eval, CLAUDE.md rule 6); code checks that a citation is never doubled or moved to another claim | Each preset works; reasons show; the citation checks have tests |
| R9 | **Paste with a choice**: pasted text that came with a source keeps its citation; a menu offers Improve / Paraphrase / Proofread / Custom | inv. §13.2, §13.3 | **Missing** — the reader copies with citation, but nothing happens on paste | A paste handler + menu | Reader → Copy with citation → paste gives cited text and the menu |
| R10 | **Sections panel on the left**: every section with its notes (editable in place), source context, Generate / Draft; a heading typed in the page appears at once | inv. §10, §12 C3, §13.3 | **Partial** — `SectionGuide` above the page, notes read-only there (edited on the Outline screen); pins per section exist | One left panel, live with the headings | Edit a note and draft from the panel without leaving the chapter |
| R11 | **Feature hints on the screen** (a dot on an unused feature → one line + Try now / Dismiss) | inv. §13.1 | **Partial** — checklist and guide exist (`SetupChecklist.tsx`, `FirstSessionGuide.tsx`); hints are blocks, not on the feature | Three or four hints on Library, Cite, Checks, Chat | Hints show once each and disappear when used |
| R12 | **Usage one click away** (bars per allowance in the account menu) | inv. §1 | **Partial** — Account page and header counter | Bars in the header's account menu | Visible from any screen in one click |

## Tier 2 — sources and the reader

| # | Item | Source | Code today | Build | Done when |
|---|---|---|---|---|---|
| R13 | **Explain selection**: draw a box on a PDF page → chat with the picture and paper-specific questions | inv. §13.2 | **Partial** — reader has Copy with citation, Cite, Ask in chat, scroll-to-passage highlight; no region capture (image input exists, ADR-0064) | Box select → image to chat; three questions about this paper | Box → answer about that region |
| R14 | **Fetch PDF** for a paper without full text, automatically (open-access copy), with a "N without PDF" banner | inv. §4, §13.2 | **Partial** — "Missing" filter and manual "Add the PDF" | A Fetch button + background fetch | A DOI-added open-access paper gets its PDF in one click |
| R15 | **Edit a paper's details** (form by source type) | inv. §4 (Missing), §13.9 | **Missing** | Edit form on the Sources page / reader | Fix an author or year and the citation follows |
| R16 | **Add by ID**: paste DOI / PMID / arXiv / ISBN, metadata preview, Import | inv. §4, §12 E | **Missing** (DOI re-fix only for unresolved papers) | A Paste ID tab in Add sources | Each ID type imports with a preview |
| R17 | **Library filters** (year, open access, type) and a **details drawer** with ↑↓ step-through and Ask AI; **Cite** in one click from the library | inv. §4 | **Partial** — full-text filters, Read page | Filters, drawer, Cite | Each filter narrows the list; drawer steps through |
| R18 | **Save into a collection while adding** (pick or create inline) | inv. §4, §13.9 | **Partial** — collections exist; no pick on add | Collection picker on every add | Add → straight into a chosen or new collection |
| R19 | **Sources in this document** with Save all to library | inv. §13.9 | **Partial** — citation list and bibliography; "Add all" only in chat research | A dialog from the References area | Every cited paper listed; one click saves the rest |
| R20 | **PDF upload quality**: authors' initials, joined line-break hyphens, the abstract read | inv. §13.9 (Jenni failed all three) | **Unchecked** in ours | Test with the same test PDF; fix what fails | The test PDF gives full authors, clean title, abstract |
| R21 | **Open quote beside the writing** (PDF beside the chapter at the passage, highlighted) | inv. §5 | **Partial** — read beside (iframe; new tab where the host blocks framing) + reader highlight | Read beside opens at the passage with the highlight | From a citation, the passage shows beside the text |

## Tier 3 — reviews and comments

| # | Item | Source | Code today | Build | Done when |
|---|---|---|---|---|---|
| R22 | **Replies on comments** (threads, react, edit, delete) | inv. §13.3, §13.10 | **Missing** (no reply field) | A reply model + UI; guide and student can answer each other | A comment can be answered and the thread resolved |
| R23 | **Checks as tracked changes in the text**, with a review mode: Y / N, Accept all / Reject all, ↑ ↓, then "Try next" | inv. §13.3; fix list B | **Missing** in the text — Y/N and Accept all exist only as a list in Proofread/Tone | Show fixes inline as tracked edits for citation support, proofread, tone | Y/N walks through every change in the page |
| R24 | **Examiner points as comments in the text** tagged **Major / Minor**, and **scores** (soundness, presentation, contribution, overall /10) | inv. §13.3; fix list 25 | **Partial** — flags ERROR/WARN in a side list with Go to; no scores | Anchored highlights + severity names; scores need a prompt change (ADR + eval) | Running it leaves highlighted, tagged points and a score card |
| R25 | **Source-quality notes**: publication-year chart, venue spread | inv. §13.3 | **Partial** — retracted / preprint / weak-venue flags exist | The two charts in the Source quality panel | Charts reflect the chapter's citations |
| R26 | **A check on one paragraph** (from the block handle) | inv. §10, §13.3 | **Partial** — examiner review of a selection (ADR-0067) | Each check runnable on a block (with R7) | Block → any check → results for that block |

## Tier 4 — documents, export, chat, settings

| # | Item | Source | Code today | Build | Done when |
|---|---|---|---|---|---|
| R27 | **One export dialog** with layout presets (default, double-spaced, two-column, thesis), advanced options (paper, font, size, spacing, margins, title page, contents, page numbers, comments) and a **live preview** — keeping our templates, compliance checks and free references | inv. §10, §13.8, §13.9 | **Partial** — .docx / PDF / LaTeX / HTML with institution templates and title-page details | The dialog and preview | Change a preset → preview changes → file matches |
| R28 | **Table of Contents block**, **highlight colours**, **text colour**, horizontal rule | inv. §10, §13.3 | **Missing** | Editor extensions + "/" items | Each inserts and survives export |
| R29 | **Archive and restore** theses; a copy named "… (copy)" | inv. §3, §13.9 | **Partial** — delete and "Copy of …" | Archive with a restore list | Archive → hidden → restore |
| R30 | **Chat**: thread history; a chat **across theses**; a chat without a thesis from **New ▾**; web search asked inline as **Allow this time / Always allow / Skip**; a chat scoped to a **collection** | inv. §8, §11, §13.5; Round 1 (collection not done) | **Partial** — one chat per thesis; web search via a button or Settings | Threads, the inline prompt, collection scope; cross-thesis only for general questions (grounding stays per thesis) | Each works in the browser |
| R31 | **The limit message with the reset date on every screen** | inv. §13.6 | **Partial** — editor only | The same text everywhere a cap can refuse | Any refused action names the allowance and the date |
| R32 | **Documents beside the open thesis** (a side panel) and **one New menu** | inv. §3, §8 | **Partial** — separate list page | A side panel + New ▾ (thesis, chat, upload) | Switch theses without leaving the editor |
| R33 | **Font style** (default / serif) and more themes (paper light/dark) | inv. §2, §10 | **Partial** — light/dark/system/high contrast | Two settings | Applied in editor and export |
| R34 | **Word import tells why citations were not matched** (no references section) | inv. §12 B | **Unchecked** in ours | A notice after import | Importing a file without references shows it |
| R35 | **Markdown shortcuts listed** for the student (and the input rules complete) | inv. §7 | **Partial** — TipTap defaults, not listed | A list in Keyboard shortcuts | Listed and working |
| R36 | **"How was this?" thumbs** after any generated document or build | inv. §6 | **Missing** | A thumbs row stored with the run | Shows after a build; stored |

## Tier 5 — workflows

| # | Item | Source | Code today | Build | Done when |
|---|---|---|---|---|---|
| R37 | **A whole literature-review document from one press** (Jenni: 8½ min, 25,000 words, 212 sources, tables, email at the end) | inv. §6, §13.4 | **Partial** — chapter build, one chapter at a time, as pending drafts (ADR-0039) | Decide scope and cost first (owner decision D3); then a "Literature review" build that writes the whole chapter document, still as pending blocks | One press → a reviewable review chapter |
| R38 | **Gap analysis as an editable document** (claims table + Under-explored / Contested / Well-supported / Directions / Limits) | inv. §6, §13.11 | **Partial** — claims map and gap analysis are read-only panels | "Open as a document" from the claims map | The document opens editable, every claim cited |

## Tier 6 — the Chrome add-on

| # | Item | Source | Code today | Build | Done when |
|---|---|---|---|---|---|
| R39 | **"Add to Thesis Copilot" buttons inside the page**: beside the DOI on article pages and on every Google Scholar result; a card with cited-by, open access and "PDF found" | inv. §13.11 | **Missing** — toolbar popup + context menu only | Content scripts (new permission → store re-review) | Buttons appear on Scholar, PubMed, arXiv, MDPI; the right item is saved every time (Jenni saved an MDPI *issue*) |

## Owner decisions (not built until answered)

| # | Decision | Why it needs the owner |
|---|---|---|
| D1 | **Count only the suggestions a student keeps** (Jenni does; fix list 37) | Conflicts with the hard rule "cap taken before any provider call" (§10.2) and the ₹100 ceiling. Proposal: keep the internal request cap for cost, show the student an allowance of *kept* suggestions and applied edits; re-run `docs/COSTING.md` first |
| D2 | **New prompts**: "What changed and why" (R8), examiner scores (R24), region explanations (R13) | Not from Appendix A; each needs an ADR and an eval round (rule 6) |
| D3 | **Whole literature-review document** (R37) | A new allowance and cost line against ₹100 |

## Needs an outside account or the owner (`docs/PENDING.md`)

Live chat support (Jenni: Intercom with AI agent); video tutorials (Jenni: 11); a community
(Discord); Zotero / Mendeley account sync by OAuth; the Springer open-access key; co-editing in
production (host nginx `/collab/`, flag — the owner said leave it for now); billing clarity before
Razorpay (fix list 30); Scopus / UGC-CARE list files (ADR-0087). Left by the owner on 2026-10-07:
Jenni on a phone, Jenni's Tone of Voice and Proofread results, error and offline screens.

## Index — where every source line went

| Source | Lines | Went to |
|---|---|---|
| Owner, 07:33 (questions with suggestions; manager's three papers) | 2 | R4; built (ADR-0087) |
| Owner, 07:41 (suggestion while writing, headings in the page, indexing not IF/cited-by, smart headings) | 4 | R1; built (ADR-0087) ×3 |
| Owner, 06-10 / 10-05 (co-editing "save for later") | 1 | Outside/owner list |
| Inventory §1 usage bars | 1 | R12 |
| Inventory §2 themes/languages, connections, font | 3 | R33; outside (Zotero/Mendeley); R33 |
| Inventory §3 side panel, archive, archived list | 3 | R32, R29, R29 |
| Inventory §4 filters, cite, drawer, edit form, upload (ID, collection, Mendeley) | 5 | R17, R17, R17, R15, R16/R18/outside |
| Inventory §5 sort, decade filter, open quote | 3 | Have (sort exists), R17, R21 |
| Inventory §6 literature review, gap document, thumbs | 3 | R37, R38, R36 |
| Inventory §7 Markdown | 1 | R35 |
| Inventory §8 New ▾, videos, live chat/community | 3 | R32/R30, outside, outside |
| Inventory §9 locale/page-number switch at start, title/sub-headings/speed | 2 | Have (locale ADR-0065; page numbers in citation edit — check with R27), R5 |
| Inventory §10 suggestion bar, refine, block handle, AI Edit, result, "/", toolbar, settings, sections, menu, export, font, source quality | 13 | R2, R3, R7, R8, R8, R28, R28, R6, R10, R32, R27, R33, R25 |
| Inventory §12 flows A–H | 8 | R4/R5, R34, R1, R6, R1 (fault guard), R30, R16, — (pricing/reconnect: noted) |
| Inventory §13.1 first ten minutes | 10 | R11, R12, R5, R2 (others Have) |
| Inventory §13.2–13.3 reader and writing tools | 15 | R13, R14, R21, R9, R8, R3, R24, R23, R25, R22, R28, R7 |
| Inventory §13.6 limits and counting | 2 | R31, D1 |
| Inventory §13.8–13.9 export, library, documents | 8 | R27, R20, R15, R29, R17, R19, R18, R30 |
| Inventory §13.11 extension, gap run | 2 | R39, R38 |
| Inventory §14 build list items 1–9 | 9 | R7, R8, R3, R6, R10, R15–R17, R28/R29/R30/R33/R5, R1/R4/R34 |
| Fix list A1–A40 | 40 | Done in Round 1 except: 18 Springer (outside), 26 → R8, 29 figure/table numbering → check with R27, 30 billing (outside), 37 → D1 |
| Fix list B (30 observations) | 30 | Covered by R1–R39 or Have; peer-review scores → R24; review mode → R23; chat chips → R30 |
| Coverage map open rows (36, 38, 45, 49, 80, 89, 94, 95, 98) | 9 | outside, outside (Springer), R30, R8, outside (co-editing), Have (Hindi; Tamil in PENDING), outside ×3 |
| Round 1 unfinished rows | 3 | R38 (gap by claim), R8 (selection actions), R30 (chat by collection) |

## Progress (Round 2)

| Item | State | Commit / ADR |
|---|---|---|
| R1 | Done 2026-10-07 — browser-checked with real models | ADR-0088 |
| R2 | Done 2026-10-07 — Accept asks for the next suggestion after 60 ms (was the 800 ms pause timer); browser: next request 0.12 s after Accept | ADR-0088 (R2 note) |
| R3 | Done 2026-10-07 — five presets, grouped menu, `citeMode` none/library, refused refinement restores the suggestion; browser-checked | ADR-0089 |
| R41 | Done 2026-10-07 — owner chose B for dark (warm Flexoki dark, Inter, our blue) and to keep light as it is | ADR-0090 |
| R4 | Done 2026-10-07 — the proposal conversation (A.6) inside Start writing now with Smart headings; Use this / Skip; marker fix on the way; browser-checked with real models | ADR-0091 |
| R5 | Partly done 2026-10-07 — the opening sentence fixed (a lost plan mark, focus), Skip says why; title from the topic comes with R4. H3: two prompt candidates evaluated, both lost 0–2 (3 ties), A.9 unchanged; the layout writes sub-sections as H3 when an outline has them. **Open**: first sentence ≤ 20 s (outline call 21–24 s) | ADR-0092 + addendum |
| R6 | Done 2026-10-07 — Source settings line + Change on the editor's Sources tab (same fields as the start), `PUT /documents/:id/source-prefs`; "select sources" is the pins below it | ADR-0093 |
| R7 | Done 2026-10-07 — "+" and grip beside each block; menu Turn into, Cite, Highlight, Ask in chat, Edit, Review ▸ (examiner, find a source), Move, Duplicate, Delete; drag to move. Other checks on one block are R26 | ADR-0094 |
| R8 | Done 2026-10-07 — one panel (Ctrl+J): box that filters or is your instruction, Use my library, three preset groups (+10 actions; no general paraphrase, §12.3), lists as lists, What changed and why (new fast prompt, inside the unit), follow-up against the original; citations doubled/moved/after-the-stop handled in code; detector requests refused in code. Web switch built 2026-10-09 as "Search the literature": found papers join the library before the edit cites them | ADR-0095, ADR-0133 |
| R9 | Done 2026-10-07 — Copy with citation carries a real citation (HTML); a paste keeps its label and a key of its own; menu: cited → "Put it in my words, cited" / Keep; uncited → Edit with AI / Find a source / Cite it / Keep. No uncited paraphrase (§12.3), no Proofread on the menu | ADR-0096 |
| R10 | Done 2026-10-07 — the rail's headings are the Sections panel: each opens to its note (edit/add in place; a typed heading becomes a section), Draft, Sources; `PUT /outline/section-note` with a row lock | ADR-0097 |
| R11 | Done 2026-10-07 — dots on the Sources, Citations, Chat and Check tabs; one line, Try now / Dismiss; gone once used, tried or dismissed; none while the first-session guide shows | ADR-0098 |
| R12 | Done 2026-10-07 — Usage menu with a coloured bar per allowance and the renewal date: Usage in the list header, the editor counter opens it, a corner button on every other screen | ADR-0099 |
| R13 | Done 2026-10-07 — Explain selection in the reader: a box → picture attached in the chapter chat, the paper as its scope, four questions about it (fixed wording) | ADR-0100 |
| R14 | Done 2026-10-07 — "N papers have no PDF · Fetch open-access copies" and Fetch PDF per paper: re-runs the open-copy search (arXiv, Unpaywall, CORE, Europe PMC); each paper says why when none could be fetched (migration 0041). Publishers that refuse automated downloads are not got round | ADR-0101 |
| R15 | Done 2026-10-07 — Edit details on each library paper: a form by kind; saved to the CSL record and the row, so every citation follows | ADR-0102 |
| R16 | Done 2026-10-07 — Paste an ID: DOI, arXiv, PubMed, ISBN → preview → Add to library (DOIs through the reference pipeline; books from Open Library) | ADR-0103 |
| R17 | Done 2026-10-07 — filters by year, access and kind; a details drawer (abstract, ↑ ↓, Cite in my chapter, Ask AI with questions, Read, Edit details) | ADR-0104 |
| R18 | Done 2026-10-07 — "Add into" (a collection or a new one) on the library's add row; files, Zotero, PDFs and IDs go straight in. 2026-10-09: Discover, the Papers tab, chat's Add / Add all and a pasted reference send the choice too; kept per thesis | ADR-0105, ADR-0129 |
| R19 | Done 2026-10-07 — "Sources in this thesis (N)" on the Citations tab: every cited paper, how often and where, Read, and Keep in my library (one or all) for papers found for the student | ADR-0106 |
| R20 | Done 2026-10-07 — an uploaded PDF names itself from its first page (printed DOI → its record; else title, byline with initials, year, abstract; broken words joined); no more "still looking up" for ever | ADR-0107 |
| R21 | Done 2026-10-07 — Read beside opens at the cited passage, marked | ADR-0108 |
| R22 | Done 2026-10-08 — replies under a comment (student and guide), edit and delete your own, thumbs-up on the comment and each reply; in the review panel, the queue and the guide's page | ADR-0109 |
| R23 | Done 2026-10-08 — review mode: proofreading and tone fixes as tracked changes in the text, flags as highlights; Y / N, ↑ ↓, Accept all (one Undo), Reject all, Esc, "All suggestions resolved!", Try next | ADR-0110 |
| R24 | Done 2026-10-08 — examiner points tagged Major / Minor, opened in the text when a review finishes; the score card built and evaluated (four rounds), not shown: it did not judge presentation or contribution reliably | ADR-0111 |
| R39 | Done 2026-10-08 — in-page Add buttons on Scholar, PubMed, arXiv and MDPI (add-on 0.3.0, not yet submitted) | ADR-0125 |
| R40 | Done 2026-10-08 — adjacent citations render as one bracket in the editor and every export | ADR-0117 |
| R35 | Done 2026-10-08 — Keyboard shortcuts window (keys and Markdown); `$$…$$` equations | ADR-0118 |
| R29 | Done 2026-10-08 — archive and restore theses; copies named "… (copy)" | ADR-0114 |
| R36 | Done 2026-10-08 — "How was this?" thumbs after a chapter build and a viva set | ADR-0115 |
| R26 | Done 2026-10-08 — "Check this paragraph" from the block handle: proofread, tone, examiner on one block | ADR-0126 |
| R31 | Done 2026-10-08 — the limit message with the reset date on every screen | ADR-0122 |
| R25 | Done 2026-10-08 — publication-year chart and venue spread in Source quality | ADR-0112 |
| R34 | Done 2026-10-08 — Word import says why its citations were not linked | ADR-0113 |
| R38 | Done 2026-10-08 — the gap analysis opens as an editable chapter of pending drafts | ADR-0123 |
| R37 | Done 2026-10-08 — whole literature review from one press, behind an off flag at a cap of 0 (owner sets the price) | ADR-0124 |
| R30 | Done 2026-10-08 — chat threads, a chat on one collection, web search asked inline; 2026-10-09 — a chat across all theses ("All my theses" on Ask a research question) | ADR-0116, ADR-0132 |
| R32 | Done 2026-10-08 — the theses beside the open one, and one New menu; 2026-10-09 — New ▸ Ask a research question, with no thesis | ADR-0127, ADR-0132 |
| R28 | Done 2026-10-08 — contents block, text colour, highlight, horizontal rule, in every export | ADR-0119 |
| R33 | Done 2026-10-08 — paper light/dark themes and a font style | ADR-0120 |
| R27 | Done 2026-10-08 — one export dialog with presets, options and a live preview | ADR-0121 |
| R25–R40 | all built and merged 2026-10-08 (R37 behind an off flag) | — | (owner: "start to build them one by one"; report after each — 2026-10-07) | — |

---

# Where Round 2 stands (2026-10-08)

Audited against the code on `main` after v0.1.32, row by row, not against the progress table
above. "Done" means the row's "Done when" holds in the code. "Partly" names exactly what is
missing. Nothing is "Not done".

| # | Item | State | ADR | What is left, if anything |
|---|---|---|---|---|
| R1 | Suggestions mid-sentence | Done | 0088 | — |
| R2 | Accept chains straight on | Done | 0088 | — |
| R3 | Refine presets (five more) | Done | 0089 | — |
| R4 | Start questions with suggested answers | Done | 0091 | — |
| R5 | Faster, fuller start | **Partly** | 0092 + addendum | The opening sentence, the title from the topic (with R4) and H3 layout are done. **Open:** first cited sentence ≤ 20 s (the outline call alone is 21–24 s); an outline prompt that writes sub-sections lost its evaluation 0–2 (two candidates), so A.9 is unchanged |
| R6 | Source settings in the editor | Done | 0093 | — |
| R7 | Block handle | Done | 0094 | — |
| R8 | AI Edit as one panel | Done | 0095, 0133 | Panel, Ctrl+J, 22 presets, What changed and why, follow-up, citation checks: done. Web switch done 2026-10-09 (ADR-0133): the papers found are added to the library first, so the edit cites only library papers. Paraphrase with tones is refused under §12.3 (right) |
| R9 | Paste with a choice | Done | 0096 | — |
| R10 | Sections panel | Done | 0097 | — |
| R11 | Feature hints | Done | 0098 | — |
| R12 | Usage one click away | Done | 0099 | — |
| R13 | Explain selection | Done | 0100 | — |
| R14 | Fetch PDF | Done | 0101 | Publishers that refuse automated downloads are not got round (right) |
| R15 | Edit a paper's details | Done | 0102 | — |
| R16 | Add by ID | Done | 0103 | — |
| R17 | Library filters and drawer | Done | 0104 | — |
| R18 | Save into a collection while adding | Done | 0105, 0129 | — (Discover, Papers tab, chat, pasted references file in too since 2026-10-09; the choice is kept per thesis) |
| R19 | Sources in this thesis | Done | 0106 | — |
| R20 | PDF upload quality | Done | 0107 | — |
| R21 | Open quote beside | Done | 0108 | — |
| R22 | Replies on comments | Done | 0109 | No email on a reply (comments never emailed either) — owner's optional, `docs/PENDING.md` |
| R23 | Review mode in the text | Done | 0110 | — |
| R24 | Examiner points Major / Minor and scores | **Partly** | 0111 | Points in the text, tagged: done. **The score card is built, evaluated (four rounds) and not shown** — presentation and contribution did not track the text. A next attempt must pass `apps/worker/scripts/eval-examiner-scores.ts` |
| R25 | Source-quality notes | Done | 0112 | — |
| R26 | A check on one paragraph | Done | 0126 | — |
| R27 | One export dialog | Done | 0121 | — |
| R28 | Contents block, colours, rule | Done | 0119 | — |
| R29 | Archive and restore | Done | 0114 | — |
| R30 | Chat threads, collection, inline ask, across theses | Done | 0116, 0132 | A chat across theses is "All my theses" on Ask a research question (ADR-0132); the editor's chat panel stays one thesis's |
| R31 | Limit message on every screen | Done | 0122 | English only (Hindi in PENDING) |
| R32 | Theses beside, one New menu, chat with no thesis | Done | 0127, 0132 | New ▸ Ask a research question (ADR-0132) |
| R33 | Font style and paper themes | Done | 0120 | — |
| R34 | Word import says why | Done | 0113 | — |
| R35 | Shortcuts listed | Done | 0118 | — |
| R36 | "How was this?" thumbs | Done | 0115 | After a chapter build and a viva set; a /privacy line is the owner's optional |
| R37 | Whole literature review | Done, **not on** | 0124 | Built behind an off `literatureReviewBuild` flag at a cap of 0. The owner sets the allowance (₹12.92 a build; one a month on a paid plan makes ₹106.05 against the ₹100 ceiling unless chapter builds or examiner reviews give) and turns it on |
| R38 | Gap analysis as a document | Done | 0123 | — |
| R39 | Add-on buttons in the page | Done, **not published** | 0125 | Add-on 0.3.0 built; submitted by the owner after 0.2.1 is approved (`apps/extension/PUBLISHING.md` §7a) |
| R40 | Citations side by side | Done | 0117 | A two-source Word field opened in real Word is the owner's check |
| R41 | Dark mode and typography | Done | 0090 | Dark is B (warm Flexoki, Inter, our blue); light kept as it was, by the owner's choice |

**Totals: 40 done, 1 partly (R24), 0 not done** (R5, R8, R18, R30 and R32 done 2026-10-09: ADR-0092 addendum, 0133, 0129, 0132). Two of the 40 are built
but wait on the owner to be used (R37 flag and price, R39 store submission). Of the three owner
decisions: **D3** answered (R37 built, priced, left off); **D2** taken by the agent under
ADR-0059 — "What changed and why" built (ADR-0095), region explanations built without a new prompt
(ADR-0100), examiner scores evaluated and withheld (ADR-0111); **D1** still the owner's.

## What remains, across this file and `docs/research/coverage-map.md`

The coverage map after this audit: **76 MATCH, 8 PARTIAL, 2 MISSING, 15 OURS BETTER**. Its ten
open rows and the six partly rows above overlap (45 ↔ R30/R32, 49 ↔ R8, 55 ↔ R24); fix list A's
three open items overlap too (18 ↔ row 38, 37 ↔ D1). De-duplicated:

**(a) Buildable by the agent**

1. ~~R5~~ **done 2026-10-09** (15.6–20.3 s measured; ADR-0092 addendum): the first cited sentence within 20 s on Start writing now — start the first sentence
   before the whole outline is written, or a shorter outline call; measure with
   `apps/web/e2e/_measure`.
2. R5b: an outline prompt (A.9 candidate) that writes H3 sub-sections *and* wins its evaluation
   (`packages/ai/eval/candidates/outline-h3*.md` both lost 0–2). Still open after four tries
   (ADR-0092 addenda 3 and 4): h3c won but emptied the title-only Literature Review; h3d
   (2026-10-09) held it (6 sections every run), tied 1–1 and was faster, but one title-only plan
   of ten had no sub-section, so it failed its written criterion. The round now includes
   title-only cases; next: keep h3d's Literature Review rule, make Methodology sub-sections
   checkable in code.
3. ~~R18~~ **done 2026-10-09** (ADR-0129): file papers added from Discover and from the editor (chat's Add, Find papers, Cite here)
   into the collection chosen in "Add into".
4. ~~Row 55: strengths and questions for the author on the examiner review~~ **done
   2026-10-09** (ADR-0131): `examiner_review.md` with code checks, asked of the chapter's two
   largest sections; rounds 1 and 2 failed, round 3 passed 45/45 and the Flags tab shows them.
   ₹2.10 a review (was ₹1.86). Row 55 stays PARTIAL for ratings only (ADR-0111).
5. ~~R8: the web switch on an edit~~ **done 2026-10-09** (ADR-0133): "Search the literature"
   beside "Use my library" adds the few papers on topic to the library (into "Add into") before
   the edit cites them; same prompt, same COMMAND unit.
6. ~~Row 34: highlights and notes saved on a paper in the reader~~ **done 2026-10-09**
   (ADR-0130, migration 0051): four colours and a note, kept per paper and per student, drawn
   again on reopening, listed beside the paper; to chat or chapter only by the student's press.
7. ~~ADR-0116's small leftovers~~ **done 2026-10-09**: rename a chat, search the chat list.
8. ~~Fix list A29~~ **done 2026-10-09** (three export faults found and fixed; BUILD_LOG): confirm figure and table numbering with cross-references survives every export
   (ADR-0049 built them; the export was not re-checked in this audit).
9. Hindi for Round 2's new strings (the limit message, the chat bar) — the agent's own
   translation now, the native review stays (b).

**(b) Needs the owner — keys, accounts, decisions, nginx**

1. **D1** (fix list 37): count only *kept* suggestions against the allowance — conflicts with the
   cap-before-call rule (§10.2); re-run `docs/COSTING.md` first.
2. **R37**: set the `LIT_REVIEW_BUILD` allowance and turn `literatureReviewBuild` on; run one real
   review against ₹12.92.
3. **R39**: submit add-on 0.3.0 after 0.2.1 is approved; try the live Scholar / PubMed / arXiv /
   MDPI pages first.
4. **Row 80**: the host nginx `/collab/` block and the `collaboration` flag for co-editing in
   production (the owner said leave it).
5. **Row 36**: a live Zotero / Mendeley connection — changes PRD FR-2.9 (file upload, not OAuth);
   Mendeley needs an app registered with Elsevier.
6. **Row 38** (fix list 18): the Springer Nature Open Access API key.
7. **Row 89**: the Hindi native review (`docs/i18n/hi-review.md`) and the next language (Tamil).
8. **Rows 94, 95, 98**: live chat support, video tutorials, a community — who answers, where.
9. **Row 45 / R30 / R32**: done 2026-10-09 (ADR-0132) — a research question with no thesis, and
   "All my theses" as its second source, each citation naming its thesis.
10. **R24 / row 55**: whether to try the score card again at a higher reasoning effort (about
    ₹0.36 a review before reasoning); it must pass `eval-examiner-scores.ts`.
11. **R40 and ADR-0055**: open a Word citation field (one source, and two) in real Word and
    update the fields — no Word on the build machine.
12. **R22**: whether a comment, and a reply, should email.
13. **R36**: a /privacy line saying build and viva ratings reach the team (optional).
14. **The COMMAND allowance** for the edit panel (`docs/PENDING.md`, ADR-0095): Ctrl+J puts edits
    one key away.
15. **Fix list A30**: billing clarity (renewal, cancel, refund) before Razorpay goes live.
16. **ADR-0087**: Scopus / Web of Science / UGC-CARE list files for the indexing filter.
17. Jenni items the owner kept for themselves on 2026-10-07 (study, not build): Jenni on a phone,
    Jenni's Tone of Voice and Proofread results, its error and offline screens.

**(c) Deliberately not built**

1. Paraphrase with tones, "improve fluency" rewording of sourced text, and anything aimed at a
   detector — §12.3 (row 49, R8; `asksToEvadeDetection` refuses it in code).
2. Jenni's faults (inventory §13.7): a citation written twice, a citation moved to another claim,
   a citation after the full stop, silent failures with no retry, an MDPI *issue* saved instead of
   the article, a paid wall that hides the references — each is prevented in code or by design.
3. Citing papers the student never added (Jenni does; ours cites only the library — row 18).
4. Impact factor and cited-by as filters at the start — replaced by indexing at the owner's word
   (ADR-0087, row 4).
5. ResearchGate uploads counted as open access (a licensing grey area; fix list C).
6. The examiner score card on screen — built, evaluated and withheld because the numbers did not
   measure what they claim (ADR-0111); see (b) 10 for a retry.
7. A chat with no thesis — today, by the grounding rule; see (b) 9 if the owner wants it.
8. A "Table of contents" that is only a "/" item: ours is a live contents block that survives
   export (ADR-0119), and the thesis export builds Word's own.
