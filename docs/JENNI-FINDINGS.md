# Jenni, used first-hand — 2026-10-04

The owner's own Jenni account (free plan), one test thesis: *Solar drying of marine fish in coastal
Tamil Nadu*. Used sparingly: 1 autocomplete accepted, 1 review, 1 chat message. Every observation
below was seen on screen; timings are from screenshots, not claims.

## What happened

| Step | Jenni | Seen |
|---|---|---|
| Start | Prompt box with a strength meter ("Weak" → "Great prompt") → citation preferences (style, web search, year, impact factor, minimum citations, preprints) → heading mode → Start Writing | 4 clicks, ~8 s to a titled document with 5 headings, a notes panel per heading ("Generate", "Configure context"), autocomplete on, cursor in the first section |
| Autocomplete | Appeared on a pause, **< 3 s**, with an empty library | One sentence with a specific figure and two citations Jenni found itself |
| Grounding | Clicking the citation: title, authors, journal, year, **cited-by count, impact factor, Open Access badge**, the **quoted passage**, "Open quote" into the PDF | The figure (₹15,000 crore) is in the quoted passage — real full-text grounding, not an abstract |
| Cite a sentence | Select → Cite: a paper search panel (All / Discover / Library, sort, filter), each result with its matching passage, Cite / Open quote / Save | ~4 s |
| Review: Claim confidence | An agent: "thinking", three visible database searches; result in **22 s** | Flagged the Coromandel-coast claim as unsupported and the second citation as not supporting the figure — **it caught its own autocomplete's weak citation**. Six categories, tracked changes, accept/reject each |
| Chat | An agent: plans, searches academic databases and the library, **asks before searching the web**, synthesises, verifies, cross-references, evaluates its answer; ~90 s | Structured answer with headings, specific numbers each cited, a takeaway for the thesis's own context, an offer to write it into a named section |
| References | Built automatically at the end of the document with a style picker | **Locked on the free plan** ("References are a paid feature") |

## Where Jenni is technically ahead

1. **Grounding on full text, instantly, from the whole index.** Jenni cites the passage inside a
   paper the student never added, in under three seconds — so it must hold full text of open-access
   papers pre-indexed (it claims 10M+). We search OpenAlex live, then download and index a PDF per
   student, which takes minutes; until then we cite abstracts only. **This is the largest gap.**
2. **Agents, not single calls.** Review and Chat plan, search several times, verify and evaluate,
   and show their steps. Our coherence check and chat are single model calls over what is already
   in the library.
3. **Quality signals on every citation**: cited-by, impact factor, open access, on the card itself.
4. **The start**: one prompt with a strength meter produces a structured document with per-section
   notes, in seconds.

## Where we are ahead or equal

- Our grounding is **enforced in code** (a citation the model invents is stripped and counted);
  Jenni's autocomplete added a weak citation that only its own review then caught.
- Supervisor cycle, compliance checks, Word export with real equations, viva practice, chapter
  build with checks, Indian university templates, ₹ pricing — none of which Jenni has.
- Jenni's free plan **hides the reference list**; ours does not.

## What to build, in order

1. **A shared full-text passage index of open-access papers**, filled once per paper for everyone
   (not per student): every paper any student adds or any search fetches is indexed site-wide, so
   the second student on a topic gets instant full-text citations. Combined with OpenAlex semantic
   search, autocomplete can cite papers not yet in the library — shown as "add to library" on
   accept, so nothing enters a thesis unasked. This is an ADR-sized change and a storage cost.
2. **Agentic review and chat**: search → read → verify → answer, with the steps shown; reuse the
   coherence support check (ADR-0023) as the verifier.
3. **Citation cards** with cited-by, journal citedness (ADR-0040 already fetches it) and open access.
4. **Prompt-first start**: one prompt → outline with per-section notes → editor, with the cursor in
   the first section (our proposal + outline, merged into one screen).

## Literature review workflow (Jenni's "Workflows", BETA)

Topic → web/library switches → filters (year, impact factor, cited-by, preprints) → "Start literature
review · 15–20 min". Four visible stages: Searching → Selecting literature (ranked on relevance,
recency and citations) → Drafting sections → Assembling and citing; "safe to close this tab — you will
receive an email". Before drafting, it wrote a **topic-specific expert brief per section** (quality
indicators TVB-N, TMA-N, water activity; Page / Henderson-Pabis / Midilli models; women and
self-help groups in dried-fish chains). **It failed** after 24 minutes in the last stage: "Something
went wrong while generating the literature review. Please try again." Not rerun.

What to take: the per-section brief written by the model from the topic before any drafting. Our
chapter build plans from discipline blueprints and the key terms; a topic-specific brief per section
(one strong call, checked against the passages found) is the cheapest large quality gain available.

## Their stack, from the student's own browser (2026-10-04)

