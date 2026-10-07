# Jenni — full inventory, button by button (2026-10-07)

Explored in the owner's own Chrome, signed in to their free Jenni account, at the owner's request
("open and use and check every flow… what things and buttons they have and how user friendly they
are"). Explored in a new test document; the owner's own documents, billing and account settings
were opened to read, never changed. The free account's limits at the start: uploads 1/10, AI
autocompletes 0/10, AI edits 0/3, AI chats 4/5, reviews 2/3, workflows 1/3 — so menus and screens
were opened freely and AI actions spent only where watching one mattered.

Each row: what Jenni has · where · how it behaves · ours today · gap.

## 1. Account menu (click the name, top left)

| Jenni | Detail | Ours | Gap |
|---|---|---|---|
| Settings, Logout | Two items at the top | Settings / Account pages, Sign out in the header | Layout only |
| **Usage bars in the account menu** | Upload limit 1/10, AI Autocompletes 0/10, AI Edits 0/3, AI Chats 4/5, Reviews 2/3, Workflows 1/3 — each a coloured bar (green → red as it fills), "See Pricing" under them | Usage on the Account page; "Assist 0/50 · Draft 0/2" in the editor header | Ours is a page away; theirs is one click from anywhere |

## 2. Settings dialog (one modal, four tabs)

| Tab | Jenni | Ours | Gap |
|---|---|---|---|
| Account | Email + Change; sign-in method; current plan + Upgrade; Danger zone: Delete account | Account page: email change, password, delete account | Same substance |
| Preferences | Interface language (16); Appearance: System, Light, Dark, Paper Light, Paper Dark, High Contrast Light (beta), High Contrast Dark (beta); **Search permissions: Web search Off/Ask/On, Library search Off/Ask/On**; Privacy: Manage cookie preferences | Language (English, Hindi beta); light/dark/system + high contrast; "Search beyond my library" Off/Ask/On | Fewer themes and languages; ours is a page, not a modal |
| Connections | **Zotero Connect**, **Mendeley Connect** (account sync), Chrome extension Install | Zotero by pasted key (one-off import); no Mendeley; add-on pending store | Live account connections |
| Document Defaults | Autocomplete on/off; default citation style; **default font style: Default / Serif** | Auto-suggest setting; style per thesis | Font style choice |

## 3. Documents (sidebar)

| Jenni | Detail | Ours | Gap |
|---|---|---|---|
| Documents panel in the sidebar | Search docs; each row: title, date, "Opened 1 hour ago"; **+** new; archive icon | Theses list page (`/app`) | Theirs is a side panel beside the open document; ours is a separate page |
| Row menu (hover → …) | **Open in new tab, Duplicate, Archive** | Copy, Delete | No archive (soft delete) or open-in-new-tab |
| Archived documents | Popover list, restorable | — | Missing |

## 4. Library (sidebar panel)

| Jenni | Detail | Ours | Gap |
|---|---|---|---|
| Sources / Collections tabs, search | Panel beside the document | Sources page + Sources tab in the editor | Similar |
| **Filter** popover | PDF status (Any/Has PDF/No PDF), Publish year (All/Last 5 years/Custom), Impact factor (All/0.25+/3+/10+), Open access (Any/Open/Not open), Collection (Any/No collection), Types (Article, Book, Webpage, Document… View all) | Chips: All / Full text / Without full text / Needs a hand; collections | Year, open-access and type filters in the library |
| Each item | Type badge (Article), impact factor badge, title, authors, journal · year; **Add to collection**; **Cite** (inserts at the cursor at once); **Details**; **Open PDF ▾** | Title, authors, badges (cited-by, open access, citedness), Read, PDF, Remove | Cite-from-library one click |
| **Details drawer** | Ask AI, Edit, ↑↓ to step through papers; title, authors, journal, year, cited-by, impact factor, volume/issue, accessed date; full-text file with Open PDF / delete; collections +; DOI and URL with copy buttons; abstract | Reader page (`/sources/:id`) | No quick drawer; no step-through |
| **Edit metadata form** | Content type, article type, title, short title, abstract, access date, every contributor (role, family, given, delete/add), DOI, URL, language, status; Cancel/Save | — (only "Needs a hand" fixes an unresolved reference) | **Missing: editing a paper's details** |
| Upload dialog | Upload PDFs (10 at a time, 25 MB, 150 pages), Zotero, Mendeley, Import .bib/.ris, **Paste ID**; choose the collection first | Add a PDF, Import .bib/.ris, From Zotero | Paste a DOI/ID; pick collection on upload; Mendeley |
| Collections tab | Empty state + new-collection button | Collections strip on the Sources page | Similar |

## 5. Find papers (sidebar panel)

| Jenni | Detail | Ours | Gap |
|---|---|---|---|
| Search box | "Search 250M+ papers"; **"Suggested from your document"** (the document title as a one-click search) | Papers tab: free search + thesis title offered | Similar |
| Sort | Relevance, Most Recent, Oldest, Most Cited | Relevance only | **Sort** |
| Filter | Publish year as a **decade grid** (2020–2029 with ‹ › to change decade), Cited by (All/5+/20+/50+) | Year from/to, minimum citations, citedness, preprints (chat filters) | Theirs is quicker to tap |
| Each result | Type, Cited by, Impact factor, **Open Access** badges; title, authors, journal · year; the **matching passage** with "See more"; **Cite**, **Open quote** / **Scroll to quote**, **Save ▾** | Passage, Add, Cite, Read | Close |
| **Open quote** | Opens the PDF **beside the document**, scrolled to the passage, highlighted; top: Add to Library, Chat; bottom: Open in new tab, thumbnails, ‹ page ›, go to page, zoom −/+ | Reader page (full screen) with search and Cite; "Read beside" pane | **Quote-highlighted PDF beside the writing** |

## 6. Workflows (BETA)

| Jenni | Detail | Ours | Gap |
|---|---|---|---|
| Literature review | Three steps, each folding to a bubble with Edit: topic (with prompt meter) → sources (Web search, Library search, limit to a collection) → filters (year, impact factor, cited by, preprints) → **"Start literature review · 15–20 min"**; makes a new document | Chapter build (plan → build → QA report); Draft a section | Theirs is a whole cited review from one prompt |
| Research gap analysis | The output document: summary line, **table of claims** (Claim · Status · Evidence · Suggested direction), then sections Under-explored / Contested / Well-supported / Directions / **Limits of this retrieval**, then References (APA, 39) | Claims map on the Discover tab | Theirs is a **document** the student can edit; ours is a panel |
| Recent runs | Listed under the workflows | Build list on the Build page | Same idea |
| "How was this document?" | Thumbs prompt on a generated document | — | Feedback on generated output |
| **References are paid** | "References are a paid feature. Upgrade to view, copy, and export references." | Bibliography free in every plan | **Ours is better** |

## 7. Shortcuts window (three tabs)

| Tab | Jenni | Ours |
|---|---|---|
| Shortcuts | → accept; **Shift+→ cycle suggestions**; Ctrl+/ call a suggestion; Alt+→ accept one word; **Ctrl+J = AI Edit on a selection, AI Chat without one**; Ctrl+↑/↓ move block; Ctrl+\ sidebar; **Ctrl+K show toolbar**; **@ add a citation** | Tab accept, Esc dismiss, Ctrl+/ suggest, ‹ › history, Ctrl+Shift+↑/↓ move block, Ctrl+Shift+D draft, "Keyboard shortcuts" help |
| Markdown | # … #### headings, * / - bullets, 1. numbered, \| header \| table, `code`, ``` code block, $$equation$$ … | Some Markdown input rules (TipTap defaults) — not listed for the student |
| KaTeX | √, Σ, ∫, Greek, matrix, limit, derivative… with the LaTeX for each | Maths cheat sheet in the equation box |

## 8. Help, tutorials, New

| Jenni | Detail | Ours | Gap |
|---|---|---|---|
| **New ▾** | Create new document (create or import), **AI chat** (a new conversation, no document), Upload ▸ (to library) | "Start writing now" / proposal on the theses page | A chat without a thesis; one New menu everywhere |
| Tutorials | 11 YouTube videos: Getting Started, Documents & Outlines, AI Autocomplete, AI Edit, Citations & References, Reference Library, AI Chat, Collections & Auto-Cite, Smart Citations, Export & Publish, Real-Time Collaboration | One "How suggestions work (90 s)" | Videos |
| Help ▾ | Send us a message (live chat), Video tutorials, Help documentation, Changelog, Join us on Discord | Help page, What's new, Feedback | Live chat, community |

## 9. New document flow (seen again, in a test document)

| Step | Jenni | Ours (v0.1.31) | Gap |
|---|---|---|---|
| Prompt | "Fill document prompt" box, Weak→Great meter, **Import from Word (.docx)**, "Skip and start writing", Explore cards (Chat with AI, Upload sources) | Title + topic meter, Import from Word on `/app/new`, Start writing now | Same |
| Preferences | Style (dialog: most popular + **Show all styles**, **locale list**, **page numbers in citations** switch, live preview of in-text, bibliography and captions), web/library search, Configure context (select sources), year, impact factor, cited by, preprints | Style chips, web/library search, year, **indexing**, preprints | Locale and page-number switch at the start; select sources at the start |
| Structure | IMRaD / Smart / None | Smart / Standard / None | Same |
| After Start | **Title written from the prompt**; "Analyzing your topic…" skeleton ~10 s; headings **with sub-headings** (H3 under H2); section prompts on the left with notes; "Jenni AI" cursor tag; **first cited suggestion ~18 s**, citing two papers | Chapters planned, sections as headings (H2), opener under the first heading (~40 s locally) | Jenni writes a document title; sub-headings; faster first sentence |

## 10. The editor

| Area | Jenni | Ours | Gap |
|---|---|---|---|
| **Suggestion bar** | Accept → · **Refine suggestion** · thumbs. After Accept, the **next suggestion comes at once** (a third paper cited) | Accept · One word · Refine · Dismiss · history arrows · thumbs · evidence | Ours has more; theirs chains straight on |
| **Refine presets** | Free prompt box + Write: Stay on topic, Complete this paragraph · Refine: Increase novelty, Simplify language · Citations: **Re-write without citations, Validate supporting evidence, Cite from my library** | Shorter, More formal, Closer to topic, Complete paragraph, Contrasting finding, own words | **Citation presets**, Increase novelty, Simplify |
| Citation hover card | Type, **Open access**, title, authors, year, abstract + See more, **View** | Evidence card: the quoted passage, Read | Similar |
| **Block handle** (+, drag, AI Edit beside every paragraph) | **+** insert; **drag handle** menu: Turn into (Text, H1–H4, numbered, bulleted, code, table, quote), Cite, **Highlight (Amber/Green/Blue)**, AI Chat, AI Edit, **Review** (Claim confidence, Peer Review, Source Quality, Tone of Voice), Duplicate, Delete; **AI Edit** on the block | Ctrl+Shift+Up/Down only; no handle | **Missing: the block handle and its menu** |
| **AI Edit** (on a block, or Ctrl+J on a selection) | A prompt box with **Web / Library switches** and +; presets — Strengthen writing: **Improve fluency (Fix flow issues, Add transitions, Remove redundancy)**, **Paraphrase / Simplify (Academically, Casually, Persuasively, Boldly, Friendly)**, **Strengthen argument**, Add a counter argument; Transform: **Change tense (Past/Present/Future)**, Convert to bullet list / numbered list / prose / table, Translate (English, Spanish, German, French, Chinese, Japanese — no Indian languages); Academic style: Increase formality, **Technical precision**, **Increase claim confidence**, Hedge claim confidence | Selection toolbar: Expand, Formalise, Simplify, Shorten, Consistency + More edits (Hedge, More direct, Active voice, Past/Present tense, Counter-argument, Translate, As a table) | Ours lacks: fluency trio, paraphrase tones, strengthen argument, bullet/numbered/prose conversions, technical precision, increase confidence, a free prompt box with web/library switches |
| **AI Edit result** | "Thought for 5 s", **See edits** (red/green diff), thumbs, the text, **"What changed and why"** (bullet reasons), a **follow-up box to refine again**, then Replace selection / Insert below / Try again / Discard | Diff, Replace / Insert below / Try again / Discard | **"What changed and why"; follow-up refine** |
| **Selection menu** | Find citations, AI Chat, AI Edit, Comment, Review, word count | Find papers, Ask chat, Comment, the edits, Examiner review | Close |
| "/" menu | Text, H1–H4, bulleted, numbered, code, table, image, equation, chart, block quote, horizontal rule, **Table of Contents**, AI Declaration | Table, equation, display equation, chart, diagram, figure, footnote, headings, lists, quote, AI declaration, citation needed | Table of Contents block; horizontal rule |
| Toolbar | Undo/redo, block type, B I U S, code, sup/sub, link, **text colour**, Highlight, Cite (@), image, table, code block, inline equation, math block, chart; Autocomplete menu + switch | Similar + diagram, footnote | Text colour |
| **Autocomplete settings** (in the document) | Sources (web, library, select sources) and citation filters, **changeable any time** | Only at the start (ADR-0087) | **Change preferences inside the editor** |
| **Section prompts panel** (left) | Document prompt (editable); per section: notes, info, **expand to full view**, **Configure context (Disable sources / Select sources)**, **Generate** | Chapter rail + "What this chapter is for" + Draft this section + per-section pins | Theirs keeps every section's notes in one left panel, always visible |
| More-options menu | **Comments, Export (Word or LaTeX), Copy to clipboard, Version history, Document settings** | Spread across header and pages | One menu |
| Export dialog | Word / LaTeX; in-text: **MS Word native citations** or **Hyperlink citations**; **layout presets: Jenni default, Double-spaced manuscript…**; **live page preview**; Download | Submission page: plain / linked / Word citations; template; PDF, LaTeX, HTML | **Live preview and layout presets** in one dialog |
| Document settings panel | Document prompt, sources, citation filters, citation style, **font style** | Citations tab (style, locale) | Font style |
| Review panel | Four cards with Run review: **Claim confidence** (missing/weak citations, adds references against plagiarism), **Peer Review**, **Source Quality** (retractions, preprints), **Tone of Voice**; settings dialog per review (sources, filters) | Check tab: examiner review, proofread, tone, citation support, coherence, originality | Source quality (retractions/preprints) as a check |

## 11. AI Chat panel

| Jenni | Ours | Gap |
|---|---|---|
| **Thread history** (open a previous thread), New Chat; the conversation **continues across documents** | One chat per thesis | Thread history |
| "+ Add context": **Sources, Collections, Citation filters**, Web search Off/Ask/On, Library search Off/Ask/On | Scopes (library / this thesis / find papers), @ mentions, filters | Pick a collection as context |
| Chips under the box: Web Ask, Library Ask, **Current document** (removable) | Scope buttons | Similar |
| Attach file, **image**, saved prompts, Send | Attach (files and pictures), / prompts | Same |
| Answer: Copy, **Add to document**, thumbs, **"17 sources · APA" expander** with References / Sources tabs (formatted references are paid) | Copy, Add to document, thumbs, cited passages | Sources expander |

## 12. Flows from the new-document page (2026-10-07, clicked through end to end)

The page a new document opens on: the document title "Untitled", a **document prompt** box (a
chevron, a Weak→Great meter, the hint "This prompt is used to ensure autocomplete suggestions are
relevant to your topic", placeholder examples that rotate), **Import from Word (.docx)**, **Next**,
**Skip and start writing**, and two Explore cards, **Chat with AI** and **Upload Sources**. Every
path from it, in test documents only:

| # | Path | What happens, step by step | Time | UX notes |
|---|---|---|---|---|
| A | **Prompt → Next** | Preferences (style, web/library search, select sources, year, impact factor, cited by, preprints) → structure (IMRaD / Smart / None) → Start writing → title written from the prompt, "Analyzing your topic…" skeleton, headings with sub-headings, section prompts filled on the left, first cited suggestion | Headings ~10 s, first suggestion ~18 s | Section 9. Every step folds into a summary line you can reopen |
| B | **Import from Word** | Choose a .docx → it shows as a chip with × → Next is enabled **without a prompt** → preferences → **Start Writing** (the structure step is skipped: the file is the structure) → the Word title becomes the document title, each H1 a section with its own section prompt | ~5 s for a short file | The right panel warns at once: "No citations found — your document must include a references section (e.g. 'References' or 'Bibliography') for citations to be matched." It tells the student why, not just that |
| C | **Skip and start writing** | An empty editor: "Untitled" placeholder title, cursor in the body. Left: Document prompt (folded, empty: "Describe your paper's topic and purpose") and Section prompts ("Your document has no sections — Add headings to access section prompts"). Right: the Review panel (four cards). Autocomplete switch on | Instant | No prompt, no library, nothing set up — and it still writes with citations (web search is on by default) |
| C1 | … type half a sentence and stop | "Urban heat islands raise night-time temperatures in Indian cities because " → a grey continuation **finishing that sentence** and the next, with a citation (Kumar et al., 2017), the "Jenni AI" cursor tag, and Accept → / Refine suggestion / thumbs | **Under 4 s** after the last key | **It completes mid-sentence**, not only after a full stop. Escape removes it; it does not ask again until you type |
| C2 | … open Autocomplete ▾ | Autocomplete settings: Web search, Library search, Configure context (Select sources), Publish year (All / Last 5 years / Custom), Impact factor (All / 0.25+ / 3+ / 10+), Cited by (All / 5+ / 20+ / 50+), Include preprints | Instant | The start step's preferences, changeable at any time in the document |
| C3 | … type "## Literature Review" | It becomes an H2 and **appears in Section prompts at once**, with "Guide AI for this section, e.g. key arguments, tone, focus areas…", an info icon, expand, **Configure context** and **Generate** | Instant | A fault: a suggestion fired after the heading text and continued the *previous* paragraph's sentence under the heading |
| D | **Chat with AI** card | Opens the chat panel. All Chats: a searchable history of threads. "/" in the box: "No saved prompts" → Create and manage prompts → Create Prompt (Command + Prompt, Cancel / Submit) | Instant | Chat is offered before a word is written |
| E | **Upload Sources** card | Upload to Library: Connect **Zotero** account, Connect **Mendeley** account, Import .bib/.ris (paste, or select a file), **Paste ID** (DOI, PMID, arXiv, ISBN, with examples) → "Metadata found" (title, authors, journal) → Reset / Import to Library | Lookup ~2 s | Every way in, in one dialog, from the first page |
| F | "…" menu (blank document) | Only Version history and Document settings (Comments, Export and Copy appear once there is text) | — | The menu grows with the document |
| G | See Pricing | Annual / Monthly. Plus ₹570.83/mo annual (₹1,141.67 monthly): 5,000 autocompletes, 500 edits, 500 chats, 10 reviews, 10 workflows, unlimited PDFs (100 MB / 500 pages), library export .bib/.ris/.csv, .docx/.tex, live chat, 2.6k styles. Pro ₹1,379.58 (₹2,759.17): unlimited, 1,000 pages, priority support. "50% India discount" | — | Prices in rupees, the discount named |
| H | Connection | A "Reconnected… synced" toast after a network blip | — | Tells you nothing was lost |

### What the flows show against ours

| Jenni | Ours (v0.1.31) | Gap |
|---|---|---|
| Autocomplete finishes a **half-written sentence** within ~4 s of a pause | Automatic suggestions fire only at a sentence boundary (after `.`, `!`, `?`) or in an empty paragraph (`atSentenceBoundary`, `packages/ui/src/editor/ghost-text.ts`); mid-sentence needs the button or shortcut | **The biggest difference in how writing feels** |
| Skip everything and write; cited suggestions from the web with no prompt | A title is required (`/app/new`); then the setup steps | Ours asks for more before the first word |
| Import from Word skips the structure step; warns when there is no references section | Create and import from Word opens the chapter with the import | Check our import says why citations were not matched |
| A heading typed in the page becomes a section prompt at once (notes, context, Generate) | The chapter rail lists headings; per-section pins (ADR-0085); Draft this section | Build-list item 5 |
| Chat and Upload Sources offered on the first page | Library and chat are inside the thesis | Offer both on the start page |
| Autocomplete settings in the toolbar | Only at the start | Build-list item 4 |

## 13. What to build next, in order (owner to confirm)

1. **The block handle (+, drag, AI Edit) on every paragraph** with its menu — Turn into, Cite, Highlight, AI Chat, AI Edit, Review, Duplicate, Delete. The single most visible difference in the writing area.
2. **AI Edit as Jenni has it**: a prompt box on any selection or block (Ctrl+J) with web/library switches, the grouped presets (fluency trio, paraphrase/simplify tones, strengthen argument, tense, list/prose/table conversions, technical precision, confidence up/down), and the result with **"What changed and why"** and a follow-up box.
3. **Refine presets for citations**: Re-write without citations, Validate supporting evidence, Cite from my library; plus Increase novelty, Simplify language.
4. **Preferences in the editor** (an Autocomplete settings panel): change web/library search, year, indexing, preprints any time.
5. **Section prompts panel** on the left: every section's notes visible, editable, expandable, Configure context, Generate.
6. **Library**: edit a paper's details; year/open-access/type filters; Paste ID; sort Find papers by recent or most cited.
7. **Small ones**: Table of Contents block, highlight colours, text colour, font style, archive documents, thread history in chat, a document title written from the prompt, sub-headings in Smart headings.
8. **From the flows (section 12)**: autocomplete that finishes a half-written sentence after a
   pause, not only after a full stop — ranked first of everything here, since it is what a student
   feels on every line; let a student start writing without a title (it can be written later from
   the text); Chat and Upload Sources on the start page; say why citations were not matched after
   a Word import.

Where ours is already ahead and should stay so: references free (Jenni charges for them), the proposal path, chapter build, viva practice, guide sharing and live progress, Indian context (Hindi, the indexing filter; Jenni translates into no Indian language), examiner review, gap and claims maps, deep research.
