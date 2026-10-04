# Jenni AI public documentation: complete digest

Read 2026-10-04 from https://docs.jenni.ai/ (the sitemap at `/sitemap.xml` lists every page). Research only; paraphrased, not copied.

**Coverage.** 36 articles read in full, plus the 7 section index pages, the home page and the docs index (which carry only titles and one-line blurbs). Each article's FAQ block was read too; FAQ facts that add something are folded into the bullets below.

**Failed URLs: none.** All 43 sitemap URLs returned 200. Two slugs differ from the names in the brief:
- "Generate Headings" is at `/docs/writing/outline-builder/`.
- "Read-only sharing" is at `/docs/collaboration/publishing/`. That page now says published links have been retired in favour of a Viewer link.

**Contradictions inside Jenni's own docs.** These are worth knowing before anyone quotes them:
- **Autocomplete scope.** It is called a per-document toggle under Document settings, and also an account-wide switch in Settings and the FAQs.
- **Number of citation styles.** The citation page says 10,000+ (searching the Zotero CSL repository). Settings says 1,700+.
- **Usage counter location.** The autocomplete page says the counter is in the settings panel. Billing says Settings > Usage.
- **Plan table vs features.** The plan table marks "Citation styles" and "All export formats" as paid-only, yet the editor pages describe CSL search and LaTeX export with no plan gate. The only gate the export page spells out is the appended bibliography.
- **Limit reset.** The autocomplete page says limits reset each billing period. Billing says free autocompletes reset daily at midnight UTC.

---

## 1. Getting Started

### 1.1 Introduction (`/docs/getting-started/introduction/`)
- **How Jenni describes itself:** an editor plus AI for drafting, editing, citing and reviewing. The seven headline features are Autocomplete, Chat, AI Editing, Citation Management, Library, Reviews and real-time collaboration.
- **First-document flow:** click **+ New**, then enter a topic/document prompt or choose a DOCX, then **Next** (or Ctrl/Cmd+Enter), then citation preferences, then the outline structure, then **Start Writing**. Press → to accept an Autocomplete suggestion.
- **New-document setup** is a focused, conversational flow:
  - The prompt field cycles through example academic prompts until you type.
  - A **prompt-strength meter** rates the prompt weak / average / great.
  - The citation step sets publication recency, impact factor, minimum citation count and whether to include preprints.
  - Choosing a DOCX completes setup from the file.
  - **"Skip and start writing"** opens a blank editor when the prompt is empty. If a prompt was entered, it generates the standard headings instead.
  - The toolbar and title are hidden until setup is finished, skipped or done by import.
- **Setup progress guide (onboarding checklist):** appears at the bottom of the sidebar after first login. It has five steps:
  - Autocomplete: accept with →.
  - Library: upload a source.
  - Chat: send a message.
  - Citation: cite via the citation menu.
  - Reviews: run a review.
  - Pink pulsing dots mark where each feature lives. After Autocomplete has been tried, at most one contextual hint is shown. Steps tick off automatically when used.
- **Sidebar menu** (one view at a time, with a back arrow):
  - **+ New**: blank document, Word import, PDF upload, or import from Zotero/Mendeley/BibTeX/DOI.
  - **Documents**, **Library**, **Workflows** (topic + sources into a new document), **Find Papers** (a dedicated research panel), **AI Chat**.
- **Right panel:** one surface at a time (AI Chat, Review, Comments or Document Settings), opened from the editor top bar.
- **Mobile:** the sidebar is a full-screen overlay and the right panels are bottom sheets.
- **Shortcuts:**

  | Shortcut | Action |
  |---|---|
  | Ctrl/Cmd+B / I / U | Bold / italic / underline |
  | Ctrl/Cmd+K | Link |
  | Ctrl/Cmd+Z | Undo |
  | Ctrl/Cmd+Shift+Z | Redo |
  | Ctrl/Cmd+F | Find |
  | @ | Citation search |
  | Ctrl/Cmd+/ | Force an AI suggestion |

### 1.2 Free writing course (`/docs/getting-started/writing-course/`)
- **Course:** "Fundamentals of Academic Writing with AI" on learn.jenni.ai. It is free, self-paced, has **5 chapters and 53 video lessons** with a quiz per lesson, and awards a **professional certificate** (pitched for a CV or LinkedIn).
- **Instructor:** Scott McCleary, MEd (corporate STEM training background).
- **Chapters:**
  1. Intro: what Jenni is, the dashboard, buttons and shortcuts, document settings.
  2. Research: literature reviews with AI, summarising articles, citation management, connecting external databases, ethical use of AI.
  3. Drafting: outlines, drafting and refining, style and tone, proofreading, automating formatting.
  4. Advanced thesis writing: thesis statement, dissertation-scale literature review, methodology, interpreting data, dissertation formatting.
  5. Optimisation: AI preferences, prompt engineering, when to use AI and when to write manually, troubleshooting.
- **Social proof:** testimonials (a researcher, an MD candidate, a professor). One mentions an "AskJenni" feature for questioning PDFs.

### 1.3 Troubleshooting (`/docs/getting-started/troubleshooting/`)
A single problem→solution page covering every area. Details not stated elsewhere:
- **Login:**
  - Verification email may take up to 5 minutes.
  - Accounts with the same email merge across Google and email sign-in.
  - Someone who only ever used Google can set a password via Forgot Password.
  - A disabled account must email support.
- **Billing:**
  - A mid-cycle plan change shows as two charges (proration plus the new cycle).
  - The Billing tab is shown only while a subscription is active or a payment is outstanding. Its absence does not prove you were not charged; support will confirm.
  - Free autocompletes reset at **midnight UTC**. Plus resets on the **billing-cycle date**, not the 1st.
  - Each accepted autocomplete, AI edit and chat message counts separately.
- **Editor:**
  - Real-time autosave. When "offline" shows, changes are queued.
  - Lost content is recovered from Version History.
  - Long documents or large images slow the editor; split them.
- **AI:**
  - Autocomplete switch at the right end of the toolbar.
  - Weak suggestions: add context or a Section Prompt.
  - A Section Prompt applies only when the cursor is inside its section.
  - Chat citations need the source in the Library and Library search enabled.
  - Only **one review at a time across all documents** ("Running for another document").
  - If headings won't generate, try Smart headings.
- **Citations:**
  - Search by DOI or exact title.
  - Watch for APA 6th vs 7th.
  - **Editing a Library source does not update citations already placed.** Each citation keeps its own copy, and the bibliography entry is built from the *first* citation of that source.
  - Citations from a Word import are confirmed through pending matches.
- **Uploads:**
  - Import file limit: Free 25 MB, Plus/Pro 100 MB.
  - Corrupt or password-protected PDFs fail.
  - Fix a Zotero/Mendeley connection by revoking it and reconnecting.
  - Fonts, colours and spacing are not preserved on import. Some embedded images don't transfer.
- **Export:**
  - DOCX styling differences are normal.
  - For a LaTeX compile failure, check packages, image paths and malformed .bib entries.
- **Collaboration:** a broken share link usually means General access is Restricted.
- **Performance:** latest Chrome, Firefox, Safari or Edge. Ad blockers can interfere.
- **Settings:** email change is blocked if the address is used by another account. Google users change it at Google.
- **Mobile:**
  - The toolbar floats above the keyboard.
  - Chat and Review open as bottom sheets.
  - Select text with a long press and drag the handles.
  - Swipe a drawer down to close it.
- **Other:**
  - Math delimiters are `$$…$$` inline and `$$$…$$$` block, with no spaces inside.
  - Saved-prompt search is case-insensitive prefix match.
  - Pin the extension if it is hidden.
  - Language resets after clearing browser data.

---

## 2. Writing

### 2.1 Document editor (`/docs/writing/document-editor/`)
- **Basics:** rich text, Markdown shortcuts, embedded media. **Up to 10 concurrent editors.** Autosaves as you type.
- **Document management (⋯ per document in the Documents panel; hover on desktop):**
  - Open in new tab, **Duplicate**, **Archive**. There is no delete here.
  - The archived list has **Restore** and, for owners, **Delete permanently** with an inline Delete/Cancel confirm. It cannot be undone.
- **Formatting:**
  - Bold, italic, underline, **strikethrough (Ctrl/Cmd+Shift+X)**, H1–H4, ordered and unordered lists.
  - The selection toolbar adds:
    - **Highlight (3 colours)**, inline code, link, superscript/subscript, **Turn into**.
    - **Cite**: citation search for the selection.
    - **Chat**: sends the selection to Chat as a temporary source.
    - **AI Edit**.
    - **Review**: reviews just the selection.
