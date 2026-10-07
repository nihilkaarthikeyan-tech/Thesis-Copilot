# 0088 — Suggestions in the middle of a sentence

Date: 2026-10-07
Status: accepted (owner, 2026-10-07: "start to build them one by one" — Jenni build plan Round 2, R1)
Changes: ADR-0078's rule that automatic requests happen only at a sentence end or in an empty
paragraph.

## Context

In Jenni, a student who stops half-way through a sentence ("Urban heat islands raise night-time
temperatures in Indian cities because ") sees the sentence finished, with a citation, within about
four seconds (`docs/JENNI-FULL-INVENTORY.md` §12 C1). Ours waited for a full stop; mid-sentence the
student had to know Ctrl+/. The owner's words: "while we start to write it shows us AI suggestion…
we need to make sure our editing area is like that."

ADR-0078 kept automatic requests to sentence ends for a good reason: each one spends an ASSIST unit
(50 a month on the trial, 180 paid), and asking at every 0.8 s pause would have spent a trial's
month in one sitting.

## Decision

`packages/ui/src/editor/ghost-text.ts`, `midSentencePoint` and the automatic-suggest plugin:

- After a full stop, nothing changes: 800 ms, as before.
- Mid-sentence, a suggestion is asked for after a **2 s** pause (`MID_SENTENCE_IDLE_MS`), and only
  when all of these hold:
  - the cursor is at the **end** of an ordinary paragraph (not editing earlier text);
  - the sentence being written has **at least four words** (`MID_SENTENCE_MIN_WORDS`);
  - the student stopped **between words** — after a space, a comma, a semicolon, a colon or a dash,
    never inside a word;
  - the last thing written is **not a citation** (that sentence is about to get its full stop).
- **Once per sentence**: the same sentence is offered again only after six more words
  (`MID_SENTENCE_MORE_WORDS`), so a dismissed suggestion is not asked for again at every pause.
- The same request, the same cap, the same post-processing as Ctrl+/ mid-sentence (which already
  joins the continuation with the right space).

Jenni's fault of firing after a heading and continuing the previous paragraph (inventory §12 C3)
cannot happen: the trigger needs four words in the paragraph being written.

## Cost

At most one extra automatic request per sentence of four or more words. A student writing
twenty sentences in a sitting can now spend up to about forty units instead of twenty, so the
trial's 50 go faster. The caps and the worst case in `docs/COSTING.md` are unchanged (every unit
is already priced). Whether the student's allowance should count only kept suggestions is the
owner's decision D1 in `docs/JENNI-BUILD-PLAN.md`.

## Evidence

Unit tests (`packages/ui/test/opening-sentence.spec.ts`): the longer pause, between-word endings,
four words, no trigger inside a word / after a citation / with text after the cursor, once per
sentence and again after six words, off when automatic suggestions are off. Browser check on the
local real stack: see `docs/BUILD_LOG.md`.
