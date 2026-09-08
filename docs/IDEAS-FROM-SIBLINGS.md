# What Thesis Copilot could take from the other five products

Survey date: 2026-09-08. Read directly from the source of `Gate-Ai-Agent`, `Bank-AI-Agent`,
`TNPSC-Ai-Agent`, `NEET-Ai-agent` and `Neet-AI-Agent-OpenLLM` — route tables, controllers and the
prompts they send — not from their READMEs.

Those five are exam-preparation products and this one is a writing instrument, so most of what they
do has no analogue here. The list below separates the ideas that transfer from the ones that only
look like they do, and says what each would cost against the ₹100 ceiling, because that ceiling is
what decides whether a feature can ship at all (PRD §11).

**The state of play:** none of the four strong candidates exists today. `planner`, `milestone`,
`rubric`, `streak` and `ocr` appear nowhere in this codebase; `deadline` appears three times, all of
them as a constraint inside the proposal prompt or a compliance check — the product asks the student
for a submission date and then never uses it again. `reminder` exists only in billing.

---

## Strong fit — build these

### 1. "What should I do next?" — from `Gate-Ai-Agent/backend/src/controllers/analytics.controller.ts`

The best single idea in the five, and the cheapest. GATE computes one recommendation from a
deterministic priority ladder — mistakes due, then never-reviewed, then an unfinished paper, then
never-tested, then a fortnight idle, then practise — and returns a headline, a reason and a link.
**No model call.** The copy carries its weight instead: *"A wrong answer you never read is a mark
you will lose again. Ten minutes now saves it."*

A thesis student opening this product sees a chapter list and an empty page, which is precisely the
moment they need to be told where to start. The same ladder, in thesis terms:

| Condition | What it says |
|---|---|
| A chapter has pinned sources and no words | "Chapter 3 has 12 sources and nothing written. Start there — the reading is done." |
| The guide commented and the student has not replied | "Your guide left 4 comments 6 days ago. Two are substantive." |
| Coherence flags are open | "3 contradictions across chapters 2 and 4." |
| Submission date near, chapters unstarted | "21 days left. Chapters 5 and 6 have no words." |
| A source is `ABSTRACT` only | "9 sources are abstract-only. Suggestions cannot quote them." |
| Nothing pressing | "Nothing is due. Chapter 4 is the thinnest at 900 words." |

**Cost: ₹0.** Every input is already in the database — word counts, comments, flags, grounding
levels. It is arithmetic, not inference. **This is the one I would build first.**

### 2. A thesis planner — all three exam products have one

`TNPSC-Ai-Agent/backend/src/controllers/planner.controller.ts` takes a target date, hours per day
and the student's measured weak areas, and asks the model for a schedule. Bank and GATE do the
same. It is the feature all three converged on, which is itself the signal.

The thesis version is stronger than the exam version, because the units are real: a thesis has
chapters, each has a word target and a current word count, and the submission date is already
collected. Target date + hours per week + words remaining per chapter gives a schedule by
arithmetic; the model is only needed to sequence sensibly (literature before analysis) and to say
what is unrealistic — *"at four hours a week you finish six weeks late; the discussion is where to
cut."*