- **Markdown autoformat** at the start of a line followed by a space:

  | Syntax | Result |
  |---|---|
  | `#` / `##` / `###` | H1 / H2 / H3 |
  | `-` or `*` | Bullet list |
  | `1.` | Numbered list |
  | ```` ``` ```` | Code block |

- **Tables:**
  - Insert from the toolbar or `/table`.
  - Add or delete rows and columns on hover, **merge cells** via the context menu, drag to resize columns.
  - Bold, italic and code work in cells.
  - **Captions** sit above the table, move with it, survive copy/paste, and are kept in DOCX and LaTeX.
  - **"Show table labels"** auto-numbers captions in document order and renumbers on move.
  - Clicking the prefix offers Change language (via the citation style dialog) or Hide labels. The label follows the document's **citation locale**, not the UI language.
- **Cross-references:**
  - Insert with `/ref` → Cross-reference, or from the mobile insert drawer.
  - Search the picker by number or caption. It inserts a clickable numbered reference that renumbers automatically.
  - If the target is deleted, a **missing-target indicator** offers **Relink** or **Remove reference**.
- **Code blocks:**
  - Insert from the toolbar, slash menu or ```` ``` ````.
  - **15 highlighted languages:** CSS, JS, TS, HTML, Bash, Dockerfile, Markdown, Rust, Python, C, Java, Plaintext, Go, JSON, PHP. The default is Plaintext.
  - The language picker is a bottom drawer on mobile.
  - Old Mermaid and Chart code blocks render, with a Diagram view / Code toggle.
- **Charts and diagrams (Chart block):**
  - Insert from the toolbar, `/chart`, the mobile drawer, or a fenced `chart`/`mermaid` block.
  - Two tabs:
    - **Source**: Plotly JSON or Mermaid, with live preview. **Done** keeps a chart that draws. On "Couldn't draw this chart" use **Fix with AI**.
    - **Describe**: plain English → **Generate** → preview → **Insert**.
  - A new chart opens on Describe. Editing an existing one opens on Source.
  - The chart card offers **Edit chart**, **Expand chart/diagram**, **Download PNG** (Plotly) or **Download SVG** (Mermaid), and **Copy chart source**.
- **Images:**
  - Add by drag-drop, paste, toolbar or `/image`.
  - PNG, JPEG or WebP, **15 MB each**.
  - Hover controls: align, caption, **AI analysis**, delete.
- **Caption alignment:** selecting caption text shows left / centre / right alignment, a comment action and a **word count of the selection**.
- **Links:**
  - Ctrl/Cmd+K, or paste a URL onto selected text to auto-link.
  - Clicking a link shows a preview with Copy / Edit / Remove.
- **Horizontal rule:** from the slash menu.
- **Bottom resting toolbar** (when nothing is selected): add block, undo/redo, **live word count**.
- **Slash menu:** H1–H4, bullet/numbered lists, table, cross-reference, code block, chart, image, math (inline and block), horizontal rule. Type to filter.
- **Table of contents:** auto-generated in the right-hand marginalia. Live, click to jump.
- **Prompts button** (top-left): Section Prompts. On mobile it is in the floating toolbar.
- **Accessibility:**
  - Tab reveals "Skip to main content".
  - The toolbar is navigated with arrow keys and Home/End. The floating toolbar uses Up/Down.
  - Caption alignment works as a radio group.
- **Limits:**
  - No hard word limit, but long documents get slow; split them into chapters.
  - 10 concurrent editors.
- **Connection failure:**
  - A **"Failed to connect"** screen replaces the spinner.
  - Advice: drop the VPN, try another Wi-Fi network or a hotspot, then **Retry connection**.
  - **Copy the document ID** to give to support.
  - Try an incognito window to rule out extensions.

### 2.2 Generate headings / outline builder (`/docs/writing/outline-builder/`)
- **Three heading modes:**
  - **No Headings**: title only.
  - **Standard headings (IMRaD)**.
  - **Smart**: the AI picks the structure. Advised for unfamiliar or interdisciplinary topics.
- **Prompt:** strength meter plus character counter. The document prompt allows up to **5,000 characters**.
- **Flow:** Fill document prompt → Next → citation settings → Generate Headings (choose a mode) → **Start Writing**.
- **Output:**
  - A **title plus headings only, no body text**.
  - Each generated H2/H3 gets **1–3 concise "researcher-note" Section Prompt bullets** ("what to cover").
- **While generating:**
  - A **ghost outline with status messages**. The editor stays read-only.
  - The title may appear first. Headings are revealed together.
- **After insertion:**
  - The setup prompt is **refined into a concise whole-document prompt**. It keeps topic, tone, audience, academic level and style.
  - Section-specific guidance goes into Section Prompts and citation requirements go into document settings.
- **Natural-language settings:** a citation style or filters named in the prompt (e.g. "APA, peer-reviewed since 2020") are **auto-applied** to the citation step when Next is clicked. Revising the prompt and pressing Next re-applies them. Edits made during generation are preserved.
- **Language:** the title and headings follow the prompt's language.

### 2.3 Math equations (`/docs/writing/math-equations/`)
- **Rendering:** KaTeX.
- **Inline equations:** sigma toolbar icon → Inline equation, or `$$…$$`.
- **Block equations:** math-block icon or `$$$…$$$`. Rendered centred.
- **Click-to-edit popover:**
  - LaTeX input with **live preview**.
  - **Presets:** quadratic formula, Maxwell's equations, piecewise function.
  - Esc cancels. Ctrl/Cmd+Enter or Done saves.
- **Fix with AI:** offered on KaTeX errors. It shows the repaired preview, which you then apply or retry.
- **Copy:** a hover button copies the LaTeX source.
- **Quick reference table:** fractions, roots, super/subscripts, sums, integrals, Greek letters, matrices.
- **Export:**
  - LaTeX export uses `$…$` / `\[…\]`.
  - Word import converts equations to LaTeX.
  - DOCX renders equations as images. The export page confirms they are **not native Word equations**.
- **Pitfalls:** no spaces inside the delimiters; mismatched braces; unsupported packages.

### 2.4 Images (`/docs/writing/images/`)
- **Insert:** drag-drop, paste, toolbar or `/image`. The image is placed inline.
- **Limits:** PNG/JPEG/WebP, 15 MB. Larger files are rejected with an error.
- **Alignment:** left, centre (default) or right. Persists across sessions and exports.
- **Captions:**
  - Plain text with no formatting. An emptied caption removes itself.
  - **"Show figure labels"** numbers figures automatically and renumbers on move. It follows the citation locale.
  - Clicking the prefix gives Change language or Hide.
  - Figures are cited in the text with cross-references.
- **Ask AI on an image:**
  - Attaches the image to Chat, where it can describe it, OCR text from screenshots or scans, identify chart elements, and **suggest alt text**.
  - It stays attached until a new thread is started.
- **Delete:** trash icon, or select and press Backspace. Undo works while the document is open.
- **Load failure:** shows "Error loading image" with **Retry**, or Delete for editors. The image is never auto-deleted.
- **Mobile:** tap → ⋯ menu with the same actions.

### 2.5 Version history (`/docs/writing/version-history/`)
- **Opening it:**
  - Desktop: top-bar ⋯ → Version history (not the toolbar ⋮).
  - Mobile: the top navigation menu.
  - Available even during setup, before the title exists.
- **Layout:**
  - Desktop: version list on the left (newest first; date, time and collaborator name) with a read-only preview including comments.
  - Mobile: a dropdown.
- **Saving:** automatic, with nearby edits grouped. There is no manual save.
- **Plans:** available on **all plans including Free**.
- **Restore:**
  - Creates a new version entry, so a restore is itself undoable.
  - Restore is disabled when the latest version is selected.
- **Attribution:** entries show **who** made each change, which supports accountability in group work.

---

## 3. AI Tools

### 3.1 AI Autocomplete (`/docs/ai-tools/ai-autocomplete/`)
- **Context used:** headings, previous paragraphs, citations, Section Prompts and the current sentence.
- **Display:** gray ghost text.
- **Suggestion bar:** **Accept** and **Refine suggestion**. Arrows to switch between alternatives appear once more than one suggestion exists at that point.
- **Formatted previews:** headings, lists, bold, citations, inline and block math, and tables render inside the ghost preview before acceptance.
- **At the end of a heading:** a long continuation starts a new paragraph rather than extending the heading.
- **Keys:**

  | Key | Action |
  |---|---|
  | → or Tab | Accept all |
  | Alt/Option+→ | Accept one **word** at a time |
  | Shift+→ | Guided Autocomplete |
  | Esc | Dismiss |
  | Ctrl/Cmd+/ | Force a suggestion |
  | (keep typing) | Dismiss and regenerate |

- **Guided Autocomplete (Refine suggestion):**
  - Free-text direction, e.g. "focus on methodology", "include a citation from Smith 2020".
  - **Presets**, including "regenerate without citations".
  - On mobile it is a sheet above the keyboard.
  - It replaced the old Try Again button. For a plain new suggestion, press Esc then Ctrl+/.
  - **Typed directions can be remembered** into the active Section Prompt or the document prompt. The Prompts panel shows the remembered text. Presets are never remembered.