Next.js App Router frontend; a typed RPC backend (`app.backend.jenni.ai/…/jenni.Service`,
snake_case methods such as `search_library`, `get_library_aggregates` — likely Python); Firebase Auth
and Firestore (real-time document and job state); PostHog through their own domain (flags,
experiments, surveys); Sentry; Microsoft Clarity session recordings; Intercom; Stripe with Churnkey;
marketing pixels. The model vendor and prompts are server-side and not visible. Nothing here is
exotic: the lead is product engineering — a pre-built full-text index, agentic review and chat,
topic-specific planning — and measuring every session.

## The same tests on ours (dev stack, real models, 2026-10-04)

| Test | Ours | Jenni |
|---|---|---|
| Add a paper by DOI until its text is citable | 10 s to FULL_TEXT for a paper in PMC (ADR-0054). A Springer paper outside PMC: 83 s, abstract only | ~40 s, full text |
| Autocomplete, first word | 2.7–3.4 s | 1.9–2.8 s |
| Chat over one paper, figure in a table | 1.8 s, both figures cited (after ADR-0054) | ~97 s, agentic, complete |
| Equations in chat | Typeset (fixed today) | Typeset |

What remains: Springer Nature papers outside PMC need the Springer Nature Open Access API key
(`docs/PENDING.md`). Jenni's chat is slower but searches beyond the library; ours answers only from
what the student has added.

## The remaining features, first-hand (2026-10-04, second pass)

Used sparingly: one section Generate and one "Validate supporting evidence" refine, neither
accepted. Free-plan usage after both passes: 1 autocomplete accepted, 2 chats, 1 review, 1 AI Edit,
1 workflow run (failed), 1 PDF import.

| Feature | What Jenni does | Ours |
|---|---|---|
| Section prompts | A side panel: a document prompt, and per heading the bullet notes written at the start. Each has **Configure context** (switch sources off, or pin chosen sources) and **Generate** | Chapter scope notes (outline), used by Assist for the whole chapter; no note per sub-section, no per-section source pinning |
| Generate | ~5 s, **one sentence** shown as an autocomplete suggestion (Accept / Refine), guided by the section's notes, citing two papers not in the library. Not a section draft | Draft mode writes a section; chapter build writes a chapter |
| Refine suggestion | A prompt box and presets: Stay on topic, Complete this paragraph, Increase novelty, Simplify language, Re-write without citations, **Validate supporting evidence**, Cite from my library. Validate took ~15 s ("Thinking", "Analyzing") and returned a reworded sentence with a second citation. Arrows step through earlier suggestions | Shift+→ asks for a suggestion with a typed instruction; no presets, no history of suggestions |
| AI Edit (Ctrl+J) | 17 actions: Improve fluency, Paraphrase, Simplify, Strengthen argument, Add a counter argument; Change tense, bullet / numbered list, prose, table, Translate; Academic style, Increase formality, Technical precision, Increase / Hedge claim confidence; Web and Library switches | 5: Expand, Formalise, Simplify, Shorten, Check consistency |
| Shortcuts | → accept, Shift+→ next suggestion, Alt+→ one word, Ctrl+/ suggest, Ctrl+J edit or chat, Ctrl+↑/↓ move block, @ cite. Markdown and KaTeX help tabs | → / Tab accept, Alt+→ one word, Ctrl+/ suggest, Shift+→ guided suggestion |
| Version history | Automatic snapshots minutes apart, author, read-only preview, Restore. No diff shown | Version history exists (ADR-0018) |
| Share | Collaborators and owner; general access Restricted or anyone with the link. No roles, no supervisor workflow | Guide/committee shares with comments, scoped revisions, review queue, co-author |
| Export | Word with **native Word citation fields** (linked to Word's References) or hyperlinks; LaTeX with four layouts (default, double-spaced manuscript, two-column, thesis with contents) and advanced options. Free plan exports without the bibliography | Word, PDF, LaTeX, HTML; university template and compliance checks; citations written as plain text |
| Library | Upload up to 10 PDFs (25 MB, 150 pages each), **Zotero and Mendeley account import**, .bib/.ris, paste an ID; collections; impact factor on each item | .bib/.ris (exported from Zotero/Mendeley), DOI, PDF; no account link |
| Paywall | "References are a paid feature" is a blur: the full reference list is already in the page | Not applicable |

**Worth building, in order of value to a thesis student:**
1. **Word citation fields on export.** Students finish in Word; citations that stay live in Word's
   References survive their last-minute edits. Ours become dead text.
2. **Refine presets on a suggestion**, especially "Validate supporting evidence" (we have the
   citation-support check, ADR-0023, to back it) and "Cite from my library".
3. **Sub-section notes** that Assist reads for the section under the cursor, with per-section
   source pinning.
4. **More selection actions**: counter argument, hedge / strengthen a claim, convert to table,
   change tense, translate. Each is a prompt, so each needs an Appendix-A-style prompt and an eval.
5. Zotero account import (OAuth, their API) — lower value: the file route works today.
