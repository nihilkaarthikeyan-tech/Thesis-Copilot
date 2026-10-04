# Jenni capability coverage map (2026-10-04)

Research only; nothing was changed. Jenni behaviour is from `docs/JENNI-FINDINGS.md`,
`docs/JENNI-UX-STUDY.md` and `docs/JENNI-FIX-LIST.md`. "Ours" was confirmed by reading the code;
every row names the file(s). Paths are relative to the repo root. `web/` = `apps/web/src/`,
`api/` = `apps/api/src/modules/`, `ui/` = `packages/ui/src/editor/`.

Status: **MATCH** (a student gets the same outcome), **PARTIAL** (exists, but the student meets a
real difference), **MISSING** (no equivalent), **OURS BETTER**.

**Updated after the build (2026-10-04, evening):** 101 rows — 65 MATCH, 18 PARTIAL, 3 MISSING,
15 OURS BETTER (from 16 / 47 / 24 / 14). Rows marked "Built 2026-10-04" were rechecked against
the merged code. The nine still missing wait on the owner (docs/PENDING.md, "Jenni study — what
only the owner can decide"); PARTIAL rows were not re-audited one by one.

## 1. Starting and landing

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 1 | Return lands in last document | Opens the last document, cursor where it was; document list is a side panel | `web/app/app/page.tsx` (dashboard, cards with ten links) | MATCH | Built 2026-10-04: Continue writing opens the last chapter |
| 2 | One-click new document | "+" creates Untitled at once; the empty page is the start screen | `web/app/app/page.tsx`, `web/app/app/new/page.tsx` ("Start writing now"), `web/components/AddProposalPrompt.tsx` | MATCH | Built 2026-10-04 (ADR-0062): "Start writing now" makes the thesis ("Untitled thesis" if no title) and opens its first chapter; "Add a proposal" offered on the list and in the editor |
| 3 | Prompt-first start with strength meter | One prompt box, typed example placeholders, Weak→Great meter per keystroke (no AI) | `web/components/proposal/PathAChat.tsx`, `web/app/app/d/[id]/proposal/page.tsx` | MATCH | Built 2026-10-04: Topic meter, rotating examples, answer options as buttons |
| 4 | Citation preference screen at start | One screen of chips: style, web/library, year, impact factor, cited-by, preprints | Filters exist only in chat "Find papers" (`web/components/editor/ChatPanel.tsx` `Filters`); toggles in `web/app/app/settings/page.tsx` | MATCH | Built 2026-10-04: Optional style at creation, with a live preview |
| 5 | Heading modes (IMRaD / AI headings / none) | Picker before writing | `packages/config/src/templates.ts` (Empirical, Qualitative, By publication), `api/memory/outline.controller.ts` (`outline/generate`), "Fill it in myself" path | MATCH | Ours are thesis structures rather than IMRaD; equivalent choice |
| 6 | Land in full document with notes, cursor ready, first cited sentence in ~15 s | Every heading + per-section notes from the prompt; suggestion appears by itself | `web/app/app/d/[id]/outline/page.tsx`, `web/components/editor/ScaffoldPanel.tsx` | PARTIAL | Topic path lands on Chapter 1 under two banners; no first suggestion; study never reached a cited sentence without leaving the editor |
| 7 | Import from Word to start | "Import from Word (.docx)" puts the text in the document | `api/sources/upload-rules.ts`, `apps/worker/src/jobs/extract-paper.ts` (seed paper → proposal/outline only) | MATCH | Built 2026-10-04: Import from Word into chapters (split at Heading 1) |
| 8 | Earlier answers fold into bubbles with Edit | Yes | `web/components/proposal/PathAChat.tsx` | MATCH | Built 2026-10-04: Edit on an earlier answer; the four-turn bound holds |

## 2. Section prompts

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 9 | Per-section notes panel | Document prompt + bullet notes per heading, editable | `web/components/editor/ScaffoldPanel.tsx` (chapter scope note + sub-heading notes, shown not inserted); edited on the outline page | MATCH | Built 2026-10-04: Assist reads the sub-section note under the cursor (A21) |
| 10 | Configure context per section | Switch sources off or pin chosen sources per heading | `web/components/editor/SourcePins.tsx`, `api/chapters/chapters.controller.ts` (`chapters/:id/pins`) | PARTIAL | Pins are per chapter, not per section; no "web off" switch |
| 11 | Generate for a section | ~5 s, one sentence as a suggestion | `web/components/editor/DraftMode.tsx`, `api/assist/draft.controller.ts` (Ctrl+Shift+D drafts a whole section as a pending draft block) | OURS BETTER | Ours drafts the section, grounded, behind accept/discard |

## 3. Autocomplete

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 12 | Ghost text on a pause | < 3 s | `ui/ghost-text.ts`, `api/assist/assist.controller.ts` (ADR-0053 pause trigger, ADR-0051 model) | MATCH | 2.7–3.4 s vs 1.9–2.8 s first word |
| 13 | Visible Accept / Refine / thumbs on a suggestion | Buttons under the ghost text | `ui/ghost-text.ts` (keys only), Suggest button in `web/components/editor/ThesisEditor.tsx` | MATCH | Built 2026-10-04: Suggestion bar: Accept, One word, Refine, Dismiss, thumbs — works on a phone |
| 14 | Refine presets | Stay on topic, complete paragraph, novelty, simplify, no citations, Validate supporting evidence, Cite from my library | `web/components/editor/GuidedInput.tsx` (Shift+→ free-text instruction) | MATCH | Built 2026-10-04: Five presets on the suggestion bar |
| 15 | Suggestion history / Shift+→ cycle | Arrows step through earlier suggestions | none (Shift+→ is the guided prompt here) | MATCH | Built 2026-10-04: ‹ › on the suggestion bar |
| 16 | Alt+→ accept one word | Yes | `ui/ghost-text.ts` (`Alt-ArrowRight`) | MATCH | — |
| 17 | Ctrl+/ suggest on demand | Yes | `ui/ghost-text.ts`, `ThesisEditor.tsx` | MATCH | Built 2026-10-04: The empty-library notice with a Find papers button |
| 18 | Cited suggestion with an empty library | Cites papers from its own index instantly | `apps/worker/src/jobs/find-sources.ts` (ADR-0037 auto sources), `api/assist/assist.service.ts` (`findingSources`) | PARTIAL | Ours fetches papers into the library first (minutes) and cites only after; Jenni is instant (but cites unadded papers) |
| 19 | Grounding enforced on suggestions | Not enforced; its own review flags its weak citations | `packages/ai/src/builder/postprocess.ts`, `api/assist/assist.service.ts` (`HALLUCINATED_CITE` stripped) | OURS BETTER | — |
| 20 | Ctrl+↑/↓ move block | Yes | none found | MATCH | Built 2026-10-04: Ctrl+Shift+↑/↓ |

## 4. Citations and styles

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 21 | Citation hover card | Title, authors, journal, year, cited-by, impact factor, OA badge, quoted passage, Open quote | `ui/citation.ts` (popover: record, DOI link, full-text/abstract depth, passage, "Open PDF at page N"), `api/sources/sources.controller.ts` (`sources/:id/chunks/:chunkId`) | MATCH | Built 2026-10-04: Cited-by, open-access and citedness badges on the card |
| 22 | Evidence card before accepting a suggestion | Hover a citation inside the ghost text | `ui/ghost-text.ts` (label text only) | MATCH | Built 2026-10-04: Evidence chips and card on the suggestion bar, with badges |
| 23 | Select → Find citations (search panel: All/Discover/Library, sort, filter, passage, Cite/Save) | ~4 s | `web/components/editor/CiteSuggestions.tsx` (on sentence end, library passages, direct/partial), `web/components/editor/CitePicker.tsx` | PARTIAL | 2026-10-04: Find papers from a selection now exists (Papers tab: sort, open-access, Add, Cite here); no matching passage shown per result |
| 24 | `@` cite | Yes | `web/components/editor/CitePicker.tsx`, `api/chapters/citations.controller.ts` (`citations/pick`) | MATCH | — |
| 25 | Style search across 10,000+ | Search, five popular first | `web/components/editor/StyleSearch.tsx`, `packages/citations/src/catalog.ts`, `api/chapters/citation-styles.controller.ts` | MATCH | Also note styles as footnotes (ADR-0029) |
| 26 | Style locale, page numbers toggle, live preview | Per style | `packages/citations/src/render.ts` (locale from style only) | MATCH | 2026-10-04: Citation language (Automatic, UK/US English, German, French, Spanish, Dutch) and a live preview of the style (ADR-0065) |
| 27 | Automatic reference list | At document end; locked on free plan | `web/components/editor/CitationList.tsx`, `packages/export/src/thesis.ts` | OURS BETTER | Never paywalled |
| 28 | Placeholder citation | "/" inserts a placeholder | needs-source notes in draft blocks (`DraftMode.tsx`, `web/app/editor.css` `.needs-source-note`) | MATCH | Built 2026-10-04: Citation-needed placeholder in the “/” menu |

## 5. Finding papers and the library

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 29 | Find papers panel beside the text | ~3 s, suggested query, sort, filter, passage, Cite / Save / Open quote | `ChatPanel.tsx` scope "Find papers" → `api/assist/chat.controller.ts` (`chat/web`) with year/citations/citedness/preprint filters and Add to library | MATCH | Built 2026-10-04: Papers tab beside the text: sort, open-access filter, Add, Cite here |
| 30 | Deep discovery / gap map | (gap-analysis workflow, see 63) | `web/app/app/d/[id]/sources/DiscoverPanel.tsx`, `apps/worker/src/jobs/search-literature.ts` (themes, gap class, OpenAlex density trend, snowballing ADR-0052) | OURS BETTER | But ~80 s with only "Searching…", on a separate page |
| 31 | Library collections | Folders | none | MATCH | Built 2026-10-04: Collections strip, bulk add/remove |
| 32 | Impact factor / cited-by on library items | On each item | `web/app/app/d/[id]/journals/JournalsScreen.tsx` (journal citedness), `DiscoverPanel.tsx` (citationCount on candidates) | MATCH | Built 2026-10-04: Badges on library rows |
| 33 | PDF upload | 10 PDFs, 25 MB | `api/sources/sources.controller.ts` (`sources/upload`), `SourcesScreen.tsx` | MATCH | — |
| 34 | PDF reader: search, side-by-side, open at quote | In-app | `SourcesScreen.tsx` "Open PDF" (signed link, new tab, `#page=N`) | PARTIAL | 2026-10-04: Read beside the chapter at the cited page (wide screens); the browser viewer searches; no highlight of the quoted passage |
| 35 | .bib / .ris / ID import | Yes | `api/sources/sources.controller.ts` (`sources/import`, `sources/resolve`), `packages/retrieval/src/scholarly/bibliography.ts` | MATCH | Plus library export (`sources/export`, `packages/citations/src/library-export.ts`) |
| 36 | Zotero / Mendeley account connection | OAuth import | `SourcesScreen.tsx` "From Zotero" (`ZoteroImport.tsx`), `packages/retrieval/src/scholarly/zotero.ts`, `POST /documents/:id/sources/zotero/{collections,import}` | PARTIAL | Built 2026-10-04 (ADR-0062): Zotero by pasted read-only key, whole library or one collection, up to 500 items, read once, key never stored. Not a live sync (by decision, ADR-0059). Mendeley still file-only (needs an Elsevier app, `docs/PENDING.md`); no live Zotero call made yet |
| 37 | Browser extension | Chrome extension | `apps/extension` (ADR-0031) | MATCH | — |
| 38 | Full-text index across papers | Pre-indexed open-access full text, instant | per-student fetch: `apps/worker/src/jobs/index-source.ts`, Europe PMC (ADR-0054), CORE fallback | PARTIAL | Minutes per paper; Springer outside PMC stays abstract-only (key pending) |

## 6. AI Chat

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 39 | Scopes Web / Library / Current document | Chips, combinable | `ChatPanel.tsx` (Library / This thesis / Find papers; ADR-0016); since 2026-10-04 (ADR-0060) a library question the library has nothing on is answered from the abstracts a scholarly search returns, through the same A.4 prompt, each cited paper marked "Not in your library" with Add | PARTIAL | Built 2026-10-04 (ADR-0060). Still one scope at a time: beyond-library is reached from a library refusal, not combined with the library in one answer |
| 40 | Off / Ask / On permission per source | Asks before searching the web | Settings → "Search beyond my library": Off / Ask first (default) / On (ADR-0060, `beyond-library.ts`) | MATCH | Built 2026-10-04. One setting for the search, not one per source |
| 41 | Agentic answer with visible steps | Plans, searches several times, verifies (~90 s) | one search + one grounded A.4 call, steps streamed ("Searching OpenAlex…", "Reading 8 abstracts", "Writing the answer"), `api/assist/chat.service.ts` `answerBeyond` (ADR-0060) | PARTIAL | Built 2026-10-04. One search, not a multi-step agent; answers from abstracts, not full text. Real-model check pending (`docs/PENDING.md`) |
| 42 | Attachments and images in chat | Attach file/image | none | MISSING | — |
| 43 | Saved prompts | Yes | `web/components/editor/ChatPrompts.tsx`, `api/prompts/prompts.controller.ts` (`/` in chat) | MATCH | — |
| 44 | Name a paper in chat | — | `web/components/editor/ChatMentions.tsx` (`@`) | OURS BETTER | — |
| 45 | Chat history across documents | One account-wide chat | `api/assist/chat.controller.ts` (`chat/:documentId`, `clear`) | PARTIAL | 2026-10-04: Deliberate: chat is per thesis because it answers from that thesis's own library |
| 46 | Add answer to document | Copy / Add to document | `ChatPanel.tsx` "Add to document" (citations become nodes) | MATCH | Built 2026-10-04: Copy on a chat answer |
| 47 | Empty chat guidance | Blank | `ChatPanel.tsx` (scope blurb, placeholder per scope) | OURS BETTER | — |
| 48 | Off-topic refusal | — | `RELEVANCE_FLOOR` in `packages/retrieval`, refund | OURS BETTER | — |

## 7. AI Edit and the selection menu

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 49 | AI Edit actions (17) | Fluency, paraphrase, simplify, strengthen, counter-argument, tense, lists, prose, table, translate, academic, formality, precision, hedge/increase confidence | `web/components/editor/CommandToolbar.tsx` (Expand, Formalise, Simplify, Shorten, Check consistency), `api/assist/chat.controller.ts` (`commands/run`, `citations/role`) | PARTIAL | 2026-10-04: 11 now — the five section commands plus hedge, more direct, active, past, present, counter-argument (ADR-0066); no to-table or translate |
| 50 | Selection → Find citations | Yes | CiteSuggestions fires on sentence end only | MATCH | 2026-10-04: Find papers on a selected sentence opens the Papers tab searching it |
| 51 | Selection → AI Chat | Yes | none | MATCH | Built 2026-10-04: Ask chat on a selection |
| 52 | Selection → Comment (by the writer) | Inline box under the text | comments created only by the guide (`web/app/guide/[token]/page.tsx`, `api/feedback/feedback.controller.ts`) | MATCH | Built 2026-10-04: Comment on a selection |
| 53 | Selection → Review | Yes | none (checks run per chapter) | MATCH | 2026-10-05: "Examiner review" on a selection — one section command, flags on its sentences (ADR-0067) |

## 8. Reviews

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 54 | Claim confidence | Agent searches databases, flags unsupported claims and weak citations, 22 s | `api/coherence/coherence.service.ts` (UNSUPPORTED_CLAIM, CITATION_SUPPORT ADR-0023), `web/components/editor/FlagsPanel.tsx` | PARTIAL | Checked against the library only; no new supporting source proposed |
| 55 | Peer review (ratings, strengths, weaknesses, questions) | One button | examiner review inside chapter build only (`api/chapter-build/chapter-build.service.ts`); viva questions (`api/viva/viva.service.ts`) | MATCH | Built 2026-10-04: Examiner review of a chapter (ADR-0056) |
| 56 | Source quality | Card | `web/components/editor/ReferenceHealth.tsx` (retracted, stale, duplicate, unverifiable), `web/app/app/d/[id]/citations/CitationReport.tsx` | OURS BETTER | — |
| 57 | Tone of voice (can take a library PDF as model) | Card | `web/components/onboarding/WritingProfile.tsx`, `api/memory/style.service.ts` (profile steers suggestions) | PARTIAL | No review of existing text against a tone |
| 58 | Proofread | British spelling | `web/components/editor/ProofreadPanel.tsx`, `api/assist/chat.controller.ts` (`proofread`, `correctionSize` guard) | MATCH | — |
| 59 | Results as tracked changes, Y/N keys, Accept all | Review mode | per-item diff + Apply (`ProofreadPanel.tsx`, `CommandToolbar.tsx`); j/k/a keys for supervisor comments (`web/app/app/d/[id]/review/ReviewQueue.tsx`) | PARTIAL | 2026-10-04: Proofreading has Accept all (one undo) and Y / N keys; coherence and examiner flags do not |
| 60 | One Review panel | Five cards, one button each | Flags tab, Review tab, coherence, proofreading, `/citations`, `/originality`, `/submit` | MATCH | Built 2026-10-04: Every check in one list on the flags tab |
| 61 | Paraphrase-closeness check | — | `web/components/editor/ParaphrasePanel.tsx`, `api/chapters/chapters.controller.ts` (`paraphrase`), `/originality` | OURS BETTER | — |

## 9. Workflows

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 62 | Literature review workflow | Topic → filters → 4 stages, 15–20 min, per-section expert brief (failed in test) | `web/app/app/d/[id]/build/page.tsx`, `api/chapter-build/chapter-build.service.ts`, `apps/worker/src/jobs/chapter-build.ts`, `packages/ai/src/checks/` | OURS BETTER | Ours checks and delivers pending blocks with a QA report; lacks Jenni's topic-specific brief per section |
| 63 | Research gap analysis by claims | 15 claims: under-explored / contested / well-supported, supporting + contrasting citations, direction, "Limits" note | `DiscoverPanel.tsx` (themes by counts, ADR-0041/0046) | PARTIAL | We reason over counts, not claims; "why open" left to the student |
| 64 | Run in background with stages, clock, "we will email you" | Yes | chapter build in worker (stages on build screen); Discover shows stages and a clock; since 2026-10-04 (ADR-0058) one email when a search, build, examiner review or coherence check ends after a minute with no visible tab watching | MATCH | Email unverified against a real mailbox (`docs/PENDING.md`) |
| 65 | "How was this document?" thumbs | After a workflow | `api/assist/assist.controller.ts` (`outcome` telemetry), Feedback box | MATCH | 2026-10-04: Thumbs on suggestions, chat answers and drafted sections |

## 10. Inserting things

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 66 | "/" insert menu | Text, headings, lists, table, image, equation, chart, TOC, AI declaration, placeholder, cite | toolbar `web/components/editor/FormatToolbar.tsx` | MATCH | Built 2026-10-04: “/” menu |
| 67 | Table | Yes | `FormatToolbar.tsx` (+ merged cells, ADR-0029 era) | MATCH | — |
| 68 | Image | Yes | `FormatToolbar.tsx` figures, pasted screenshots, `api/chapters` `figures` | MATCH | — |
| 69 | Equation by LaTeX with examples | KaTeX with Quadratic / Maxwell / Piecewise | `ui/math.ts`, `FormatToolbar.tsx` (one LaTeX line, "E = mc^2") | MATCH | Built 2026-10-04: Examples and live preview in the equation field |
| 70 | Equation described in words | Yes | none | MATCH | 2026-10-04: Describe it in words in the equation field; KaTeX-checked LaTeX, read back, Apply to insert (ADR-0063) |
| 71 | Equation from a picture | Yes | none | MATCH | 2026-10-04: "Or take a photo of it" in the equation field; transcribed, KaTeX-checked, Apply to insert (ADR-0064) |
| 72 | Chart | From chat / insert | `web/components/editor/ChartDialog.tsx`, `packages/ui/src/charts/` (ADR-0027) | MATCH | — |
| 73 | Table of contents in the document | Insert | export only (`packages/export/src/thesis.ts`, real Word TOC) | MATCH | 2026-10-04: The open chapter's headings listed under it, live, each a jump |
| 74 | AI declaration block | Inserts a statement | `api/export/export.controller.ts` (`export/ai-usage-log`), `packages/export/src/ai-usage.ts` | MATCH | Built 2026-10-04: AI declaration block from the “/” menu |
| 75 | Footnotes, cross-references, diagrams | — | `ui/footnote.ts`, `ui/cross-ref.ts`, `web/components/editor/DiagramDialog.tsx` (ADR-0049) | OURS BETTER | — |
| 76 | Markdown / KaTeX help tabs | Yes | key hints strip in `ThesisEditor.tsx` | MATCH | Built 2026-10-04: Equation cheat sheet |

## 11. Collaboration and history

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 77 | Version history with preview and restore | Snapshots, author, Restore | `web/components/editor/VersionHistory.tsx`, `api/chapters/chapters.controller.ts` (`versions`, `restore`, Ctrl+S snapshot, undo banner) | MATCH | Ours adds undo of a restore |
| 78 | Roles editor / commenter / viewer | By invitation or link | `web/components/editor/ShareButton.tsx` (guide = read+comment, `canEdit` co-author), `api/feedback/feedback.controller.ts` | MATCH | Built 2026-10-04: Guide / co-author / reader roles (ADR-0057) |
| 79 | Link access ("anyone with the link") | Yes | none (deliberate: "no secret link") | MATCH | Built 2026-10-04: Read-only link, off by default (ADR-0057) |
| 80 | Live co-editing with named cursors | Yes | `web/lib/collab.ts`, `web/components/editor/CoAuthorEditor.tsx`, `api/collab` (ADR-0028) | PARTIAL | Off by default (flag), only for documents with a co-author; prod needs nginx `/collab/` |
| 81 | Document cloning | Yes | none in `api/documents/documents.controller.ts` | MATCH | Built 2026-10-04: Make a copy (ADR-0057) |
| 82 | Read-only sharing | Yes | guide pages `web/app/guide/[token]/`, progress view (`guide/documents/:id/progress`) | MATCH | — |
| 83 | Comments | Inline box under selection | supervisor comments, `web/components/editor/ReviewPanel.tsx`, review queue, `.docx` comment import (`api/feedback/docx-import.service.ts`) | MATCH | Built 2026-10-04: The writer comments on a selection |

## 12. Export and import

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 84 | Word export with native citation fields or hyperlinks | Linked to Word's References | `packages/export/src/docx.ts`, `packages/export/src/thesis.ts` (citations as plain text) | MATCH | Built 2026-10-04: Live Word citation fields (ADR-0055) |
| 85 | LaTeX with layouts | Four layouts + options | `packages/export/src/latex.ts` (one, spacing from the template) | OURS BETTER | 2026-10-04: Deliberate: the thesis LaTeX follows the university template (report class, its margins, fonts, numbering); a two-column paper layout does not apply to a thesis |
| 86 | PDF / university template / compliance | — (no template) | `packages/export/src/compliance.ts`, `api/export/thesis-export.service.ts` (docx/pdf/latex/html), Gotenberg, `packages/export/src/word-math.ts` | OURS BETTER | — |
| 87 | Copy to clipboard | Copy button | browser copy only | MATCH | 2026-10-04: A copy reads citations as their labels in Word / Docs; pasting back restores them |
| 88 | Bibliography on free plan | Dropped from free exports | always included | OURS BETTER | — |

## 13. Settings, account, usage

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 89 | Interface languages (16 incl. Hindi) | Yes | `web/i18n/` (typed catalogues, English fallback; ADR-0061): English and Hindi (beta) on the student's main screens — list, new thesis, proposal, editor chrome, Settings, Account, sign-in; picker in Settings and on sign-in; separate from the document language (`api/documents/documents.controller.ts` `:id/language`) | PARTIAL | Built 2026-10-05: two languages, not sixteen; Hindi awaits a native speaker's review (`docs/i18n/hi-review.md`); editor side panels, help and admin stay English |
| 90 | Themes (7 incl. high contrast) | Yes | `web/components/theme.tsx` (light / dark / system) | MATCH | Built 2026-10-04: High contrast switch, works with light/dark |
| 91 | Document defaults (autocomplete, style, font) | One dialog | `web/app/app/settings/page.tsx` (auto-suggest, auto-cite, auto-sources) | MATCH | 2026-10-04: Default citation style for new theses in Settings (font follows the university template) |
| 92 | Usage bars per allowance | Account menu | `web/app/app/account/page.tsx` (bars), `api/usage/usage.controller.ts`, editor header meter | MATCH | Refund on relevance-floor refusal |
| 93 | Account delete / email change | Yes | `api/account/account.controller.ts` (delete with 7-day cancel, email move ADR-0015, password ADR-0033) | OURS BETTER | — |

## 14. Help, platform, accessibility

| # | Capability | Jenni | Ours | Status | Gap for the student |
|---|---|---|---|---|---|
| 94 | Live chat support | Intercom | Feedback box, `web/app/contact/page.tsx` | MISSING | — |
| 95 | Video tutorials | 11 by topic | `web/components/onboarding/HowSuggestionsWork.tsx` (one 90-second explainer) | PARTIAL | — |
| 96 | Documentation | Full docs site | `FirstRunHint.tsx` hints only | MATCH | Built 2026-10-04: /help, nine articles |
| 97 | Changelog | Every ~2 weeks | none | MATCH | Built 2026-10-04: /changelog |
| 98 | Community (Discord) | Yes | none | MISSING | — |
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

| Status | Count |
|---|---|
| MATCH | 16 |
| PARTIAL | 47 |
| MISSING | 24 |
| OURS BETTER | 14 (in the table), plus the 15 areas in section 15 |

(101 rows in sections 1–14.)

## MISSING and PARTIAL, by how often a student would hit them

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
