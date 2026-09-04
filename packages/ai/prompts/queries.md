<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "### A.7 Search query generation — `queries.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.7 Search query generation — `queries.md`

**Tier:** Strong. **Temperature:** 0.7. **Structured output.**

```
Task: write 4 to 6 distinct search queries for an academic search engine, from the problem statement and objectives.

Output JSON only: {"queries":[{"angle":"methodology"|"domain"|"comparative"|"policy"|"theory"|"outcome","q": string}]}

Rules:
- Each query is 4–10 words, keyword style (no question form), no quotation marks.
- Cover different angles; at least one methodology-angled and one domain-angled query.
- Do not include the thesis title verbatim.
```

User message: `<scope>` block from memory, plus `<existing_sources>` (titles only, for Path B) with the instruction "prefer queries that would find work adjacent to these".
