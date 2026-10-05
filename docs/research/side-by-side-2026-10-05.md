# Side by side, landing page to submission — findings (2026-10-05)

Protocol: `side-by-side-protocol.md`.
- **Ours:** production v0.1.26 (thesis.rademics.ai), the owner's account, a new thesis.
- **Jenni:** app.jenni.ai, the owner's account (free plan), a new document.
- **Both:** the topic "Barriers to rooftop solar adoption among rural households in Karnataka",
  the same opening sentence, at the browser pane's own size.

Severity: **H** a student gets stuck, misled or put at risk; **M** slows them or makes them doubt;
**L** polish.

## 1. Home page (logged out)

| | Jenni | Ours |
|---|---|---|
| First screen | One headline, one button ("Start writing – it's free"), a working product preview under it | Headline, two buttons, two trust lines; a photo below the fold |
| Says what it costs | Pricing link | Pricing on the page (free 14 days, ₹299) |
| Proof | "Published in 100+ journals", a testimonial | Four rules ("cites only your library"…), the guide, viva practice |

Notes:
- Jenni's live preview shows the product *working* (autocomplete, chat, search) before sign-up.
  Ours explains it in words.
- Jenni's own page has a typo ("10,00+ styles").

## 2. Coming back (signed in)

| | Jenni | Ours |
|---|---|---|
| Lands on | **the last document, open** — 0 clicks to keep writing | the thesis list — 1 more click (Write) |
| While loading | spinner + "Loading…" | **blank dark screen ~3 s** (M) |

## 3. Starting a new thesis (timed)

