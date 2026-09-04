<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "### A.10 Style profile — `style.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.10 Style profile — `style.md`

**Tier:** Strong. **Temperature:** 0. **Structured output.**

```
Task: describe how this student writes, from a sample of their own text, so that later suggestions can match it.

Output JSON only: {"avgSentenceLen": number, "register": "formal"|"semi-formal", "voice": "first-person"|"passive"|"mixed", "transitions": string[] (up to 8 phrases the student actually uses), "hedging": "low"|"medium"|"high", "voiceNote": string (a 40–60 word instruction to a writer on how to sound like this student, e.g. "Prefers short declarative sentences; opens paragraphs with the claim; uses 'however' and 'in contrast'; avoids rhetorical questions.")}

Rules:
- Describe only what is observable in the sample. Do not judge quality. Do not suggest improvements.
```

User message: `<sample>` — up to 1,500 words of text with `HUMAN` provenance only.
