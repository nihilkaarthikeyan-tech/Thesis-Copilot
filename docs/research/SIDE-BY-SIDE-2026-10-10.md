# Side by side, Jenni vs Thesis Copilot — nine journeys (2026-10-10)

Observed and recorded only; nothing was built. Earlier verdicts: `side-by-side-2026-10-05.md`,
`../JENNI-UX-STUDY.md`, `../JENNI-FIX-LIST.md`, `coverage-map.md`.

- **Jenni:** app.jenni.ai, the owner's free account, a new document ("SBS test 2026-10-10 rooftop solar").
- **Ours:** production v0.1.40 (thesis.rademics.ai), the owner's account, a new thesis
  (`/app/d/01a12228-c1d9-79ad-9a66-d4ab84311d44`, "Financial barriers to rooftop solar adoption
  among rural households in Karnataka"). Both test documents are still in the accounts.
- **Same topic** on both: "Barriers to rooftop solar adoption among rural households in Karnataka";
  the same typed sentence ("Rooftop solar adoption among rural households in Karnataka remains low
  despite state subsidies."); the same chat question; the same paper query; IEEE on both.
- **Times** are wall-clock from the automation transcript (Chrome, 2026-10-10 01:02–01:34 IST);
  each is bounded by the screenshot interval, so "≤ 5 s" means "present at the first look, 5 s later".
- **Screenshots:** `sbs-2026-10-10/` (58 files, `jenni-*` and `ours-*`; the name says what each shows).
- **Not measured:** the ~390 px mobile view — Chrome refused to shrink the maximised window below
  1707 px in two separate attempts, so neither side was seen on a phone. Jenni's export dialog was
  not reached (the More menu exposed no Export item to the accessibility tree); its export facts
  below are from the 2026-10-05 study. Jenni's free plan hit "Chat limit reached" after one
  question, so chat was one exchange each.

Winner key: **J** Jenni, **O** ours, **=** even.

## 1. New document → setup → outline → first cited sentence

| Step | Jenni | Thesis Copilot | Winner | Why |
|---|---|---|---|---|
| Coming back | Lands in the last document, cursor in the text, chat beside it (`jenni-0`) | Lands in the last chapter's editor, Chat tab open (`ours-0`) | = | Both 0 clicks to keep writing now (fixed since the 10-05 study) |
| Create | New → Create new document → one prompt box with a Weak/Great meter, Import from Word, "Skip and start writing" (`jenni-1a`) | New → New thesis: the editor opens at once with a "Set up this thesis 1 of 5" card above Chapter 1 (`ours-1a`, `ours-1b`) | = | Both one click; ours stays in the editor the whole way |
| Setup screens | 3: prompt → citation preferences (style, web/library, year, impact factor, cited-by, preprints; `jenni-1b`) → structure (IMRaD / Smart headings / none; `jenni-1c`) | 5: title + style → field and university → one research-design question with four tappable answers (`ours-1d`) → aim and 3 objectives written from the answer (`ours-1e`) → keep / standard / no chapters (`ours-1g`) → first line (`ours-1h`) | O | Ours produces an aim, objectives and 7 chapters with sections from one tap; Jenni produces headings. Jenni's filters (year, impact factor, cited-by) are one screen; ours hides them behind "Change" |
| Time, create → first cited sentence | **~51 s** (01:03:02 → 01:03:53), ≤ 16 s of it after Start Writing | **~70–85 s** (01:04:18 → ≤ 01:05:43), ≤ 9–24 s of it after "Plan my chapters" | J | Two more screens on ours; the model step itself is as fast |
| What lands on the page | Title, 11 headings, a note per section in a left panel, cursor in the Introduction, one cited sentence with Accept / Refine / thumbs below it (`jenni-1d`) | Chapter 1 — Introduction with 4 sections, 7 chapters in the rail, a two-sentence cited paragraph, Accept / One word / Refine / Dismiss bar (`ours-1g`) | = | Jenni's per-section notes are visible; ours are not. Ours has sections per chapter |
| First sentence's citation | Shivasharanappa 2026 — Karnataka-specific (`jenni-1d`) | Mutumbi 2024 — a **South Africa** scoping review, the only "full text" paper in the automatic library (`ours-1f`) | J | See journey 4: our paper search found no Indian paper |
| First sentence's honesty | Nothing checked | Flagged by our own code: "follows Mutumbi 2024's wording closely… Put it in your own words, or quote it" (`ours-1f`) | O | The check is right; but the first thing a new student sees is a warning on the product's own suggestion |
| Layout | Clean | The suggestion bar sits over the paragraph it belongs to (`ours-1g`); the typed title lost a letter ("adopion", `ours-1c`) — possibly the automation's keystroke, unconfirmed | J | |

## 2. Writing: autocomplete, accept, refine, citations, style

| Step | Jenni | Thesis Copilot | Winner | Why |
|---|---|---|---|---|
| Typing after the scaffold | The typed sentence landed beside the title line, not under a heading (`jenni-2a`); three Ctrl+Z wiped every heading — "Your document has no sections" (`jenni-2b`) | The click put the cursor at the end of the "Problem statement" heading, so the sentence became heading text; a toast said "Suggestions go in paragraphs, not headings" (`ours-2a`); one Ctrl+Z removed all four sub-sections (`ours-2b`) | = | Both scaffolds are fragile to the first click and the first undo; ours at least explains |
| Suggestion on a pause | ≤ 4 s, two citations, both Indian (Burke 2019; Kasinathan 2019) (`jenni-2c`) | ≤ 5 s, one citation, South Africa (`ours-2c`) | J | Speed even; relevance Jenni's (library, journey 4) |
| Evidence before accepting | Hover a citation: cited by 74, IF 11.61, journal, quoted passage, Open quote (`jenni-2d`) | Click Evidence: "We hold the full text", cited by 19, open access, quoted passage with section name (`ours-2d`) | = | Equivalent; ours says whether the full text is held |
| Accept | → or Accept; the next suggestion chains in ≤ 5 s with two more Karnataka papers (Kawle 2025; Manjeshgowda & Devaraja 2025) (`jenni-2e`) | Tab / Accept / One word; "Writing…" and the next chains in ≤ 5 s (`ours-2g`) | = | |
| Refine | 7 presets + a prompt box; ‹ › through earlier versions (`jenni-2f`) | 13 presets in three groups + "Your own instruction…", ‹ 2 of 2 › history (`ours-2e`) | O | More presets, each costed ("uses one of your Assist suggestions") |
| Refine result | "Simplify language" ≤ 5 s — and **swapped a citation** (Kawle 2025 → Karakaya & Sriwannawit 2015) without saying so (`jenni-2g`) | "Simplify language" ≤ 6 s, same citation kept (`ours-2f`) | O | A refine that changes the evidence is a grounding fault |
| Refine layout | Menu replaces the bar | The preset menu opens **over** the still-open evidence card (`ours-2e`); after refining, the card still covers the new text (`ours-2f`) | J | Visible layout fault |
| Citation rendering | "(Burke et al., 2019; Kasinathan et al., 2019)" inline from the start | Shown as "(Mutumbi 2024)" while suggested and after accept (`ours-2g`), then "(Mutumbi et al., 2024)" once the Citations tab renders it (`ours-2h`); one suggestion put the citation **after** the full stop ("Karnataka. (Mutumbi 2024)", `ours-2c`) | J | Two renderings of one citation; placement fault |
| Style change | Document settings → search 10,000+ styles, locale, page numbers, live preview (`jenni-2h`, `jenni-2i`); IEEE applied as [1], [2] | Citations tab → 10,863 styles, locale, example preview, bibliography (`ours-2h`); IEEE applied as [1] (`ours-2i`) | = | |

## 3. AI chat

Question on both: "What are the main financial barriers to rooftop solar adoption for rural
households in India, according to my sources?"

| | Jenni | Thesis Copilot | Winner | Why |
|---|---|---|---|---|
| Before answering | Shows steps (Planning, Processing, Considering, Searching library with two sub-queries) and asks "Search your library? Skip / Always allow / Allow this time" (`jenni-3a`) | "Your library has 2 papers on this. I can search the literature too… Allow this time / Always allow / Skip" (`ours-3a`) | = | Same shape |
| Time | "Thought for 59 seconds"; answer complete between 60 s and 110 s | Answer complete ≤ 48 s including the literature search | O | |
| Honesty about the library | Said the only indexed library paper was a 2025 study on **anchovy drying** — true (the owner's library had it) — then answered from 7 external sources, mostly urban, with a "caveat for your rural households framing" and an offer to search rural-specific papers (`jenni-3b`) | "The sources in your library point to high up-front cost… evidence on credit access or subsidy awareness for rural India is not provided"; "What these sources do not cover" section; 1 source; Copy / Add to document | = | Both honest. Jenni's is richer (9 citations, 4,100 chars, a next step); ours is grounded in what was actually read |
| After one question | "Chat limit reached — Upgrade" (`jenni-3c`); the 7 references paywalled ("Upgrade to view, copy, and export references", `jenni-4b`) | Questions to your library 2 / 5 on the trial | O | A free Jenni student cannot see what the answer cites |

## 4. Library and paper search

Query on both: "solar PV adoption India".

| | Jenni | Thesis Copilot | Winner | Why |
|---|---|---|---|---|
| Where | Find papers panel beside the text; suggested query from the document; recent searches (`jenni-4b`) | Papers tab beside the text; suggested query from the title; Add into collection; sort; open-access filter (`ours-4a`) | = | |
| Result | ≤ 4 s: Trivedi & Kaur 2025 "Drivers and Barriers of Solar PV Adoption in India", Raghavendra 2026, Satapathy 2019 "Consumer Adoption of Rooftop Solar PV in India", Kumar 2023 — IF and cited-by on each, Cite / View / Save (`jenni-4a`) | Suggested query: 5 papers in ≤ 4 s — South Africa, Nepal, Australia, Beirut, New York; **none Indian** (`ours-4a`). "rooftop solar adoption rural India": **0 papers** (`ours-4b`). "solar PV adoption India": 8 papers led by **"The Comet Interceptor Mission"** and "Solar cooking innovations" (`ours-4c`) | **J, decisively** | |
| Why ours failed | — | A probe of `POST /chat/web` from the page: every result carried `via: pubmed` or `arxiv`; OpenAlex and Semantic Scholar returned nothing for three queries (2.7 s each). `apps/api/src/modules/assist/web-scope.service.ts:188` turns a failed index into `[]` with only a log warning, so a dead OpenAlex looks exactly like "no papers" — the same fault as `JENNI-FIX-LIST.md` A.2 for the proposal search. Needs the production log read; not diagnosed further here | | |
| Library view | Sources / Collections, "1 missing PDF — Review", Cite / Details / Upload PDF per item (`jenni-4c`) | Sources page: export .bib/.ris/.csv, Import, Zotero, Paste an ID, Add a PDF, collections, Full text / Without / Needs a hand filters (`ours-4e`) | O | More ways in and out |
| Library consistency | — | Header "3 in the library · 3 with full text" above a banner "1 paper has no PDF, so only its abstract can be quoted" (`ours-4e`); editor Sources tab lists the three with "Full text" while one is abstract-only (`ours-4d`) | J | Two counts disagree on one screen |
| Add by DOI | Not tested | Paste an ID → found, preview, Add to library ≤ 5 s (`ours-4f`); the same DOI again: "is already in your library" (`ours-4g`) | O | |
| Reader | PDF viewer (10-05 study) | In-app reader: select → Copy with citation / Cite in my chapter / Ask chat / four highlight colours / Note (`ours-4h`) | O | |

## 5. AI edit of a selection

| | Jenni | Thesis Copilot | Winner | Why |
|---|---|---|---|---|
| Menu | Find citations · AI Chat · AI Edit (17 actions in three groups) · Comment · Review | 22 actions in three groups, a free instruction box, Use my library / Search the literature, plus Comment · Find papers · Examiner review · Ask chat (`ours-5a`) | O | |
| Result | Paraphrase ~8 s: new text, "What changed and why", Web / Library switches, Replace / Insert below / Try again / Discard | Formalise ~8 s: **inline diff** (struck and inserted words), "56 → 51 words", four bullets of what changed and why, "Ask for a change to this version…" follow-up, Discard / Try again / Insert below / Replace (`ours-5b`) | O | The diff shows exactly what moved |
| Grounding | The paraphrase rewrote "[1], [2]" as "(Kasinathan et al., 2019)(Burke et al., 2019)" — author-year inside an IEEE document, no separator | Citation kept as [1] | O | |
| After Discard | Clean | The edit menu stayed open over the page after Discard and after Escape (`ours-5c`) | J | Visible fault |

## 6. Checks and review

| | Jenni | Thesis Copilot | Winner | Why |
|---|---|---|---|---|
| Where | One Review panel: Claim confidence, Peer Review, Source Quality, Tone of Voice, Proofread — one "Run review" each (`jenni-6a`) | One Check tab: "Every check, in one list", Examiner review, coherence (not in plan), Spelling and grammar, Tone of voice (match my profile or a named paper), Too close to a source, Source quality (`ours-6a`) | = | Both one place now |
| What ran free | Source Quality only (~10 s): "No quality issues… median year 2016; 2 of 2 dated works over a decade old" — for two 2019 papers. The other four: UPGRADE | Too close: ~4 s, "Nothing to flag. 8 sentences checked". Source quality: ~5 s, year and venue chart, Nepal preprint flagged "not yet peer reviewed". Examiner review ran and caught the real fault: "cites no evidence from Karnataka; the only provided passage discusses South Africa" (`ours-7a`, bottom). Proofread: **"Monthly limit reached — Section commands 2 of 2 used"** after the two edits in journey 5 | O | Ours runs; Jenni sells. But a trial of 2 section commands a month is spent in five minutes |

## 7. Export

| | Jenni | Thesis Copilot | Winner | Why |
|---|---|---|---|---|
| Dialog | Not reached this run; 10-05: .docx / .tex, Word citation fields or hyperlinks, free plan drops the bibliography | Chapter or whole thesis; Word or PDF; citations as plain text / linked / Word citation fields; four layouts; Advanced: paper, font, size, spacing, margins, title page, contents, page numbers, guide's comments; a page preview (`ours-7a`) | O | |
| Preview fidelity | — | The preview renders the paragraph **without its [1]** ("…in these communities .") (`ours-7a`; the dialog text confirms the empty space before the full stop) | J | The one thing a preview must not lose |

## 8. Settings, usage, pricing, mobile

| | Jenni | Thesis Copilot | Winner | Why |
|---|---|---|---|---|
| Price in India | Plus ₹580.50/month billed yearly (₹1,161 monthly), Pro ₹1,402.92 (₹2,805.83); "50% local discount"; Plus = 5,000 autocompletes, 500 edits, 500 chats, 10 reviews, 10 workflows (`jenni-8a`) | ₹299/month or ₹2,499/year; payments not switched on ("during the pilot your allowances are set by hand") | O on price | Jenni's cheapest paid month is 3.9× ours |
| Usage | Account menu bars per allowance | ··· → Usage "Assist 2/50 · Draft 1/2" (`ours-8a`); Account page: 9 allowances with counts, reset date, what counts | = | |
| Trial friction seen | Free: chat 1 question, reviews paywalled, references paywalled | Trial: Section commands 2/month (blocked proofreading), Draft 2, Questions 5, Coherence 0 | = | Both throttle the free student within minutes; ours spends the tightest cap on edits, which is where a student lives |
| Mobile ~390 px | Not measured | Not measured | — | Window would not shrink (see top) |

## 9. What each has that the other lacks

| Jenni only (seen) | Ours only (seen or confirmed in code) |
|---|---|
| Workflows: Literature review and Research gap analysis as new documents, with a prompt meter (`jenni-9a`, `jenni-9b`) | Chapter build (ADR-0039), viva preparation, examiner review of a chapter or a selection, submission bundle with compliance checks, guide/committee cycle, journal matching |
| Document prompt + per-section prompts panel with Configure context / Generate (`jenni-1d`) | Research-design question at setup that writes an aim and objectives (`ours-1d`, `ours-1e`) |
| 250M-paper index with IF and cited-by on every result, answering in ≤ 4 s | Too-close-to-a-source check, run in code with no model (`ours-6a`) |
| Chat with steps shown and a 59-second "thought" | In-app reader with highlights, notes and Cite in my chapter (`ours-4h`) |
| "Reconnecting… Editing is paused" banner when the socket drops (`jenni-9c`) | Export preview, four layouts, Word citation fields (`ours-7a`) |
| Tutorials, Help, Shortcuts, Web Extension in the rail | Hindi interface (beta), ₹299 |

## Where Jenni still beats us — ranked, with the fix (no code)

1. **Paper search in production returned nothing Indian, then a comet mission.** (`ours-4a`–`4c`.)
   Every hit came from PubMed or arXiv; OpenAlex and Semantic Scholar answered nothing. Fix:
   read the production API log for `web scope search failed`; make a failed index visible to the
   student ("OpenAlex did not answer; showing PubMed and arXiv only") instead of `[]`; add a
   health check that runs one known query against each index hourly and alerts (the §14 alert
   path exists). Until this is fixed, every automatic source, every suggestion's citation and
   every chat answer is built on the wrong library — this is the single cause behind most of the
   writing-quality gap below.
2. **The first cited sentence cites South Africa for Karnataka, and our own checks say so twice.**
   (`ours-1f`, `ours-2d`, examiner in `ours-7a`.) Fix: when the automatic library has no paper
   whose title or abstract names the place or population in the title, say so in the setup card
   ("No paper on Karnataka yet — search or add one") before offering a sentence; prefer the
   relevance-floor refusal over a mismatched citation.
3. **Two more setup screens than Jenni before the first sentence** (~75 s vs ~51 s). Fix: merge
   "field and university" into step 1 as optional chips, and let "Plan my chapters" run while the
   question is being answered — the aim is already drafted at step 3.
4. **Refine presets open over the evidence card; the card stays over refined text; the edit menu
   stays after Discard.** (`ours-2e`, `ours-2f`, `ours-5c`.) Fix: one floating layer at a time —
   opening the preset menu closes the card; Discard and Escape close the command panel. Add
   both to `e2e/_measure/layout-audit`.
5. **The suggestion bar covers the paragraph it belongs to.** (`ours-1g`.) Fix: anchor the bar
   below the suggestion's last line, as Jenni does (`jenni-1d`), and never over text.
6. **A citation renders two ways** — "(Mutumbi 2024)" in the suggestion and after accept,
   "(Mutumbi et al., 2024)" after the Citations tab re-renders; one suggestion put the citation
   after the full stop. (`ours-2c`, `ours-2g`, `ours-2h`.) Fix: render the ghost text's citation
   through the same CSL path as the document; in `postProcess`, move a trailing "(…)" inside the
   sentence's final punctuation.
7. **The export preview drops the citation marker.** (`ours-7a`.) Fix: the preview must use the
   same citation-rendering step as the built file, and a test should assert the marker count in
   the preview equals the count in the chapter.
8. **One screen disagrees with itself in the library:** "3 with full text" above "1 paper has no
   PDF". (`ours-4e`.) Fix: one source of truth for "full text" (has chunks from a PDF or JATS),
   used by the header, the filter chips and the banner.
9. **Trial caps bite in minutes:** 2 section commands a month blocked proofreading after one
   Formalise and one Simplify. Fix: give the trial the same shape as the paid plan at a tenth of
   the size (e.g. 10 section commands), or count a proofread separately; the owner's "usage-limit
   rebalance, option 1" in `PENDING.md` covers this.
10. **Jenni's chat answer is richer** (7 external sources, a rural-vs-urban caveat, an offer to
    search rural papers and draft the section) though slower. Fix: when the library answer ends
    with "What these sources do not cover", offer the next step as a button — "Search the
    literature for rural India" — rather than leaving it as prose.
11. **The first click and the first undo break the scaffold on both** — ours puts the cursor in
    the heading and Ctrl+Z removes four sections (`ours-2a`, `ours-2b`). Fix: place the caret in
    the first empty paragraph on load; make the scaffold insertion one undo step that leaves the
    headings (or confirm before an undo that removes headings).
12. **Jenni's per-section notes are visible in a panel** with Generate per section. Ours has
    section pins (ADR-0085) but no visible note per section in the editor. Fix: show the section's
    scope note in the Sources tab's "This section" radio, with an edit box.

## Where we beat Jenni (seen this run)

- **Grounding holds under refine and edit.** Jenni's "Simplify language" silently swapped a
  citation (`jenni-2g`); its Paraphrase rewrote IEEE numerals as author-year with no separator.
  Ours kept [1] through Simplify and Formalise.
- **Checks run on the trial and find real things:** too-close, source quality, and an examiner
  review that caught the South Africa mismatch. Jenni's four model reviews are UPGRADE; its free
  Source Quality called two 2019 papers "over a decade old".
- **Chat is faster and says what it did not read** (≤ 48 s vs 60–110 s), and the references are not
  paywalled. One Jenni question ended the free allowance.
- **AI edit shows an inline diff, a word count delta and a follow-up box** (`ours-5b`); 22 actions
  to 17; an instruction box; "Use my library" and "Search the literature" switches.
- **Setup produces substance:** a research-design question with tappable answers, an aim, three
  objectives, seven chapters with sections. Jenni produces headings.
- **Library tooling:** DOI lookup with preview, duplicate refusal, .bib/.ris/.csv export, Zotero,
  collections, full-text filters, an in-app reader with highlights and "Cite in my chapter".
- **Export:** layouts, Word citation fields, advanced options, a preview (once fix 7 lands).
- **Price:** ₹299 against ₹1,161 for Jenni's cheapest paid month in India.
- **Stability:** Jenni showed "Reconnecting… Editing is paused" mid-session (`jenni-9c`); ours did
  not drop.

## Writing quality — the core engine, side by side

Same topic, same typed opening sentence. Verbatim from the transcript.

**Jenni**

- First sentence at setup: *"While Karnataka has made significant strides in large-scale renewable
  energy capacity, rural households often face persistent energy deficits, highlighting rooftop
  solar as a decentralized solution to bridge these critical access gaps (Shivasharanappa, 2026)."*
- Autocomplete after the typed sentence: *"Beyond the prohibitive burden of high upfront capital
  requirements, bureaucratic inefficiencies in subsidy disbursement and the operational opacity of
  net metering frameworks further impede widespread rural integration (Burke et al., 2019;
  Kasinathan et al., 2019)."*
- Chained next: *"Moreover, limited technical literacy regarding maintenance and a lack of
  localized support networks exacerbate these challenges, as residents often perceive the
  long-term return on investment as inherently unstable (Kawle, 2025; Manjeshgowda & Devaraja,
  2025)."*
- After "Simplify language": *"Moreover, limited knowledge of system maintenance and a lack of
  nearby technical support add to these barriers, leaving residents unsure whether the long-term
  financial returns will be reliable (Karakaya & Sriwannawit, 2015; Manjeshgowda & Devaraja,
  2025)."*

**Thesis Copilot**

- First sentence at setup: *"Global challenges such as climate change are closely linked to carbon
  emissions from fossil fuel-based energy consumption, prompting a shift towards renewable sources
  like solar photovoltaic (PV) systems as a sustainable alternative. However, despite significant
  potential, adoption rates of rooftop solar PV remain low in many contexts due to a complex
  interplay of financial, personal, institutional, technical, and societal barriers (Mutumbi
  2024)."* — flagged by our own too-close check.
- Second suggestion: *"Despite various supportive policies, the adoption of rooftop solar PV
  remains low among low-income households, highlighting the need to identify and understand the
  barriers that hinder uptake to design effective interventions (Mutumbi 2024). These barriers
  include both perceived challenges, which reflect households' subjective assessments, and
  objective obstacles, which are practical difficulties encountered during adoption, with a noted
  gap in research focusing on the latter across different income groups (Mutumbi 2024)."*
- Autocomplete after the typed sentence: *"The specific financial factors that most strongly deter
  uptake—whether upfront costs, access to credit, or awareness of subsidies—are not clearly
  understood, limiting the ability to design targeted interventions. Clarifying these barriers is
  crucial to enable equitable and effective policy measures that can accelerate adoption among
  rural households in Karnataka. (Mutumbi 2024)"*
- After "Simplify language": *"It is not clear which financial factors—upfront costs, credit
  access, or subsidy awareness—most strongly stop rural households in Karnataka from adopting
  rooftop solar. Understanding these barriers is important to create fair and effective policies
  that can increase solar use in these communities (Mutumbi 2024)."*
- After "Formalise": *"…remains low despite the availability of state subsidies. It is unclear
  which financial factors—upfront costs, credit access, or subsidy awareness—most strongly inhibit
  adoption, and understanding these barriers is essential to designing equitable and effective
  policies to increase solar uptake in these communities [1]."*

**What makes Jenni's read more naturally**

1. **Specificity from the sources, not the prompt.** Jenni's sentences name mechanisms — subsidy
   disbursement, net metering, maintenance literacy, local support networks — because its
   citations are Indian and Karnataka papers. Ours names nothing the student did not type: every
   noun in our autocomplete ("upfront costs, access to credit, or awareness of subsidies") is the
   aim's own list, restated. The engine had one South Africa review to read; it could not be
   specific about Karnataka. This is the retrieval fault (fix 1), not the prompt.
2. **Each sentence adds a claim; ours restates.** Jenni: barrier → further barrier → consequence
   (returns perceived as unstable). Ours: the problem → "it is not clear which" → "understanding
   these is important" — a problem statement rephrased three times. The second suggestion also
   cites the same paper twice in one paragraph.
3. **Sentence openers vary.** Jenni: "While…", "Beyond…", "Moreover…". Ours opens with the
   subject every time ("The specific financial factors…", "Clarifying these barriers…",
   "Understanding these barriers…"), and the setup sentence opens on "Global challenges such as
   climate change" — the stock first line of a thousand introductions.
4. **Stock phrases.** Ours: "highlighting the need to", "a complex interplay of", "crucial to
   enable", "targeted interventions", "equitable and effective policy measures", "sustainable
   alternative". Jenni has its own ("critical access gaps", "widespread rural integration"), but
   fewer per sentence, and its nouns are concrete.
5. **Dashes.** Every one of our suggestions carries an em-dash parenthesis ("—upfront costs, credit
   access, or subsidy awareness—"); none of Jenni's four sentences does. The dash-list is our
   engine's tic, and it survives Simplify and Formalise.
6. **Citation placement and density.** Jenni cites two papers per sentence, inside the sentence,
   before the full stop. Ours cites one, sometimes after the full stop ("Karnataka. (Mutumbi
   2024)"), and in a different rendering from the document's.
7. **Jenni's cost of reading well:** its "Simplify" quietly swapped a 2025 Karnataka citation for a
   2015 one, and its paraphrase broke the citation style. Fluency is bought with looser grounding.
   Ours never cited anything not in the library — but the library was wrong.

**What to take from it:** the prose gap is mostly a sources gap. With the index fault fixed and an
Indian paper in the library, A.1/A.2 would have had the same material Jenni had. The prompt-level
items that remain — vary the opener, one claim per sentence, no dash-list, cite inside the
sentence, never the same key twice in one suggestion — are measurable in the existing eval sets
(`eval-*.ts`) and should be scored there before any prompt change ships.
