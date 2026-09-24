# ADR-0023 — the citation-support check: does the cited passage say it?

**Date:** 2026-09-24
**Status:** Accepted — the prompt awaits the owner's review (`docs/PENDING.md`)
**Extends:** FR-6.x and Appendix D.1 (the coherence engine). Adds a prompt Appendix A does not
have, as ADR-0010 did, and a `FlagType` value beyond PRD §8.

## What prompted it

A competitor's review separates claims into misrepresented, overstated and weakly supported. The
coherence engine answered two neighbouring questions — does this claim need a citation
(A.12.3), and do two claims contradict each other (A.12.2) — but never the one in between: **the
sentence has a citation; does the cited passage say what the sentence says it does?** That is the
failure an examiner finds by opening the paper, and the one a student is least able to see.

## The decision

- **A new check in the coherence run, `CITATION_SUPPORT`.** Each cited sentence in a changed
  chapter goes to the Fast tier with the passages its citations point at: the chunk the citation
  was made from when Assist or Draft made it (the node carries `chunkId`), otherwise the cited
  source's two chunks nearest the sentence. Ten sentences a call, sixty a run (thirty under
  D.1.1's reduced scope); the rest wait for the next run.
- **Five verdicts, four of them flags.** `SUPPORTED` is silence. `MISREPRESENTED` is an error,
  `OVERSTATED` a warning, `WEAKLY_SUPPORTED` and `NOT_IN_PASSAGE` notes — the last says plainly
  that the paper may make the point elsewhere, because only a passage was read.
- **A quote is shown only if it is the passage's own words** (`verbatimQuote`). A model asked to
  quote sometimes paraphrases inside quotation marks; that is dropped, and a misrepresentation
  without a verifiable quote is shown as a warning rather than an error, because the student then
  has only the model's word for it.
- **A source with no text is not checked.** Judging a citation against nothing would be a guess;
  it is counted in the run's log instead. A citation whose source is gone is `CITATION_INTEGRITY`'s.
- **Flag, don't fix.** The check never rewrites the sentence. It says what the passage says.
- **The prompt, `coh_support.md`, is not from Appendix A** and is marked so, exactly as
  `cite_role.md` is (ADR-0010): `prompts.spec.ts` names both as the only exceptions, and the 21
  Appendix A files are still checked byte-for-byte.

## Cost

Fast tier, inside the existing `COHERENCE` action and its cap (one run a month on the student
plan) — no new metered action. Sixty sentences with two ~350-token passages each is about 45,000
input tokens: ₹0.3 a run on the configured `gpt-5-nano`. D.1.1's pre-flight estimate counts the
new calls (six Fast calls at §11.2's ₹0.3 each, ₹1.8), so the ₹12 budget guard sees them before
the first call is made.

*Corrected 2026-09-24:* this paragraph first said "₹0.3 a run at §11.1's prices". ₹0.3 is the
configured model's price; at §11.1's reference Fast rate the same tokens are about ₹4–5. The run
stays inside D.1.1's ₹12 guard either way, but Appendix E.2's budget prices a coherence run from
§11.2's profile (₹5.87), which does not include these calls. `docs/PENDING.md` puts that to the
owner rather than repricing the unit here.

## Rejected

- **Checking against the whole paper.** A full text per cited source per sentence is 50–100×
  the tokens, and most sources are abstracts. The passage a citation was made from is what the
  student was shown when they accepted it; that is the fair thing to hold the sentence to.
- **A separate on-demand "review" action with its own cap.** The ₹100 ceiling has no room for a
  new cap, and the coherence run already reads every changed chapter.

## Consequences

- Migration `0019_flag_type_citation_support` (`ALTER TYPE "FlagType" ADD VALUE`).
- Checked live on 2026-09-24 with the real Fast-tier model: a sentence saying AlphaFold "predicts
  every protein structure perfectly" was flagged as overstated, quoting the abstract's "can
  regularly predict protein structures with atomic accuracy"; an accurate sentence citing the same
  paper was passed.
- **For the owner:** review `packages/ai/prompts/coh_support.md`. The honest end state is a PRD
  section for it (an A.12.5), at which point the file becomes a verbatim copy like the others.
