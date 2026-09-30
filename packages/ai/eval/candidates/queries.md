<!--
  CANDIDATE for queries.md (ADR-0038). Tested against the prompt on disk by eval/run.ts; it replaces
  it only if it wins.
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
- Use the specific technical terms of this thesis: the material, process, population, setting and measured outcomes named in the scope, with a common synonym where the field uses one (for example "EDM" and "electrical discharge machining").
- Every query must stay inside this thesis's field. A query that would also return papers from unrelated fields ("electrode wear" alone returns batteries) needs one more specific term.
```

User message: `<scope>` block from memory, plus `<existing_sources>` (titles only, for Path B) with the instruction "prefer queries that would find work adjacent to these".
