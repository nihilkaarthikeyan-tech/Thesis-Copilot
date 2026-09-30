# Proposed prompt change — step 2 of the writing-quality plan (2026-09-30)

**Status: waiting for the owner's approval. Nothing below is in use yet.**

The prompts are copied word for word from PRD Appendix A, and the agent does not change them on
its own (PRD §0.3 rule 6). This is the exact wording proposed. On approval it goes into both PRDs
(`docs/PRD.md`, `docs/PRD-version-2.md`), `pnpm --filter @tc/ai prompts:extract` regenerates the
prompt files, and the change is released.

Why: a reviewer's comparison with Jenni (30 September) found our Literature Review was a paragraph
describing what the section *will* do, with no citations, restated three or four times. Step 1
already filters that out in code. This removes the cause: the instruction that told the model to
write such sentences when it had no source.

---

## A.1 Autocomplete (`assist.md`)

### 1. When there is no source

**Before**

> If the continuation states a fact, finding, number, or claim about prior work, it must be
> supported by a passage and cited with {{cite:ID}} placed right after the sentence. If no passage
> supports such a sentence, write a structural or connective sentence instead (for example, one
> that introduces what the section will examine) or write nothing.

**After**

> If the continuation states a fact, finding, number, or claim about prior work, it must be
> supported by a passage and cited with {{cite:ID}} placed right after the sentence. If no passage
> supports what the text needs next, do not write a sentence to fill the space. Output only
> [[NEEDS SOURCE: <what is missing, in ten words or fewer>]].

What the student sees then: *"No source in your library covers this yet: electrode wear in
Hastelloy EDM. Add sources on it to continue."* (from step 3, the system also searches for them).

### 2. New lines (added under Constraints)

> - Do not write sentences that describe what this section, chapter or review will do, and do not
>   restate its aims. Write the content itself.
> - Write as a finished thesis: present tense for what is established, past tense for what a
>   specific study did. Do not use the future tense for the thesis's own work.
> - Begin with a connective such as "However", "Furthermore" or "Despite this" only when the
>   sentence before the cursor states a finding it refers to.

---

## A.2 Draft a section (`draft.md`)

### New lines (added under Constraints)

> - Review the evidence itself: what the studies found, how, under which conditions, and where
>   they agree or disagree. Do not write sentences that describe what this section will do.
> - Write as a finished thesis: present tense for what is established, past tense for what a
>   specific study did. Do not use the future tense for the thesis's own work.
> - In a section that reviews prior work, every paragraph must cite at least one passage. Where
>   the passages cannot support a paragraph, write
>   [[NEEDS SOURCE: <what is missing, in ten words or fewer>]] on its own line instead of the
>   paragraph.

(A.2 already has the `[[NEEDS SOURCE: …]]` marker and already shows it to the student as an amber
note; these lines make it the answer for a whole unsupported paragraph, not only a missing detail.)

---

## What does not change

- The rule that the model may cite only passages in the request, and the code that strips any
  other citation (§10.6). This is what keeps every citation real.
- Length limits, the two-sentence limit on autocomplete, and the student's style profile.
- The proposal and outline prompts. The proposal is the one place future tense is right.

---

## Step 4: the different-material warning (`coh_support.md`, the citation-support check)

The reviewer found Jenni citing stainless-steel findings in a maraging-steel review. Our
citation-support check already judges whether the cited passage says what the sentence claims.
This adds one verdict for "the passage is about something else".

### New verdict (added to the list of verdicts)

> - DIFFERENT_SUBJECT: the passage's finding is about a different material, organism, population,
>   country or setting from the one the sentence (and the thesis, per its scope) is about, and the
>   sentence applies it to its own subject without saying so. For example, a finding on stainless
>   steel cited as if it held for maraging steel.

### New rule (added under Rules)

> - Use DIFFERENT_SUBJECT only when the difference is stated in the passage or plain from it.
>   A sentence that says the finding comes from another setting ("in stainless steels, …; whether
>   this holds for maraging steel is untested") is SUPPORTED, not DIFFERENT_SUBJECT.

What the student sees: in the citation report and on the sentence, *"This source studies a
different material or setting: the finding may not carry over to your subject."* It is a warning,
never an automatic change.

(`coh_support.md` is not from PRD Appendix A; it was written for ADR-0023 and is already on your
review list in docs/PENDING.md. The same rule applies: nothing changes until you approve.)