**Cost: one Strong call per generation, and it should be metered against `COMMAND` like FR-5.6 was**
(ADR-0008's reasoning). Regenerating a plan monthly is not a per-day action.

### 3. Writing progress, not just AI quota

Every one of the five has an analytics or insights screen. Thesis Copilot has a usage meter, which
tells the student how much AI they have left — not how the thesis is going. `Chapter.wordCount`
already exists and is displayed in the rail; nothing plots it.

Worth showing: words per chapter against target, words per week, days since each chapter was last
touched, and the count of sources pinned but never cited. That last one is the interesting number —
it says which reading has not yet been used.

**Cost: ₹0.**

### 4. Rubric evaluation — from `Bank-AI-Agent/apps/api/app/descriptive/router.py`

Bank scores a written answer against `{content, structure, language, overall}` with feedback, and
keeps the history as a progress record. Its prompt names the rubric explicitly — *"examiners for
these papers reward structure and relevance over…"*.

Thesis Copilot has coherence flags (contradictions) and compliance checks (mechanical: margins,
headings, figure references). Neither answers the question a student actually loses sleep over:
*is this chapter any good?* A chapter scored against a named rubric — argument, use of evidence,
structure, and whether claims are supported by the sources cited — with the history kept so the
second draft can be compared to the first, is a real gap.

**Cost: one Strong call per chapter evaluation.** It needs its own cap and there is about ₹1.08 of
headroom, so it likely does not fit until `pnpm ai:verify`'s real prices are in and the
`draftModeStrongTier` lever is decided. **Design it, price it, then decide.**

---

## Good fit — worth doing after the four above

### 5. Photograph a page, get a source — from `TNPSC-Ai-Agent/backend/src/controllers/photo.controller.ts`

TNPSC sends a photo to a vision model and explains what is in it. The thesis version is not
"explain this" but "index this": photograph a page of a book, OCR it, and add it to the library as
a citable source with a page number.

This matters more here than the feature does there. The whole retrieval pipeline assumes a DOI, a
PDF or a database record, and an Indian postgraduate frequently works from a library book, a
photocopy, or a departmental thesis that exists in no database at all. Today those sources cannot
be cited with a supporting passage, which means Assist cannot use them at all.

Claude already has vision, so this needs no second vendor — TNPSC used GPT-4o only because that was
its stack.

**Cost: a vision call per page, sized by image tokens. Needs metering and a page cap.**

### 6. Reminders that reach the student

Bank and TNPSC both have notification modules. Here, `Mailer` is built, working and proven — and
only billing uses it. Nothing tells a student their guide replied, or that they have not written in
nine days, or that submission is a fortnight away with two chapters unstarted.

The §14 alert machinery already exists and is aimed at the admin. Pointing a small, quiet version
of it at the student is mostly wiring.

**Cost: ₹0** (email is already paid for).

### 7. Dictation — from TNPSC's `voice.routes.ts`

Speaking a paragraph and editing it is a genuinely different drafting mode, and one that suits a
non-native English writer working out an argument. The browser's own speech API costs nothing;
transcription through a provider would need metering.

**Cost: ₹0 with the browser API.**

---

## Looks transferable, is not

- **Flashcards, spaced repetition, mock tests, rank prediction, leaderboards, live exams.** The
  mechanics of these depend on there being a right answer. A thesis has no answer key.
- **Gamification and streaks** (Bank's `gamification`, TNPSC's `sharecard`). A daily streak suits
  exam revision. A thesis is written in long irregular blocks, and a supervisor is going to see this
  screen — a streak counter cheapens it. It would also sit badly beside §12.3's whole posture.
- **Forum** (TNPSC). Moderation burden, and a thesis student's questions are specific to their
  supervisor and department.
- **Focus mode / pomodoro** (Bank). Cheap, but the editor is already a distraction-free column and a
  timer is a browser tab away.
- **A/B testing and IRT** (Bank). Both need volume this product will not have during a pilot.

---

## The order I would build them

1. **Next action** — ₹0, arithmetic only, and it answers the "I opened it, now what?" moment.
2. **Progress view** — ₹0, and it is what makes next-action's numbers legible.
3. **Student reminders** — ₹0, and the mailer is already proven.
4. **Planner** — one metered call; it gives the submission date a job at last.
5. **Photo → source** — after the four above, because it needs a new cap and a new prompt.
6. **Rubric evaluation** — design it now, ship it once the real model prices are in Appendix E.3.

Items 1–3 cost nothing per user per month, which is the point: the ceiling has about ₹1.08 left, so
the three highest-value things on this list happen to be the three that do not touch it.
