# 0095 — The AI edit panel: your own instruction, the missing presets, "What changed and why"

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R8; inventory §10, §13.3, §13.9; fix list 26)

## Context

Jenni's AI Edit (Ctrl+J, or from the block menu) is a box with Web/Library switches over grouped
presets; typing filters them; a result shows the diff, **What changed and why**, a follow-up box,
and Replace / Insert below / Try again / Discard. Ours had 13 actions on a bar and a "More edits"
disclosure, the diff and the four buttons — no box, no Ctrl+J, no reasons, no follow-up. Jenni was
also seen doubling a citation ("(Jain, 2023)(Jain, 2023)") and moving citations between claims.

## Decision

**The panel** (`CommandToolbar.tsx`, over any selection of 20+ characters; Ctrl+J or the block
menu's "Edit with AI" puts the caret in its box):
- one box — typing filters the presets; Enter runs a preset whose name was typed, otherwise the
  text is the student's own instruction (`custom`); "Use my library" sends that instruction
  passages, cited (A.11's retrieval), on by default;
- presets in Jenni's three groups: *Improve the writing* (Fix the flow, Add transitions, Remove
  repetition, Strengthen the argument, Counter-argument, Expand, Shorten), *Academic style*
  (Formalise, Simplify, Technical precision, Increase confidence, Hedge, Check consistency),
  *Transform* (Active voice, Past/Present/Future tense, Bulleted list, Numbered list, As prose, As
  a table, Translate). Bulleted and numbered lists go in as real list nodes;
- the result adds **What changed and why** and a **follow-up box**. A follow-up rewrites the last
  version with the student's own text sent as `<original>`; its diff, its reasons, its "unchanged"
  and its citation checks are all against that original, so a citation an earlier round moved is
  still reported, and Replace replaces the student's text.
- Ctrl+J with nothing selected opens the chat with the caret in its box, as Jenni does.
- **Web switch: not built.** Passages from the scholarly indexes for an edit would be the chat's
  search (ADR-0074) behind a rewrite; the library switch covers grounding, and Find a source is one
  click away. Revisit on evidence.

**No general "Paraphrase".** Jenni's Paraphrase/Simplify group with tones (Academically, Casually,
Persuasively, Boldly, Friendly) rewords any selection on request — the §12.3 ban when the
selection came from a source (ParaphrasePanel.tsx says so in as many words). Its useful tones are
here as Formalise, Simplify, Strengthen the argument and Increase confidence.

**§12.3 in code.** The free instruction is the one place a student can ask for anything. On the
real model a prompt rule was not enough ("so AI detectors and Turnitin cannot tell" came back
unchanged once and rewritten the next time). `asksToEvadeDetection` (`@tc/ai`) refuses such an
instruction before the allowance or a model is touched, with a plain sentence saying why.

**Prompt** (`edit.md`, NOT FROM APPENDIX A as before): ten actions — `flow`, `transitions`,
`redundancy`, `strengthen`, `precise`, `future`, `bullets`, `numbered`, `prose`, `custom` — and
the rules widened to them (only past/present/future change tense; lists and prose may
restructure; never write a citation twice). New prompt **`edit_reasons.md`**: fast tier, 2–4
points, "Check:" only for something lost or unsupported; runs once per run through
`POST /commands/explain` (the run is kept in Redis for 30 minutes and given once), inside the
run's own unit — no second unit. Points that only say "nothing changed" are dropped in code.

**Citations, in code** (`postProcessCommand`):
- written twice: the extra copy is removed where it closes a clause; a copy the sentence uses as a
  noun ("the findings in …") stays and the student is warned (removing it left "the findings in.");
- moved to another claim: reported before Replace like a dropped one — the citation's claim words
  (the sentence before it in the selection) against every sentence of the rewrite; moved when its
  sentence shares none of them or another matches clearly better;
- written after a full stop: put back before it.

The command call now has a time limit (90 s); it had none (CLAUDE.md, "No model call without a
time limit").

## Evaluation (2026-10-07, gpt-5-mini; reasons gpt-5-nano)

`packages/ai/scripts/eval-edit-actions.ts --only … --reasons`, four rounds:
1. 29 runs of the ten actions: 28 kept every citation where it was and invented none. Every list
   conversion worked; Kerala ("add an example") and the detector request came back unchanged.
   Faults: Remove repetition deleted the student's hedge; Strengthen wrote citations after the full
   stop; reasons used "Check:" for things that had not changed.
2. After the fixes: Remove repetition kept hedges (and changed nothing where nothing repeated); the
   detector request was **followed** — hence the refusal in code.
3. Strengthen kept citations in place but added implications ("policymakers should…").
4. Strengthen narrowed to the claim–evidence link: 2/3 clean; it still tends to add one synthesis
   sentence, which "What changed and why" marked with "Check:" every time. Kept, with that line as
   the safeguard the student reads before Replace (Jenni's Strengthen does the same).

Browser, real models: Fix the flow 6–16 s with reasons; one run moved three citations onto the
neighbouring sentence — the first version of the moved check missed it (one shared word), the
second reports it; a follow-up refined against the original (128 → 76 words, Replace enabled);
Bulleted list replaced the paragraph with a real list, all 5 citations kept; the detector request
refused with nothing spent.

## Cost and limits

The reasons call is ~700 fast-tier tokens, under a paisa, folded into the COMMAND line
(`packages/config/src/cost.ts`). The COMMAND allowance is unchanged — **4 a month on a paid plan,
2 on the trial**, and each follow-up is a run. A panel this visible will meet that cap quickly;
the owner's pending usage-limit rebalance (`docs/PENDING.md`) is where it is decided.