**Jenni: ~40 s clean** (76 s with my own mis-clicks). It works like a short conversation:
1. One box, "Fill document prompt", with a live strength meter that coaches as you type ("Weak
   prompt: add more context" → "Average prompt: consider including important keywords").
   Also on this screen: Import from Word, Skip and start writing, Chat with AI, Upload Sources.
2. Citation preferences, every one with a default: style, web search, library search, year,
   impact factor, cited-by, preprints. Each answer then folds into an editable summary bubble.
3. Structure: standard headings (IMRaD), AI-made headings, or none.
4. "Analyzing your topic…" with a grey sketch of the outline (about 10 s).
5. Result:
   - the document titled from the prompt, with **nine headings for the topic**;
   - a left panel of **Section prompts**: per section, 2–3 bullets on what it should argue, plus
     "Configure context" and "Generate";
   - **an opening sentence already suggested** under Introduction before the student types
     anything.

**Ours: 18 s** (from "Start another thesis" to the editor). Steps:
1. The form opens below the existing thesis. All decisions are on one screen: title, "Start
   from" (paper / topic, default *paper*), citation style, and two buttons.
2. "Start writing now" opens the editor on a bare "Chapter 1".
3. "Finding papers on your topic…" → "5 papers ready — suggestions will cite them" in ~30 s
   (ADR-0070, working in production).

Faults found:
- **H — the list page moves while loading.** The "Getting set up" panel loads after the page and
  pushes everything down. Two of my clicks landed on the wrong thing; one opened the *existing*
  thesis's proposal instead of a new thesis.
- **M — "Start from: A paper I have written / A topic"** is asked even though "Start writing now"
  ignores it, and the default is "paper".
- **M — three stacked boxes above the page.** The "no proposal yet" prompt, the 4-step guide and
  the first-run hint sit above a two-row toolbar. The writing area starts at the bottom of the
  screen, and the first sentence typed is pushed off-screen.
- **M — no structure.** Jenni turns the topic into headings with per-section guidance in ~10 s.
  Ours gives one empty "Chapter 1"; an outline needs the proposal or the outline screen.
- **L — the bar under the page lists 8 keyboard shortcuts.**

## 4. First sentence → first cited suggestion (timed)

The same sentence was typed in both: "Rooftop solar adoption among rural households in Karnataka
remains low despite state subsidies."

| | Jenni | Ours |
|---|---|---|
| Time to suggestion | **≤ 4 s, on its own** at the pause | **13 s** (pressed Suggest; papers had just become ready) |
| Before typing | already offered an (uncited) opening sentence | nothing until the student writes |
| Length | 1 sentence | 2 sentences |
| Accept key | → (right arrow); Tab does nothing | Tab (as in Word) |

**Jenni's suggestion:** "This persistent gap highlights a critical energy access issue, as rural
communities continue to grapple with unreliable grid connectivity and limited infrastructure
development (Adanma & Ogunbiyi, 2024)."
- The cited paper is a *global* review ("Assessing the economic and environmental impacts of
  renewable energy adoption across different global regions", Engineering Science & Technology
  Journal, 2024).
- The quote Jenni shows as support is about *Bangladesh* ("Khan et al. (2020) explore the
  barriers… in Bangladesh"). It does **not** support a claim about rural Karnataka.
- The card shows "IF 19.33" for that journal, which is implausible.
- The card's design is strong: cited-by, open access, the quote, and Edit / Narrative /
  Open quote / Save.

**Ours:** "This low adoption rate is not due to outright rejection of the technology but results
from accumulated friction at multiple stages, including awareness, installation, and
post-installation experiences. Informational gaps, procedural complexity, structural limitations,
and perceived financial risks significantly hinder the transition from awareness to installation,
even within Karnataka's progressive policy environment (Bagla 2026)."
- The cited paper is exactly on topic: "The Last Mile of a Subsidy: Household Frictions in
  Rooftop Solar Adoption in Karnataka, India: A Qualitative Study" (Bagla, 2026).
- We hold its full text. The passage shown (Results, p. 11, Open PDF) supports both sentences.
- **H — too close to the source.** "friction accumulates at multiple points… from awareness to
  installation and post-installation experience" and "informational gaps, procedural
  complexity, structural limitations, and perceived financial risk" are near-verbatim. A
  similarity checker (Turnitin) would flag them, and to an examiner it reads as patchwriting.
- **M — two sentences share one citation at the end,** and the "significantly" filler slips past
  the A.1 rule.

So far: **Jenni is faster, more guided and never blank. Ours is better grounded but must
paraphrase.**

## 5. Finding papers

| | Jenni | Ours |
|---|---|---|
| Entry | Menu → Find papers; "Suggested from your document" | Papers tab; "Suggested from your thesis" + "Papers for the paragraph you are writing" |
| Time | ~3 s | ~3 s |
| Results | long list; Cite / View / Save; IF, open access | 8 papers; abstract snippet with search words in bold; Cite here / Read / View paper |
| Top hit | Bagla 2026 (the Karnataka paper) | Bagla 2026 |
| Second hit | Karnataka renewable adoption in agriculture (on topic) | an LLM energy-scenario paper (**off topic**) |

- **M — the search box placeholder lists databases** ("Search OpenAlex, Semantic Scholar, PubMed…"), which mean nothing to most students.
- **M — at this width our Tools panel covers the writing.** Jenni's panel sits beside the document.
- Jenni's search *finds* Bagla 2026, but its autocomplete cited a generic global review instead.
  Ours writes from the paper actually on topic.

## 6. Reading a paper

| | Jenni | Ours |
|---|---|---|
| From search | "View" leaves for the publisher (doi.org) | "Read" opens our reader with the full PDF (23 pages), PDF/Text, zoom, search, "FULL TEXT" |
| Where | another site | **a new browser tab** — the student leaves their chapter (M) |

- **H (both tools) — source credibility.** The top paper on both is by a school student (Greenwood
  High International School), 0 citations, a low-citedness journal, a month old. Our
  autocomplete leans on it as the main evidence. Neither tool weighs credibility when choosing
  what to cite.

## 7. Writing a section

**Jenni:** the "Generate" button on a section prompt wrote **one sentence**, citing two papers
(Gravert et al., 2024; Manjeshgowda & Devaraja, 2025). The student carries on with autocomplete.
This may be the free plan.

**Ours:** Ctrl+Shift+D under a "Financial constraints" heading wrote 303 words in ~10 s, as a
pending block with Accept / Discard / Regenerate. But:
- **H — the draft was not about the section.** It described *the headings of the source papers*:
  "The phrase 'Materials and Methods' appears as a primary heading…", "References and citation
  materials are listed among the source headings…". It opened "This chapter presents the
  components and organization of the thesis", and every sentence carried a citation, so it looks
  authoritative. Cause being traced in the code (the draft seems to work from "Chapter 1" rather
  than the heading under the cursor; table-of-contents fragments of papers get retrieved).
- **H — a raw `[[NEEDS SOURCE: Specific aims and problem statement of chapter]]` marker appeared
  inside the draft text.**
- **M — typing "## " did not make a heading** (Notion/Docs habit). It stayed as literal text.
- **L — the "Draft inserted: 303 words" notice stayed on screen after Discard.**
- The trial allows **2 drafts a month** ("Draft 0/2" in the header). One bad draft is half the
  month's allowance.

## 8. Asking about the papers (chat)

The same question in both: "What are the main financial barriers to rooftop solar adoption for
rural households in India, according to my sources?"

| | Jenni | Ours |
|---|---|---|
| Time | ~70 s (incl. a permission click) | **< 8 s** |
| While waiting | **every step shown**: planning → searching library (with its queries) → fetched → structuring | nothing until the answer |
| Friction | "Search your library? Skip / Always allow / Allow this time" | none |
| Answer | **6 headed sections, 10+ citations**, direct quotes, a "relative importance" section with numeric weights (George & Ghosh 2026), a note on the student's weak sourcing, an offer to draft next | **one dense paragraph**, specific facts (73% unaware of financing schemes, PM Surya Ghar, ALMM, Kerala), **2 citations at the end only** |
| Scope | library + its own literature search, said openly | library only (5 auto-found papers) |

**The biggest output gap so far.**
- Jenni's chat is a research *agent*: it plans, runs several searches, reads, then writes a
  structured answer with a strong model.
- Ours is one retrieval over a small library and one call to an inexpensive model.
- Ours is faster and stays inside the library, which is an integrity advantage. But a student
  will judge by the answer.

## 9. Editing selected text

Compared in detail on 2026-10-04 (JENNI-UX-STUDY §18). Our edit actions were built after it
(ADR-0066). Not re-run today, to save Jenni's free allowance.

## 10. Checking the work

| | Jenni | Ours |
|---|---|---|
| Where | **one "Review" panel, five cards, one "Run review" each** | split: "Flags" tab (examiner review, coherence, proofread, too-close-to-source); "Review" tab is *supervisor comments*; citation report and compliance on other screens |
| Checks | Claim confidence (missing/weak citations, "avoid academic plagiarism"), Peer review, **Source quality** (retractions, preprints, quality), Tone of voice (match a style or a paper), Proofread | Examiner review, coherence (not in the trial), proofread, too-close-to-source (free, no model), citation report, ten compliance checks (on Submit) |

- **M — naming.** "Review" means comments from the guide; "Flags" means checks. A student looking
  for "check my work" opens the wrong tab.
- **M — the Flags panel moved while loading,** so my click ran the wrong check.
- **M — the student sees our internal AI cost** ("about ₹8.4 of AI, one coherence unit").
- **H — "Too close to a source?" passed our own near-verbatim sentence** ("Nothing to flag. 5
  sentences checked"). It flags only *uncited* reuse. Copied wording *with* a citation but no
  quotation marks is still patchwriting.
- **Gap — no source-quality check.** Jenni checks retractions, preprints and journal quality in
  one click. We record retractions and preprints on each source but offer no one-click review of
  them.

## 11–13. Sharing, export, account

- **Export.** Jenni: ⋯ → Export (Word or LaTeX), with five items in the menu. Ours: "Export .docx"
  in the header (the trial exports chapters only), plus the Submit screen for the full thesis.
- **Jenni's free plan hides the reference list** ("References are a paid feature"). Ours shows
  references on the trial.
- **Ours shows quota counters in the header** ("Assist 0/50 · Draft 0/2"). The trial allows 2
  drafts a month, so one bad draft is half the month.
- Sharing with a supervisor, the submission checks, the viva and the institution side were
  compared on 2026-10-04: **ours is ahead** (guide comments pinned to sentences, live progress,
  a response-to-committee table, compliance checks with a real contents page, viva practice).
  Not re-run today.

## 14. Coming back next day

Jenni reopens the last document; ours opens the thesis list (see §2).

## Why the section draft went wrong (traced in the code)

- **Ctrl+Shift+D never reads the cursor.** It sends only `{chapterId, outlineNodeId}`
  (`apps/web/src/components/editor/DraftMode.tsx:54-59`).
  - The worker takes the section title from the outline, falling back to the chapter title
    (`apps/worker/src/jobs/draft-section.ts:313-335`).
  - A "Start writing now" thesis has an empty outline, so the draft is written for "Chapter 1"
    with no scope. Retrieval embeds the text "Chapter 1." (`draft-section.ts:153`).
  - The heading the student typed is never sent.
- **Retrieval keeps heading-only and contents-page chunks.**
  - `looksLikeHeading` makes every short capitalised line its own section
    (`packages/retrieval/src/extract/index.ts:35-73`).
  - The chunker keeps one-line sections as chunks (`chunker.ts:117-137`).
  - The candidate query has no length or type filter (`pgvector.ts:142-158`).
  - So "Chapter 1." retrieves lists of section headings, and "cite every claim" makes the model
    describe them.
- **The prompt has no guard for a generic section.**
  - `canDraft` is only "there are passages" (`packages/ai/src/builder/draft.ts:399-401`).
  - The A.2 rule against "this section will…" openers is not enforced.
- **The raw `[[NEEDS SOURCE: …]]` is how the note atom draws itself**
  (`packages/ui/src/editor/nodes.ts:23-33`), not a missed strip. A.2 asks for an amber note.
- **"## " → heading:** the input rule is defined correctly (`nodes.ts:55-71`). Why it didn't fire
  needs a browser repro (suspects: the ghost-text decoration at the caret, or IME composition).

## What to improve, ranked

Effort: **XS** under an hour · **S** half a day · **M** 1–2 days · **L** 3–5 days.

### A. Faults in what we ship — fix first

| # | Fix | Why | Effort |
|---|---|---|---|
| A1 | Draft a section works on the heading under the cursor (its text + the paragraph before), and asks for a topic instead of drafting when the section is only "Chapter N" with no scope | the 303-word off-topic draft; this is the default path since ADR-0070 | M |
| A2 | Drop heading-only, contents-page and reference-list chunks when indexing (minimum words, no run of headings), then re-index | they become "evidence" for any vague query | M |
| A3 | Paraphrase guard: after a suggestion or draft, measure word overlap with the cited passage. Above a threshold, regenerate once or mark it as a quotation. Extend "Too close to a source?" to cited reuse too | near-verbatim suggestion; Turnitin risk; our check passed it | M |
| A4 | Show the needs-source note as an amber "Needs a source: …" chip, not `[[…]]` | raw markup in the student's text | S |
| A5 | Stop the list page and the Flags panel moving while they load (reserve the space) | clicks land on the wrong thing | S |
| A6 | Spinner instead of a blank screen on first load | looks broken for ~3 s | XS |
| A7 | Clear the "Draft inserted" notice on Discard | stale message | XS |
| A8 | Repro and fix "## " → heading | Notion/Docs habit | S |

### B. Make it as easy as Jenni (the flow)

| # | Change | What Jenni does | Effort |
|---|---|---|---|
| B1 | **Structure at creation.** From the title, build headings with 2–3 "what this section argues" bullets and a **Generate** button per section, in a left panel. The proposal stays optional, for depth | 9 headings + section prompts in ~10 s | M–L |
| B2 | **Open the last chapter on return** (the list stays one click away) | reopens the last document | XS |
| B3 | **Declutter the editor.** One small card instead of three boxes; shortcuts behind a "?"; no "Start from paper/topic" on the Start-writing path | a clean page | S |
| B4 | **One "Check" panel.** Rename Flags → Check and Review → Comments. Each check is one card with one button: examiner review, proofread, too close to a source, **source quality** (new), citation report | five cards, one panel | S (+ M for source quality) |
| B5 | **Show the steps of anything slow** (chat, draft, search): "Searching your library… Reading 3 papers… Writing…" | every step listed | S |
| B6 | Reader opens beside the chapter (or the same tab), not a new tab | publisher site (we are already better) | S |
| B7 | Don't show "₹8.4 of AI" to students; say "uses 1 check from your plan" | n/a | XS |
| B8 | An opening sentence on an empty section (uncited, structural only). **A prompt change: needs an ADR + an eval round** | suggests before you type | M |

### C. Make the output stronger than Jenni (the technical power)

| # | Change | Why | Effort |
|---|---|---|---|
| C1 | **Source quality in retrieval and auto-sources.** Weight citedness and venue; down-rank preprints and 0-citation new papers; never let one weak paper carry a claim | both tools leaned on a school student's paper | M |
| C2 | **Agent-style chat.** Plan → search the library *and* the scholarly indexes → add what it uses to the library → answer in headed sections with a citation per claim → show its steps. Grounding holds: it may cite only what it fetched and read | Jenni's answer was in a different class | L |
| C3 | **The same for Draft:** search first when the library is thin for the section, then write per subheading | drafts are only as good as the passages | M |
| C4 | **A stronger model for chat and draft** (the usage-limit decision you have pending) | cheap model = thin answers | owner's decision |
| C5 | Prompt round: "paraphrase, never copy", one citation per claim, and enforcement of the existing "no 'this section will…'" rule | after A3 shows the size of the copying problem | M (ADR + eval) |

**Suggested order:**
1. A1–A7 (one release, about 3 days).
2. B1–B4 and B7 (the "Groww-easy" release, about 4 days).
3. C1 → C2 → C3, with C4 decided by the owner.
