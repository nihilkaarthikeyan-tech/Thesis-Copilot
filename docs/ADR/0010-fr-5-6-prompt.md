# 0010 — A prompt for FR-5.6, which Appendix A does not have

Date: 2026-09-07
Status: accepted
Amends: PRD §10.5's prompt list, and the reading of §0.3 rule 6.

## Context

FR-5.6 asks for a "narrative ↔ parenthetical rewrite on request (strong tier; language task)". It
was found unbuilt by the 2026-09-07 specification audit: the citation node has carried
`role: 'parenthetical' | 'narrative'` since FR-5.1 and the renderer honours it, so the feature
*looked* present, but nothing rewrote the sentence — and flipping the attribute alone leaves a
sentence that no longer reads.

Building it needs a prompt, and **Appendix A has none.** The appendix runs A.0 to A.16 and covers
every other model call in the product; FR-5.6 is one line of §5.5 with no corresponding section.

§0.3 rule 6 says "prompts are content, not code — `packages/ai/prompts/*.md` are verbatim from
Appendix A". Read strictly, that forbids writing one. Read strictly, it also forbids building
FR-5.6 at all, which cannot be what it means: the rule exists to stop the agent quietly rewording
a prompt the human authored, not to make an unwritten requirement unbuildable.

## Decision

Write `packages/ai/prompts/cite_role.md`, and mark it as the exception it is.

- Its header says **NOT FROM PRD APPENDIX A** where every other file says the opposite, and points
  here. A test asserts that text is present, so it cannot be mistaken for a copy and "corrected"
  back to a PRD section that does not exist.
- `prompts.spec.ts` now names it explicitly in `NOT_FROM_APPENDIX_A`. Adding a second hand-written
  prompt fails that test and has to be argued for rather than slipped in.
- The other 21 files are still checked byte-for-byte against the PRD. That guarantee is unchanged.
- Rule 6's *substance* still applies to this file: if it performs badly, the examples go in
  `docs/BUILD_LOG.md` and a change is proposed for the human, rather than being reworded in place.
- It follows A.11 (`command.md`) in shape, that being the nearest task the appendix does define:
  rewrite one selection, output only the rewrite, change nothing else.

**Metering:** against the `COMMAND` cap, for exactly ADR-0008's reason. It is the same kind of act
as a section command — a Strong-tier rewrite of one piece of the student's own text, on request —
and the ₹100 ceiling has about ₹1 of headroom, so a cap of its own does not fit. No budget change;
`COMMAND`'s profile already prices a 600-token Strong response and this one is capped at 400.

## Two rules the post-processing enforces

The prompt states both, and a model will break both, so `postProcessCiteRole` refuses a rewrite
that does rather than repairing it — a rewrite that lost its citation cannot be patched by putting
one back, because the claim may have moved.

1. **The citation id survives byte-for-byte**, and no other citation in the sentence is lost or
   added. Anything else silently detaches a claim from its source, which is what §10.6 exists to
   prevent.
2. **No author name is written into the prose.** The id renders itself in the document's current
   style; a name typed as words would not follow a style switch, and FR-5.2 promises that
   APA → IEEE needs no body edits.

A refused rewrite returns the student's own sentence unchanged with the reason, and the editor
shows it. That is §12.3 "flag, don't fix" applied to the one feature whose entire job is to
rewrite a sentence — the place it is easiest to forget.

## Consequences

- 22 prompt files, 21 of them verbatim from the PRD. `pnpm --filter @tc/ai run prompts:extract`
  regenerates those 21 and leaves this one alone.
- **For the human:** the honest fix is to add an `A.17 Citation role rewrite` section to the PRD
  with this prompt's text, at which point the file becomes a verbatim copy like the others and
  this ADR becomes history. `docs/PENDING.md` carries it.