- **Screen readers:** each suggestion is announced once, and the controls carry shortcut labels.
- **Smart citations while writing (per-document toggles):**
  - **Auto-cite from external sources**.
  - **Auto-cite from your Library**, which can be limited to collections.
  - With both off, suggestions use only the student's own text.
  - A Section Prompt can override this per heading: pin PDFs, pick one collection, or **Disable sources**.
- **Generate:** the button in the Section Prompts panel moves the cursor into that section and suggests text there.
- **Placement:** works **mid-paragraph**, not only at the end.
- **Language:** follows the document language setting.
- **Limits:**

  | Plan | Autocompletes |
  |---|---|
  | Free | 10/day |
  | Plus | 5,000/month |
  | Pro | Unlimited |

  A remaining-count counter is shown.
- **Best practice it teaches:** write a few sentences first, use descriptive headings, add Section Prompts, and **verify factual claims**.

### 3.2 Section Prompts (`/docs/ai-tools/section-prompts/`)
- **Prompts panel:** a **Document prompt** (whole document) followed by one prompt per heading. Opened from Prompts (top-left). The open/closed state is remembered. On mobile it is a drawer.
- **Uses:** set a lit-review's focus debate or gap, a methods structure, a discussion tone, terms or claims or sources to use or avoid.
- **Inheritance:**
  - Prompt text on a parent heading applies to its sub-headings, broadest to narrowest.
  - **Source choices do not inherit.**
- **Limits:** 5,000 characters per field, with a counter near the limit. Prompts need headings; the document prompt does not.
- **Configure context (heading prompts only):**
  - Pin one or more Library PDFs, pick **one** collection, or both.
  - **Disable sources** to generate with no retrieval or citations.
  - Selections show as pills; click one to preview the PDF.
  - The button summarises counts or shows "Sources disabled".
  - On mobile it is a second bottom sheet.
- **What it guides:** Autocomplete (text and citation retrieval) and AI Editing. It does not replace a custom AI Edit instruction.
- **Remembered guidance:** Guided-autocomplete directions **and written feedback on a thumbs-down rating** can update the Section Prompt, the document prompt or the citation settings. A manual edit made during generation wins.
- **Generate from section:**
  - Writes at the end of the section's current paragraph, or creates a paragraph if the section is empty.
  - Shows a spinner. One section at a time.
- **Best practice:** 1–3 sentences per prompt, and constraints such as "do not introduce new sources".

### 3.3 AI Chat (`/docs/ai-tools/ai-chat/`)
- **Opening it:** New > AI Chat, the sidebar icon, or the top-bar button. The panel opens on the right, is **resizable** by dragging its left edge, and collapses.
- **Four kinds of request:** writing help, questions about the document, editing feedback, research (find, summarise or compare papers).
- **Tool-routing suggestions:** while typing, a card may suggest:
  - **Open literature review** or **Open gap analysis**: prefills the topic and never overwrites an existing run.
  - **Proofread / Peer Review**: opens an existing result or starts that review.
  - **Message support**: carries the question over.
  - Each card can be dismissed.
- **Current document toggle:** Chat uses the draft, answers by heading, uses the bibliography and sees the session's edits.
- **Add context menu:**
  - Sources (Library PDFs), Collections, Current Document.
  - **Filters**.
  - **Web and Library permission each Off / Ask / On** (default **Ask**).
  - Context shows as removable tags.
  - **@** in the composer adds a source or collection; collections are listed first. Empty or already-attached collections are hidden.
  - An empty Library shows an Upload action. PDFs can be uploaded from the source picker, and Chat waits for processing to finish.
