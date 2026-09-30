<!--
  NOT FROM PRD APPENDIX A. Written for the citation-support check, which Appendix A has no prompt for.

  See docs/ADR/0023-citation-support-check.md. Appendix A's coherence prompts (A.12.1–A.12.4) ask
  whether a claim needs a citation and whether two claims contradict each other; none asks whether
  the passage a claim cites says what the claim says it says. This one does, in A.12.3's shape:
  sentences in, one small JSON verdict per sentence out, Fast tier.

  PRD §0.3 rule 11 still applies to it. If it performs badly, record examples in
  docs/BUILD_LOG.md and propose a change for the human to approve rather than editing it here.
  docs/PENDING.md asks the owner to review it.
-->

### Citation support check — `coh_support.md`

**Tier:** Fast. **Max output:** 1,500 tokens. **Temperature:** 0. **Cached:** A.0 + A.0.1.

```
Task: for each sentence, decide whether the passages it cites support what the sentence says about them. Judge only against the passages given. You have not read the rest of the paper, and must not assume what it says.

Output JSON only: {"results":[{"sentenceId": string, "verdict": "SUPPORTED" | "WEAKLY_SUPPORTED" | "OVERSTATED" | "MISREPRESENTED" | "DIFFERENT_SUBJECT" | "NOT_IN_PASSAGE", "why": string (<= 20 words), "quote": string}]}

Verdicts:
- SUPPORTED: a passage states what the sentence attributes to it, at the same strength.
- WEAKLY_SUPPORTED: a passage is on the same subject but does not itself state the claim. The sentence leans on it for more than it says.
- OVERSTATED: a passage states a weaker version of the claim. It is hedged where the sentence is certain, narrower in scope than the sentence, a correlation the sentence calls a cause, or one setting the sentence generalises from.
- MISREPRESENTED: a passage says something different from, or opposite to, what the sentence attributes to it.
- DIFFERENT_SUBJECT: the passage's finding is about a different material, organism, population, country or setting from the one the sentence (and the thesis, per its scope) is about, and the sentence applies it to its own subject without saying so. For example, a finding on stainless steel cited as if it held for maraging steel.
- NOT_IN_PASSAGE: none of the passages addresses the claim. The paper may say it elsewhere. Do not guess.

Rules:
- Judge what the sentence claims the source says, not whether the claim is true.
- The student's own framing and argument ("This thesis argues…", "Building on X, we…") is not a claim about the source. Judge only the part attributed to it.
- When a sentence cites several passages, judge the sentence against them together.
- quote: the shortest span that shows your verdict, copied exactly from one passage, at most 25 words. Leave it empty for NOT_IN_PASSAGE.
- Use DIFFERENT_SUBJECT only when the difference is stated in the passage or plain from it. A sentence that says the finding comes from another setting ("in stainless steels, …; whether this holds for maraging steel is untested") is SUPPORTED, not DIFFERENT_SUBJECT.
- One result for every sentence given, in the order given.
```
