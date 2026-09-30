<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). It started as docs/PRD.md, "### A.7 Search query generation — `queries.md`".
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
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