- **Send quote to Chat:** select text → Chat button. The selection becomes a temporary source keeping formatting, headings, tables and citations. Hover to preview it.
- **Cited answers:**
  - Inline citations; hover for metadata, click to go to the bibliography or Library entry.
  - A **sources card** under the answer shows the count, the style and how many sources came from the Library.
  - **References tab:** formatted bibliography, change style or locale (applies to the whole thread and persists for it; new threads start with the document's style), copy one or all.
  - **Sources tab:** title, authors, year, venue, **citation count, impact factor, OA status**. Open or save one, or **Save to library** for all, optionally into collections.
  - Natural-language commands work too ("show references in APA").
  - Long lists collapse behind "Show all".
- **Formatting:** paragraphs, lists, code and **tables** (scroll horizontally; **Copy table** pastes cleanly into spreadsheets).
- **Diagrams and charts:** Mermaid flowcharts and frameworks; bar, line, scatter, pie and histogram charts.
- **Start chat from a source:** the **Ask AI** button in source details. Images use **Ask AI** too.
- **History:**
  - Threads are saved. The clock icon opens history; rename with the pencil, delete with the trash, **+** for a new thread.
  - Advice: one thread per research question.
- **Settings:** Web and Library search Off/Ask/On via the footer pills, or Settings > Preferences > Search permissions.
- **Citation filters:**
  - Publish year, impact factor, minimum citation count, include preprints.
  - An active-filter count, **Clear filters**, and an "Active filters" pill.
  - Saved to the **account** (they persist across chats) and separate from document settings.
- **Limits:**
  - Free **5 messages one-time**, Plus 500/month, Pro unlimited.
  - **50,000 characters per message.** Over that, Send is blocked; attach a PDF, use Current document, or quote instead.
- **Attachments:**
  - Images by photo icon, paste or drag. Analyses charts, screenshots and **handwritten notes**.
  - PDFs by paperclip. They **auto-save to the Library**. Send waits with a spinner and "Waiting for upload to finish".
  - Multiple attachments allowed, shown as thumbnails with ×.
- **File limits:**

  | Limit | Free | Plus | Pro |
  |---|---|---|---|
  | Image | 15 MB | 15 MB | 15 MB |
  | PDF pages | 150 | 500 | 1,000 |
  | PDF size | 25 MB | 100 MB | Unlimited |

- **Privacy:** chats are personal and **not shared with collaborators** on shared documents. Threads can be deleted one at a time or all cleared.

### 3.4 Saved prompts (`/docs/ai-tools/saved-prompts/`)
- **Create:** the **/** button in the chat footer → **Manage** → **+** → command name and prompt text → Save.
- **Use:**
  - Type `/` plus letters to get a dropdown; prefix match, case-insensitive. At least one letter is needed after `/`.
  - Or browse with the / button.
  - The prompt text can be edited after insertion.
- **Manage:** edit with the pencil, delete with the trash, search by name or content.
- **Rules:** names are unique per account. Prompts are **private** (collaborators can't see them). **No limit** on how many.
- **Built-in PDF prompts** appear only when a PDF is attached: "Summarize this PDF" and "What are the limitations?". They are not editable.
- **Mobile:** the / button may be hidden; type `/` instead.

### 3.5 AI Editing (`/docs/ai-tools/ai-editing/`)
- **Flow:** select text → command menu → preset or custom instruction → **diff** (green added, red removed) → **Replace / Insert below / Retry / Discard**.
- **Diff summary:** a short summary above the diff says what changed and why.
- **Section Prompt context:** the active heading's prompt and its parents' prompts are included.
- **Whole-table edit:** table grip → block menu → AI Edit; then Replace the table or Insert below.
- **Presets:**
  - **Strengthen:** Fluency; Paraphrase Academic, Casual, Persuasive, Bold or Friendly; Simplify; Make longer; Strengthen argument; Counter-argument.
  - **Generate:** Summarize; Write opposing argument; Write with more depth.
  - **Transform:**
    - Tense: past, present or future.
    - Lists and tables: bullet list, numbered list, prose, table.
    - Translate to EN, ES, DE, FR, ZH or JA.
  - **Academic style:** Increase formality; Technical precision; **Increase claim confidence** ("may suggest" → "demonstrates"); **Hedge claim confidence** ("proves" → "suggests").
- **Custom instruction:** a free-text field with no format restrictions.
- **Context:**
  - **+** allows web search or Library search, or adds a Library PDF.
  - PDFs can be uploaded inline; a failed upload is removed automatically.
  - Context shows as pills. Removing a PDF also removes its mention from the prompt. The same on mobile.
- **Tips:** select whole sentences; retry 2–3 times and compare; chain commands (Simplify, then Increase formality); use Reviews for document-wide checks.

### 3.6 Reviews (`/docs/ai-tools/reviews/`)
- **Review types:** **Proofread, Claim Confidence, Source Quality, Tone of Voice, Peer Review**. Opened with the Review button in the top bar, which only appears once the document has content.
- **Running a review:**
  - Full document: choose a type → Run review → "Thinking for X seconds" with a **per-section progress bar** ("3/5 sections").
  - **Selection:** right-click or floating toolbar → Review → type. Results carry a **Selection** badge.
- **Results:** an expandable **Summary** plus **category buttons with counts** that filter the list.
- **Proofread categories:** Grammar, Punctuation, Word choice, Formality, Passive voice, Repetition, Formatting. Follows the document language and **British spelling**.
- **Claim Confidence categories:** Unsupported, Weakly supported, Overstated, Misrepresented, Contradicted, Unverifiable. The detail popup shows **excerpts from the cited source**.
- **Configure sources (Claim Confidence):** Library on/off, external on/off, one collection, year range, minimum impact factor. Persists for later runs.
- **Source Quality** checks citations already in the document:
  - **Categories:** Retracted, Preprint (including those with a known published version), Non-research source (editorials, letters, errata, datasets, grants, peer reviews, retraction notices), Rarely cited (for its age), Unverified journal.
  - **Bibliography notes** on publication age and venue spread.
  - **Actions per citation:**
    - **Keep**.
    - **Remove**.
    - **Replace with published version**.
    - **Find replacement**: citation search inside the popover, with a comparison highlighting changed venue and DOI.
- **Tone of Voice:** checks word choice, sentence structure, formality, clarity and readability against a target voice. Can use **a Library PDF as the style reference**.
- **Peer Review:**
  - An overview, **ratings**, strengths, weaknesses, **reviewer questions**, and **comment threads anchored to passages** (which can contain citations that open a preview).
  - Its final synthesis is in the document language.
- **Inline suggestions:** red strikethrough and green insertion. Click one for the reasoning and category.
- **Review mode** (Review Changes):
  - The editor is **locked**. A floating toolbar shows a "3/15" counter.
  - **Y** accept, **N** reject, **↑/↓** navigate, **Esc** exit.
  - **Accept All / Reject All.** Exits automatically when everything is resolved.
  - In Source Quality, Y and N mean the primary and secondary action.
- **Workflows (sidebar → Workflows):**
  - **Literature review:**
    - Topic up to 5,000 characters, then a choice of Web search, Library search or one collection (Add sources if the Library is empty), then citation filters.
    - Start shows "15–20 minutes" and is disabled while an upload is running.
    - Named phases: Searching, Selecting literature, Drafting sections, Assembling and citing. **Detailed steps** opens an activity log. Stop needs confirmation.
    - **Open document** creates a **new** document. The current one is never touched.
    - Survives closing the tab, reloading or switching device. **Emails the user when finished.**
    - Language: an explicit request in the topic wins, then the topic's language, otherwise English.
    - Afterwards: New review, Run again, Edit topic.
    - The output can use comparison tables, framework diagrams and charts of figures reported by the sources.
  - **Research gap analysis:**
    - Topic, then sources, then Publish year, Impact Factor, Cited by and Include preprints.
    - Takes "3–6 min". Phases: Searching, Extracting claims, Mapping the gaps.
    - Output document: a **cited gap map**, well-supported findings, contested claims, under-explored areas, suggested research directions, and **limits of the material retrieved**.
    - Same persistence and email.
  - **Recent runs:** up to 3 whose documents were opened.
  - **Topic carry-over:** the run topic becomes the new document's **Document prompt** on first open.
  - **Allowance:** Free 3 lifetime, Plus 10/month, Pro unlimited. Shown in Settings > Usage and the profile-menu usage meter.
- **Managing runs:**
  - Refresh icon re-runs a review. Stop restores the previous results.
  - Reviews **survive closing the panel, the document or a refresh**; reopening reconnects. Peer Review comments that finished while the document was closed appear on reopen.
- **Peer Review history:** past runs with time and **overall score**. "View all" lists them read-only.
- **Peer Review export:**
  - Desktop opens the print dialog (save as PDF). Mobile downloads an HTML file.
  - Includes the title, rating, summary, strengths, weaknesses and questions.
- **Feedback:** thumbs up or down per result and per suggestion.
- **Edge cases:**
  - "No suggestions" is not an error.
  - One review at a time across all documents.
  - A deselected category filter hides its suggestions; "All" shows them again.

---

## 4. Research

### 4.1 Citation management (`/docs/research/citation-management/`)
- **Ways to insert a citation:**
  - **Cite** button or **@** inline; search by title, author, DOI, URL or keyword.
  - **Highlight and Cite**: opens the Citation Search Manager with a Library/web toggle, year or relevance filters, and Cite.
  - **Cite from Library** in the right sidebar: inserts the in-text citation and the reference in one step.
  - **Find Papers sidebar:**
    - Search by topic, question, title, author, DOI or **a sentence from the draft**.
    - **Suggested queries** come from the document title, recent searches or examples.
    - Filters by year or citations; sort by relevance, date or citations. A result flashes "Cited" after insertion.
    - Works without an open document, but asks for one before inserting.
- **Custom and placeholder citations:**
  - **Add custom citation** (manual entry) and **Add placeholder citation** (temporary marker).
  - Both appear in the empty state; the Library empty state offers Upload Sources.
- **Identifier search:**
  - Accepts a DOI, PMID, PMCID, arXiv ID, or doi.org / PubMed / PMC URLs, or a whole pasted reference containing one.
  - An exact match is shown first; otherwise it falls back to normal search.
- **Smart paste:** pasting a bare DOI or PMID URL into the editor offers **Paste as Citation / as Link / as text**. Only a standalone identifier triggers this.
- **Search filters:**
  - Publish year (a decade grid) and minimum citation count.
  - Tabs: **All / Discover / Library**.
  - The filters persist **per document**.
- **Preprints:** "Include preprints" is per document and **on by default**. It affects autocomplete and review suggestions.
- **Mobile setup:** recency and preprints are visible; impact factor and citation count sit under **Advanced filters**.
- **Requirements in the prompt:** a year range, style, peer-reviewed only, minimum citations or impact factor are parsed from the document prompt. Manual choices are preserved.
- **Choosing sources for a document:** Auto-cite from Library → Configure context → individual sources plus **one** collection. Jenni searches their union; empty means the whole Library.
- **Styles:**
  - Five quick styles: APA 7, MLA 9, Chicago 17 author-date, IEEE, Harvard.
  - A search box queries the **Zotero CSL repository (10,000+ styles)**.
  - The Citation Style dialog has search, **locale** ("Localized for"), **locator mapping**, a **"Show page number in citations"** toggle, and **live in-text and bibliography previews**.
  - Settings are saved per document and the defaults are inheritable.
  - The locale and locator setting apply everywhere: editor, chat, references panel, clipboard and DOCX.
- **In-text forms:** parenthetical, narrative, multiple sources, **grouped** (same author collapsed), with a page or page range.
- **Citation editor** (click a citation):
  - **Locator page** (for paginated types: chapters, legal cases, hearings, legislation, interviews, speeches…).
  - **Prefix** ("see") and **suffix** ("emphasis added").
  - Parenthetical/narrative switch, remove.
  - Keyboard: Enter or Space on a focused citation opens it.
- **Bibliography:**
  - Automatic at the end of the document, live, sorted per the style.
  - Deleting the last in-text use removes the entry.
  - The heading adapts: **Bibliography** for note styles (Chicago NB, Turabian, OSCOLA), **Works Cited** for MLA, otherwise **References**.
- **References toolbar:**
  - "Sources N" opens **Sources in this document**: save one or all cited sources to the Library or collections (Save # sources). A drawer on mobile.
  - Export the reference list: **Copy to clipboard, Copy as BibTeX, Download .bib**.
- **Zotero:**
  - From the Library upload menu or Settings > Connections; OAuth.
  - Personal **and group libraries**, one collection at a time.
  - **One-way** import with no sync; re-import to update.
- **Mendeley:** the same, one-way.
- **Other routes:** URL import (metadata scraped); BibTeX import and export; PDF upload with metadata extraction (title, authors, year, DOI).
- **Contributor roles:** a per-contributor Role dropdown (author, editor, translator, director, producer, host, interviewer, narrator…). Used in formatting and preserved from Zotero, BibTeX, BibLaTeX, RIS or DOI imports.
- **Autocomplete citation preview:** hover a suggested citation for details; click for a read-only modal.
- **Citation matching on Word import:** reconnects in-text citations to references as **pending matches** to confirm or correct.
- **Shortcuts:**

  | Key | Action |
  |---|---|
  | @ | Open citation search |
  | Esc | Close |
  | Enter | Select |
  | ↑/↓ | Navigate |
  | Enter/Space on a citation | Open its editor |

- **Anti-fabrication stance:** citations are tied to identifiable sources with visible details. Users are told to search by DOI or exact title, upload full PDFs, and verify.
- **Tip:** the **bookmark icon** saves a web result to the Library.
- **Gotcha:** Library edits don't propagate into placed citations, and the bibliography entry comes from the first citation.

### 4.2 Library (`/docs/research/library/`)
- **Layout:** a sidebar view with search and upload. Entries show title, authors, year and type. The empty state offers upload and import.
- **Upload PDF:**
  - By button or drag-drop.
  - Extracts title, authors, year, DOI and **abstract**, and prepares the text for AI.
  - Collections can be assigned **before processing**; the collection being viewed is pre-selected.
  - The Library opens automatically to show status.
- **Zotero import:**
  - Personal and group libraries; **tags and notes are not imported**.
  - Only items that are in a collection appear.
  - If the PDF is not in Zotero cloud storage, the item is imported without it and a "Some PDFs were not available" count is shown.
- **Mendeley:** PDFs are imported; **annotations and highlights are not**.
- **BibTeX / RIS:** bulk import from + New.
- **DOI / PMID / ISBN:**
  - Auto-fills details and **tries to fetch the full PDF**.
  - On failure, a **"Missing PDF Attachment"** warning offers **Fetch** (retry) or Upload PDF.
  - A source without a PDF can be cited but is not usable by Chat or Autocomplete.
- **From citation search:** inserting does **not** add to the Library. **Save** on a result card does, which lets a student build a reading list before drafting.
- **Collections:**
  - Folders that can be **nested**, renamed and deleted (sources are kept).
  - A source can be in many collections.
  - "Search or create…" picker with inline **Create "name"**.
  - Bulk Add to collection only adds memberships; **Remove from collection** for bulk removal. "Added" labels.
  - An empty collection offers **Add from library** or Import sources.
- **Search:** titles, authors, abstracts and **full PDF text**.
- **Filters:**

  | Filter | Options |
  |---|---|
  | PDF status | Any / Has / No |
  | Year | All / last 5 years / custom |
  | Impact factor | All / >0.25 / >3 / >10 |
  | Open access | Any / yes / no |
  | Work type | 35+ types |
  | Collection | Any / No collection |

  Filters combine with search.
- **PDF reader actions:** search, thumbnails, zoom, **copy text with a citation**, quote to Chat, edit metadata, delete.
- **Processing states:** **Processing** and **Queued** (auto-retry). The file is visible before it is AI-ready.
  - **OCR** covers scanned and image-heavy PDFs, including math and tables. Tiny images are ignored; there is no scanned-image cap.
- **Metadata edit:** Details → pencil → Save. Contributor roles are editable.
- **Export:** selected sources as **BibTeX or RIS** (EndNote, RefWorks).
- **Upload limits:**

  | | Free | Plus | Pro |
  |---|---|---|---|
  | PDFs | 10 | Unlimited | Unlimited |
  | Size | 25 MB | 100 MB | 100 MB |
  | Pages | 150 | 500 | 1,000 |

  Over-limit files are rejected.
- **Duplicates:**
  - Detected automatically by identifiers and bibliographic details.
  - A blue **Library Issues** banner ("3 duplicate groups") → **Review** → cards side by side.
  - **Keep** (keeps this one, trashes the rest) or **Trash** a single one. Both ask for confirmation.
  - The **Missing PDFs** tab: drag a PDF onto its reference row.
- **Dropping files on the editor:** a PDF goes to the Library; an image is inserted.
- **Edge cases:** an upload with no progress for **2 minutes** is cancelled with a network error; corrupt or password-protected files fail.

### 4.3 PDF reader (`/docs/research/pdf-reader/`)
- **Opening:** a panel **beside the document**. Toolbar: pages, zoom, thumbnails.
- **Selection:** select text to **copy with citation** or **quote in Chat**.
- **Search:**
  - Ctrl/Cmd+F while the reader has focus.
  - Live highlights and an **"X of Y"** counter.
  - Enter for next, Shift+Enter for previous, or arrows. Esc or X clears.
  - Case-insensitive and exact match: **no regex or wildcards**. Ordered by page, then position.
- **Edge cases:**
  - Browser find opens if the reader isn't focused.
  - Image-only PDFs need OCR.
  - The right panel can disturb the layout.

### 4.4 Browser extension (`/docs/research/browser-extension/`)
- **Setup:** install, pin, sign in. Stays signed in.
- **Bulk save from result pages (PubMed, arXiv lists, Google Scholar):**
  - The popup lists the detected papers. Select or Select all, choose collections, then **Save (n)**.
  - A progress bar with **Stop**; items show **Saved** or **Failed — select to retry**. Clicking a title scrolls to it on the page.
  - "No references found on this page" means: open a single paper instead.
- **Single page:** review the metadata → collections → Save → **View in Jenni**.
- **PDF URLs:** the file is attached and immediately usable by AI. HTML pages save metadata only; upload the PDF later.
- **Supported:** arXiv, Nature, JSTOR, bioRxiv, PubMed, Lens.org, direct .pdf links, and **any page with a DOI, PMID or PMCID in its metadata**.
- **Unsupported:** YouTube, Figma, Google Maps, Google Search, chrome:// pages.
- **Floating popup:** minimise, Esc to close.
- **Collections:** multiple per save; create a new one inline.
- **Captured details:** title, authors, date, journal, DOI.
- **Edge cases:**
  - Async metadata: reload.
  - **reCAPTCHA or access wall:** complete it in the browser, then save.
  - Auth problems: sign out and in, clear the extension's data.

### 4.5 Open access papers (`/docs/research/open-access-papers/`)
- **Where they appear:** AI Chat search, the **Discover** tab of citation search, and direct links by paper ID. There is no separate browser.
- **Reading:** in the built-in reader. Top bar: title, search, and a **capture button** that highlights text for a citation or AI discussion.
- **Add to Library (bookmark):** pick a collection; the PDF, full text and metadata are copied. The button then reads "Library Source".
- **Use:** Chat can use the full text, and a saved paper can be cited like any other source. The FAQ says save first, then cite.

### 4.6 Academic terminology (`/docs/research/academic-terminology/`)
- **A glossary page for students:**
  - In-text citation (parenthetical vs narrative); bibliography vs reference list vs works cited; DOI; et al.; ibid.
  - A style table: APA 7, MLA 9, Chicago 17, IEEE, Harvard, Vancouver, with the fields each is common in.
  - Peer review; impact factor (explained as a journal-level number, not paper quality); h-index; open access (gold, green, diamond/platinum); preprint; postprint; retraction; **predatory journal**.
  - Paper structure: abstract (150–300 words), introduction, literature review, methodology, results, discussion, conclusion, appendix.
- **Why it matters:** an educational content page that also serves SEO.

---

## 5. Collaboration

### 5.1 Sharing (`/docs/collaboration/sharing/`)
- **Roles:** **Editor / Commenter / Viewer**. Email invitations **default to Editor**.
- **Pending invites:** shown under **Invited**. The role can be changed before acceptance, and invites can be **resent or cancelled** (owner only).
- **Banners:** "Comment only" and "View only", each with a **Request edit access** button.
- **Restricted documents:** a visitor without access picks a role and clicks **Request Access**; the owner approves or rejects.
- **General access:**
  - **Restricted** or **Anyone with the link**, with the link role set to Editor, Commenter or Viewer, and **Copy Link**.
  - The link is the document's own address; it is never regenerated.
- **Collaborators:** change role or **Remove access**. A user whose role is reduced while the document is open gets an auto-reload and a notice.
- **Live editing:** **labelled cursors**, sync, auto-reconnect.

### 5.2 Comments (`/docs/collaboration/comments/`)
- **Permissions:** owners, Editors and Commenters can comment, reply and react. Viewers read only.
- **Adding:**
  - Select text → comment icon or **Ctrl/Cmd+Shift+M** → Enter. The passage is highlighted yellow.
  - The thread opens next to the passage (an inline drawer on mobile).
  - A failed post keeps the draft.
  - Hidden during setup.
- **Panel:**
  - **Unread indicator** in the top bar.
  - Several threads can be open at once, and text can be copied from cards.
- **Replies and reactions:**
  - Replies are chronological.
  - **6 reactions:** 👍 👎 ❤️ 😂 ✓ 🎉. Toggle on or off; hover to see who reacted. Keyboard navigable, RTL-aware.
- **@mentions** notify the person mentioned.
- **Resolve:** hidden by default; Filter → Resolved; can be reopened.
- **Filtering and sorting:**
  - Filter by Open, Resolved, **Unread** or **Archived** (multi-select) and by author(s).
  - **Sort:** Newest, Oldest, Most recently active, **Major first** (severity). The sort is remembered.
  - Peer Review's **Unresolved comments card** opens that review's comments.
- **DOCX export:** **unresolved threads become native Word comments** with replies and authors. Resolved threads are dropped.

### 5.3 Read-only sharing / publishing (`/docs/collaboration/publishing/`)
- **Current method:** read-only sharing is now the **Viewer role on the document link** (or an invite changed to Viewer).
- **Retired feature:** separate "published" links can no longer be created. Old ones may still open read-only.
- **Stopping access:** set Restricted. Existing collaborators keep their role until changed.

### 5.4 Document cloning (`/docs/collaboration/document-cloning/`)
- **How:** Documents panel → right-click or ⋯ → **Duplicate** → "Document cloned" toast. Same title, so rename it.
- **What is copied:** text and formatting, headings, lists, quotes, tables, code (with language), math, images, **citation style**, **font settings**.
- **What is not copied:** collaborators, comments, version history, share links.
- **Ownership:** **anyone with access can clone**, and the cloner owns the copy.
- **Archived documents** cannot be cloned.
- **Suggested uses:** templates, safe experiments, forking someone's document, milestone snapshots.

---

## 6. Export & Import

### 6.1 Exporting (`/docs/export-and-import/exporting/`)
- **Where:** ⋯ (top right) → **Export** dialog with a **Word (.docx) / LaTeX (.tex)** selector (vertical on desktop, horizontal on mobile). **Copy to clipboard** is a separate menu item.
- **DOCX citation modes:**
  - **MS Word native citations** (default): Word citation fields, linked through the References tab.
  - **Hyperlink citations**: suited to Google Docs.
  - Neither mode is updatable by Zotero or Mendeley.
- **Four layout presets:**
  - **Jenni default**.
  - **Double-spaced manuscript**: 12pt Times New Roman, double spacing, 1-inch margins.
  - **Two-column paper**: 10pt, narrow margins.
  - **Thesis or report**: 12pt, 1.5 spacing, **title page and table of contents**.
- **DOCX advanced options:** paper size, columns, font family and size, line spacing, margins, title page, ToC, page numbers, **Include comments**. **Approximate preview** on desktop. **The configuration is remembered per document.**
- **LaTeX:**
  - Produces a **ZIP**: .tex, a .bib if citations exist, images (referenced by path), and code-listing sidecar files.
  - Advanced options: **document class**, columns, paper, font, spacing, margins, title page, ToC, page numbers, **coloured links**.
- **Clipboard:** copies the whole document as rich text (Google Docs, Notion, email).
- **BibTeX / RIS:** exported from the References panel.
- **What survives:** headings, emphasis, strikethrough, lists, alignment, tables, captions, horizontal rules.
  - Images: embedded in DOCX, by path in LaTeX.
  - Math: images in DOCX, native in LaTeX.
  - Comments: DOCX only.
  - **Numbered figure and table labels and cross-references export as live links**, using the current numbering.
- **Bibliography is paywalled:**
  - In-text citations export on every plan; the **appended bibliography needs a paid plan**.
  - On Free, DOCX omits the bibliography, and LaTeX keeps the .bib but drops `\printbibliography`.
  - A note warns before download.
- **Citations in DOCX:** locators and page ranges are kept, including inside lists, blockquotes and tables. Unusual work types (preprints, errata, retractions…) are mapped to DOCX and BibTeX types.
- **Code:**
  - Word uses Consolas plus an italic language label.
  - LaTeX uses `listings` with wrapping and a frame; highlighting for Python, C, Java, PHP, Bash, HTML and Go.
  - Mermaid and Plotly are exported as **images**, including inside Word table cells.
  - If rendering fails, the source is kept.
- **Known limits:** large images are slow; nested tables differ slightly; DOCX equations are not editable; niche CSL styles vary.

### 6.2 Importing (`/docs/export-and-import/importing/`)
- **Routes:**
  - New document → **Import from Word (.docx)** → citation preferences → Start Writing.
  - **Drag a .docx onto the editor** ("Drop your Word doc to import") creates a new document.
  - Paste text from anywhere: + New → Skip and start writing → paste.
- **Title:** taken from the first heading or paragraph.
- **What is stored:** the converted content only. The original file is never stored, and no debug copy is kept on failure.
- **What is imported:**

  | Element | Imported? |
  |---|---|
  | Bold, italic, underline | Yes |
  | H1–H6 | Yes |
  | Lists (8 nesting levels) | Yes |
  | Tables | Yes |
  | Images and following captions | Yes |
  | Hyperlinks | Yes |
  | Alignment | Yes |
  | **Equations (even in table cells) → editable LaTeX** | Yes |
  | ToC | Yes |
  | Page breaks | No |
  | Headers and footers | No |
  | **Tracked changes** | No |
  | Fonts | Normalised |

- **Round trip:** a re-imported Jenni DOCX restores code blocks with their language, **figure/table numbering and cross-references**, and citations re-link automatically. Charts come back as images.
- **Citation matching:** the **Reviews panel opens** to confirm matches. APA, MLA and Chicago match best.
- **Not supported:** no direct Google Docs or PDF import (convert or paste).
- **Validation:** real-DOCX validation rejects .doc, RTF, PDF, ZIP and renamed files. Separate messages cover corrupt or empty files and **network errors**. Missing images are reported as a **count**.

---

## 7. Account

### 7.1 Plans & billing (`/docs/account/plans-and-billing/`)
- **Prices:** Plus $12/month and Pro $29/month (shown in the upgrade-modal screenshot), with an Annual/Monthly toggle.
- **Plan table:**

  | | Free | Plus | Pro |
  |---|---|---|---|
  | Autocompletes | 10/day | 5,000/month | ∞ |
  | AI edits | 5 one-time | 500/month | ∞ |
  | Chat messages | 5 one-time | 500/month | ∞ |
  | Reviews | 3/month | 10/month | ∞ |
  | Workflows | 3 lifetime | 10/month | ∞ |
  | PDF uploads | 10 | ∞ | ∞ |
  | Upload size | 25 MB | 100 MB | 100 MB |
  | Pages per PDF | 150 | 500 | 1,000 |
  | Library export | — | Yes | Yes |
  | All export formats | — | Yes | Yes |
  | Citation styles | — | Yes | Yes |
  | Support | — | Live chat | Priority |

- **Trial:** new users get a premium trial; **remaining days are shown in the sidebar**. Afterwards the account reverts to Free.
- **Upgrading:**
  - From the **usage banner** or sidebar modal near a limit, or from Settings > Billing → Available Plans.
  - Stripe checkout when there is no subscription; an in-app confirmation when already subscribed.
  - **6- and 12-month fixed-term plans** always use checkout.
- **Proration preview:** "You'll be charged X today" or "won't be charged anything today", plus any unused-time credit.
- **Plan changes:**
  - Downgrades apply at the next cycle.
  - Changing plan while a cancellation is scheduled warns, then **replaces the cancellation**.
- **Past Due:** a **Recover** button. A late recovery restarts the billing interval.
- **Cancellation:**
  - **Desktop only**: Billing → Danger zone → Cancel plan.
  - Access continues to the period end (Past Due ends immediately). Data is kept and the subscription can be reactivated.
- **Refunds:** generally none. For a bug, support schedules a **call to demonstrate it**.
- **Payment:**
  - Monthly or annual (annual discounted).
  - **Regional fixed terms with local e-wallets.**
  - Stripe cards (Visa, Mastercard, Amex) plus regional methods.
  - **PPP regional pricing applied automatically.**
- **Invoices and payment status:**
  - Invoices are in the Stripe portal (Manage → Invoice history, as PDF); receipts are emailed.
  - **A card-expiry banner** appears in the editor.
  - A "Payment in progress" lock prevents double checkout and shows the expected completion time.
- **Limit reached:** a **banner names which limit** was reached and AI pauses.
- **Reset rules:**
  - Free autocompletes reset at midnight UTC.
  - Free edits and chat **never reset**; Free workflows are lifetime.
  - Plus resets per billing period. **No rollover.**
  - **Each review type counts separately**: running all five uses 5 reviews. Re-runs count again.
- **Usage view:** Settings > Usage shows the usage breakdown.

### 7.2 Settings (`/docs/account/settings/`)
- **Tabs:** Account, Billing, Usage, Preferences, Connections, Document Defaults. Opened from the profile menu.
- **Account:**
  - Email, sign-in method, Delete Account.
  - **Email change** is for email/password-only accounts: Change → current password → new address → verification link to the **new** address. Google users change it at Google.
- **Preferences:**
  - Interface language, global autocomplete toggle.
  - **Themes:** System, Light, Dark, **Paper Light, Paper Dark, High Contrast Light/Dark**. The OS high-contrast setting applies automatically unless overridden.
  - **GDPR cookie preferences** (turning off marketing consent also unsubscribes).
  - **OS reduced motion** is followed automatically.
- **Billing:** plan, renewal, upgrade/downgrade, payment method, invoices.
- **Connections:** Zotero, Mendeley and the browser extension, each with sync status; disconnect and reconnect.
- **Document Defaults** (new documents only): autocomplete, default citation style (five quick styles or the CSL repository), **font style serif or sans**.
- **Per-document settings** (Document settings in the toolbar or menu):
  - Font, autocomplete, **document prompt** (editable).
  - Citation style ("1,700+").
  - Auto-cite external and Library (limitable to collections).
  - **Citation recency filter** (sources after a given year).
- **Account deletion:** cancel the subscription on desktop first → Delete Account → warning → confirm identity → **Permanently Delete**. Billing, security, fraud and legal records may be kept.

### 7.3 Language (`/docs/account/language/`)
- **Where to set it:** Settings > Preferences → Interface language (the page reloads). Also selectable on the **login and signup pages**.
- **Auto-detection:** from the browser, remembered per browser.
- **16 UI languages:** English (US), English (UK), Simplified Chinese, Traditional Chinese (beta), Hindi, German, Arabic (beta), Korean, Japanese, French, Spanish, Italian, Portuguese (Brazil), Indonesian, Turkish, Russian.
- **AI output language:** follows the **language the student writes in**, independent of the UI language.
- **Edge cases:** new features may be English-only at first; unsupported locales fall back to English (US); clearing browser data resets the choice.

### 7.4 Login & account access (`/docs/account/login-and-account-access/`)
- **Sign-in methods:** email/password and Google.
- **Email verification** is mandatory for every email/password account, including older ones.
- **Password rule:** at least 8 characters, 1 uppercase letter and 1 number, **plus** a special character **or** at least 12 characters. A **live requirements checklist** is shown and password-manager suggestions are supported.
- **Sessions:** persist across browser sessions. A **"Last used" badge** marks the method used last on that browser.
- **Reset link:** validated before the form is shown. An expired or used link offers **Request a new link**.
- **Organisation-provisioned accounts:** a set-password email (no shared default password), then verification, then a confirmation screen.
- **Logout:** avatar → Logout.
- **Same email, both methods:** may open the same account. If it doesn't, contact support.
- **Inactive free-account deletion:**
  - Applies only to accounts that never paid.
  - Schedule: a warning after **6 months** inactive, a second **21 days** later, deletion **7 days** after that.
  - Logging in cancels it.
  - Deletion removes documents, chats, Library, uploads, collections and images.

### 7.5 Mobile (`/docs/account/mobile/`)
- **Platform:** mobile browser only; **no native app**.
- **Floating bottom toolbar** (stays above the keyboard):
  - With nothing selected: Prompts, Cite, AI Edit, Insert (+), Undo, Redo.
  - With text selected: Cite, AI Edit, Review, **Turn Into**, Comment.
  - Overflow goes into a "More" drawer.
- **Panels:** Chat, Reviews, Comments and Settings are **bottom sheets** (swipe down to close). The sidebar is a full-screen overlay that closes when a document is picked.
- **Insert drawer:** H1–H4, lists, tables, code, inline and block math, images, dividers. The slash menu is a drawer.
- **Mobile setup:** Advanced filters hide impact factor and citation count.
- **AI Edit:** a bottom sheet.
- **Images:** a ⋯ menu.
- **Parity list:** autocomplete, Section Prompts, citations, sharing, Library and PDF, export, version history.
- **Exception:** cancellation is desktop-only. Tip: rotate to landscape.

### 7.6 Privacy (`/docs/account/privacy/`)
- **Promise:** "Your writing is private, and it is not training data". No training on drafts, prompts or outputs; no selling; no advertising.
- **What is sent to model providers:** only the context the request needs (text around the cursor, the instruction, the selection, related context). Never the whole account history.
- **Session recordings:** document text, chat messages and chat input are **excluded from product session recordings**.
- **Account deletion:** removes the workspace and closes connections, with legal/billing retention. Details are deferred to the Privacy Policy.

---

## 8. Everything a student can do in Jenni (coverage checklist)

One line per distinct capability, grouped. A tick means "Jenni has it"; the team marks its own coverage alongside.

### Onboarding and navigation
- [ ] Create a document from a conversational setup: prompt (≤5,000 chars), citation preferences, outline mode
- [ ] Rotating example prompts in an empty prompt field
- [ ] Prompt-strength meter (weak / average / great) plus a character counter
- [ ] Citation filters at setup: recency, impact factor, minimum citations, include preprints (mobile: advanced filters)
- [ ] Citation style and filters parsed from the natural-language prompt and pre-applied
- [ ] Start from a DOCX inside setup; skip setup to a blank editor
- [ ] Five-step onboarding checklist in the sidebar with pulsing hint dots and auto-completion
- [ ] At most one contextual hint after first autocomplete use
- [ ] Sidebar views: Documents, Library, Workflows, Find Papers, AI Chat; right panel: Chat, Review, Comments, Settings
- [ ] Trial days remaining shown in the sidebar
- [ ] Free self-paced video course (53 lessons, quizzes, certificate)
- [ ] Academic glossary page (DOI, IF, h-index, OA types, predatory journals, paper structure)

### Document management
- [ ] Documents list with search; open in a new tab
- [ ] Duplicate (clone); the cloner owns the copy; comments, collaborators, history and links are not copied
- [ ] Archive / restore; permanent delete (owner, inline confirm) only from the archive
- [ ] Autosave with an offline queue and a connection indicator
- [ ] "Failed to connect" recovery screen with Retry and a copyable document ID
- [ ] Version history: automatic grouped versions, author per version, read-only preview, restore (undoable), on the Free plan too

### Editor
- [ ] Rich text: bold, italic, underline, strikethrough, highlight (3 colours), inline code, superscript/subscript, links, H1–H4, lists
- [ ] Markdown autoformat (#, -, 1., ```)
- [ ] Slash menu (headings, lists, table, cross-ref, code, chart, image, math, rule)
- [ ] Turn Into block conversion
- [ ] Tables: hover add/delete, merge cells, resize columns, captions
- [ ] Automatic table and figure numbering ("Show labels"), locale-aware labels
- [ ] Cross-references to figures and tables with auto-renumbering and a missing-target relink
- [ ] Code blocks with 15-language highlighting
- [ ] Chart block: Plotly or Mermaid source with live preview, or Describe in plain English → Generate
- [ ] Fix with AI for broken charts
- [ ] Chart download (PNG/SVG), copy source, expand
- [ ] Images: drag, paste, toolbar or /image; PNG/JPEG/WebP ≤15 MB; align L/C/R; captions; retry on load error
- [ ] Ask AI about an image (describe, OCR, chart reading, alt text)
- [ ] Math: KaTeX inline ($$) and block ($$$), popover editor with live preview, presets, copy LaTeX
- [ ] Fix with AI for broken LaTeX
- [ ] Auto table of contents in the margin
- [ ] Live word count; word count of a selected caption
- [ ] Find in document
- [ ] Up to 10 concurrent editors with labelled cursors
- [ ] Keyboard accessibility (skip link, toolbar arrow navigation), screen-reader announcements
- [ ] Themes incl. Paper and High Contrast; OS reduced-motion and contrast respected
- [ ] Font style serif/sans per document

### Prompts and guidance
- [ ] Document prompt (whole-document guidance), editable at any time
- [ ] Section Prompt per heading, inherited by sub-headings
- [ ] Auto-generated Section Prompt bullets (1–3 per H2/H3) from outline generation
- [ ] Per-section source control: pin PDFs, one collection, or disable sources
- [ ] Generate-from-section button
- [ ] Guidance learnt automatically from guided-autocomplete directions and thumbs-down feedback

### Outline generation
- [ ] Heading modes: none, IMRaD standard, Smart (AI-chosen)
- [ ] Ghost outline while generating; title plus headings only (no body text)
- [ ] Setup prompt refined into a document prompt after generation
- [ ] Output in the prompt's language

### Autocomplete
- [ ] Inline ghost-text continuation using headings, prompts, citations and prior text
- [ ] Accept all (→/Tab), accept word by word (Alt+→), dismiss (Esc), force (Ctrl+/)
- [ ] Mid-paragraph suggestions
- [ ] Multiple alternatives with switch arrows
- [ ] Guided Autocomplete ("Refine suggestion"): free-text direction plus presets (e.g. no citations)
- [ ] Formatted preview (lists, math, tables, citations) before accepting
- [ ] Inline auto-citations from the Library and/or external sources (per-document toggles, collection limits)
- [ ] Hover a suggested citation to preview the source
- [ ] Global on/off switch in the toolbar
- [ ] Language follows the document language

### AI Editing
- [ ] Selection command menu with diff (green/red) plus a change summary
- [ ] Replace / Insert below / Retry / Discard
- [ ] Paraphrase in 5 tones; Fluency; Simplify; Make longer; Strengthen argument; Counter-argument
- [ ] Summarize; Write opposing argument; Write with more depth
- [ ] Change tense (past/present/future)
- [ ] Prose ↔ bullet list / numbered list / table conversion
- [ ] Translate (EN, ES, DE, FR, ZH, JA)
- [ ] Increase formality; Technical precision; Increase or Hedge claim confidence
- [ ] Free-form custom instruction
- [ ] AI Edit a whole table
- [ ] Context for the edit: web search, Library search, attach or upload a PDF
- [ ] Section Prompt included automatically

### AI Chat
- [ ] Chat panel (resizable, collapsible), threads with history, rename, delete, new
- [ ] Current-document toggle
- [ ] Send a selection as a quote/temporary source
- [ ] Add context: Library PDFs, collections, the document; @-mention a source or collection
- [ ] Web and Library search each Off / Ask / On (default Ask), also in Settings
- [ ] Account-level citation filters (year, IF, citations, preprints)
- [ ] Cited answers with hover metadata
- [ ] References tab (style and locale per thread, copy one or all)
- [ ] Sources tab (citation count, IF, OA; save one or all to the Library/collections)
- [ ] Natural-language reference commands ("show references in APA")
- [ ] Tables with Copy table; Mermaid diagrams; bar/line/scatter/pie/histogram charts
- [ ] Attach images (incl. handwritten notes) and multiple PDFs (auto-saved to the Library; waits for processing)
- [ ] Ask AI from a source's details or an image
- [ ] Tool-routing cards (open lit review, gap analysis, proofread, peer review, support)
- [ ] Saved prompts as /commands (unlimited, private, searchable); built-in PDF prompts (summarize, limitations)
- [ ] 50,000-character message cap with guidance
- [ ] Chats private from collaborators

### Reviews
- [ ] Proofread (grammar, punctuation, word choice, formality, passive voice, repetition, formatting; British spelling aware)
- [ ] Claim Confidence (unsupported, weak, overstated, misrepresented, contradicted, unverifiable) with source excerpts
- [ ] Configurable Claim Confidence sources (Library/external, collection, year, IF)
- [ ] Source Quality (retracted, preprint, non-research, rarely cited, unverified journal) plus bibliography age/venue notes
- [ ] Source Quality fixes: keep, remove, replace with published version, find replacement inline
- [ ] Tone of Voice, optionally against a Library PDF as the style reference
- [ ] Peer Review: overview, ratings, overall score, strengths, weaknesses, reviewer questions, anchored comment threads with citations
- [ ] Peer Review history (read-only past runs) and export (print/PDF, HTML on mobile)
- [ ] Review a selection only (Selection badge)
- [ ] Summary plus category counts and filters
- [ ] Inline suggestions with reasoning popups
- [ ] Review mode: locked editor, Y/N/↑/↓/Esc, counter, Accept All / Reject All
- [ ] Section progress bar
- [ ] Runs survive closing or refreshing (reconnect); stop restores previous results
- [ ] One review at a time across documents
- [ ] Thumbs feedback per suggestion

### Workflows (long-running agents)
- [ ] Literature review workflow: topic → sources (web, Library, collection) → filters → about 15–20 min run with named phases and an activity log
- [ ] Literature review output is a new cited document (tables, diagrams, charts)
- [ ] Research gap analysis workflow: about 3–6 min; gap map, supported, contested, under-explored, directions, limits of material
- [ ] Runs persist across tab, reload and device; email on completion; stop/run again/edit topic
- [ ] Recent runs (3); run topic becomes the document prompt
- [ ] Workflow allowance meter in Usage and the profile menu

### Citations
- [ ] Cite via toolbar, @ inline, highlight-and-cite, from the Library, or the Find Papers sidebar
- [ ] Find Papers: search by a sentence from the draft; suggested queries from the title or history; sort and filter
- [ ] Search tabs All / Discover / Library; year (decade grid) and minimum-citation filters saved per document
- [ ] Identifier resolution: DOI, PMID, PMCID, arXiv, DOI/PubMed/PMC URLs, a whole pasted reference
- [ ] Smart paste of a DOI: as citation / link / text
- [ ] Custom citation and placeholder citation
- [ ] Include-preprints toggle (default on)
- [ ] Per-document source scope (sources plus one collection)
- [ ] 5 quick styles plus searchable CSL repository (10,000+), locale, page-number toggle, live previews
- [ ] In-text forms: parenthetical, narrative, multiple, grouped, page ranges
- [ ] Citation editor: locator, prefix, suffix, narrative/parenthetical, remove
- [ ] Contributor roles (editor, translator, interviewer…) per contributor
- [ ] Automatic live bibliography with style-appropriate heading (References / Works Cited / Bibliography)
- [ ] Sources in this document: save cited sources to the Library
- [ ] Reference list copy, Copy as BibTeX, Download .bib
- [ ] Citation matching for imported Word documents (pending matches to confirm)

### Library and research
- [ ] PDF upload (drag/drop) with metadata and abstract extraction, OCR for scanned PDFs incl. math and tables
- [ ] Processing / Queued states with auto-retry
- [ ] Zotero import (personal and group libraries) and Mendeley import; one-way, re-importable
- [ ] BibTeX / RIS bulk import; DOI / PMID / ISBN import with automatic PDF fetch, Missing PDF warning, Fetch retry
- [ ] Save search results to the Library without citing (reading list)
- [ ] Nested collections, multi-collection membership, inline create, bulk add/remove, add from library
- [ ] Full-text Library search (titles, authors, abstracts, PDF body)
- [ ] Library filters: PDF status, year, impact factor tiers, open access, 35+ work types, collection
- [ ] Metadata editing
- [ ] BibTeX / RIS export of selected sources (paid)
- [ ] Duplicate detection with Library Issues review (keep one / trash one)
- [ ] Missing-PDFs tab with drag-onto-row attach
- [ ] Drop a PDF on the editor to add it to the Library
- [ ] Built-in PDF reader beside the document: thumbnails, zoom, search ("X of Y"), copy with citation, quote to Chat
- [ ] Open-access papers surfaced in Chat and Discover; one-click save with full text
- [ ] Browser extension: single-page save, bulk save from PubMed/arXiv/Google Scholar result lists, collections, retry failed items

### Collaboration
- [ ] Invite by email (default Editor); roles Editor / Commenter / Viewer; change role before acceptance; resend/cancel invite
- [ ] Link sharing: Restricted vs Anyone-with-link at a chosen role; copy link
- [ ] Request access / request edit access flows with owner approval
- [ ] Live role downgrade reload
- [ ] Comments anchored to text; replies; 6 reactions; @mentions with notifications; resolve/reopen
- [ ] Comment filters (open, resolved, unread, archived, author) and sorts (newest, oldest, active, major first)
- [ ] Unread-comments indicator
- [ ] Unresolved comments exported as native Word comments
- [ ] Peer Review produces comment threads in the Comments panel

### Export and import
- [ ] DOCX export with native Word citation fields or hyperlink citations
- [ ] Layout presets: default, double-spaced manuscript, two-column, thesis/report with title page and ToC
- [ ] Advanced layout options (paper, columns, font, spacing, margins, title page, ToC, page numbers, comments) with approximate preview, remembered per document
- [ ] LaTeX ZIP export (.tex, .bib, images, listings sidecars) with document class and coloured links
- [ ] Copy whole document as rich text
- [ ] Figure/table numbering and cross-references preserved in export
- [ ] Charts and diagrams exported as images
- [ ] Bibliography in export gated to paid plans, with a warning before download
- [ ] DOCX import (button or drag onto the editor): headings to H6, 8-level lists, tables, images and captions, links, alignment, equations to LaTeX, ToC
- [ ] Lossless round-trip of Jenni's own DOCX (code language, numbering, citations)
- [ ] Clear import errors (invalid, corrupt, empty, network, count of missing images)

### Account, plans, platform
- [ ] Email/password (strong password rule with a live checklist) or Google; mandatory email verification; "Last used" badge
- [ ] Password reset with link validation and request-new-link
- [ ] Organisation-provisioned accounts (set-password email)
- [ ] Email change with re-verification of the new address
- [ ] Account deletion (after cancelling the subscription)
- [ ] Inactive free-account deletion with two warnings
- [ ] 16 interface languages (incl. Hindi), browser auto-detect, selectable on login/signup; AI follows the writing language
- [ ] Three plans plus a trial; usage tab and profile usage meter; limit banners naming the limit
- [ ] Upgrade with a proration preview; downgrade at cycle end; Past Due recovery; desktop-only cancellation
- [ ] Monthly / annual / regional 6–12-month fixed terms, local e-wallets, automatic PPP pricing, Stripe invoices, card-expiry banner
- [ ] Settings: Account, Billing, Usage, Preferences (theme, language, autocomplete, GDPR cookies, search permissions), Connections, Document Defaults
- [ ] Per-document settings: font, prompt, citation style, auto-cite toggles, recency filter
- [ ] Full mobile-web editor: floating toolbar, bottom sheets, insert drawer, mobile AI Edit and Section Prompts
- [ ] Privacy: no training on user content, minimal context sent, editor and chat text excluded from session recordings
