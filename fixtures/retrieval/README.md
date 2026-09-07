# Retrieval Q&A set — human task

**Owner:** the human, not the agent. **Spec:** PRD Appendix C.4.
**Depends on:** the five papers in `fixtures/papers/` existing first.

The agent must never write the questions (PRD §0.3 rule 2). The whole point of the set is your
judgement of what a paper actually answers; a set the agent invented would be marking its own work.

## What this measures

Whether retrieval finds the right passage. Everything downstream — Assist's grounding, citation
suggestion, chat — sees only the six chunks retrieval returns, and a suggestion built on the wrong
six is wrong in a way no test of the prompt itself can catch.

**Metric:** recall@6 ≥ 0.80 across the 30 questions, with no pins.

## What to write

Six questions per paper, thirty in total, in `fixtures/retrieval/qa.json`:

```json
{
  "questions": [
    {
      "paper": "p01",
      "question": "What was the main barrier to adoption?",
      "page": 7,
      "quote": "Upfront cost was reported by 78% of households as the main barrier."
    }
  ]
}
```

| Field | What it is |
|---|---|
| `paper` | `p01` … `p05`, matching the file in `fixtures/papers/` |
| `question` | A question that paper answers, phrased as a student would ask it |
| `page` | The printed page number the answer is on — so you can find it again |
| `quote` | A short verbatim quote of the passage that answers it |

## Rules for the quote

The quote is matched into a chunk by **exact substring**, after collapsing whitespace. There is no
fuzzy matching and there must never be one: a near-match would label the wrong chunk and the score
would be measuring something else.

- **Copy it verbatim** from the PDF. Do not tidy the punctuation or fix a typo in the original.
- **One or two sentences.** Long enough to be unique in the paper; short enough to sit inside one
  chunk. A quote spanning a paragraph break will usually straddle two chunks and fail to locate.
- **Do not quote across a page break**, a table, or a figure caption.
- Minimum 20 characters, enforced by the schema.

## Rules for the questions

- Ask what the paper **answers**, not what it is about. "What was the main barrier to adoption?"
  works; "What is this paper about?" does not, because every chunk is a plausible answer.
- Spread them across the paper — not six questions about the abstract.
- Phrase them the way a student would type them, not the way the paper words them. If the question
  reuses the passage's exact wording, the embedding match is trivially easy and the measurement
  tells you nothing.
- Include at least one question per paper whose answer is in the **method or results**, not the
  introduction. Those are the ones retrieval finds hardest and the ones a thesis actually cites.

## If a quote does not match any chunk

The run reports it as `Quote in no chunk — fix the chunker, not the fixture`. That is deliberate,
and it is C.4's instruction: it means the chunker split the passage, and the chunker is what gets
fixed. Do not shorten the quote to make it pass.

Unlocated questions also stay in the denominator, so the score cannot be improved by losing
passages.

## Running it

```bash
pnpm --filter @tc/retrieval test recall
```

Without `qa.json` the suite reports `BLOCKED` and skips — it never fails for the file's absence.
With it, the per-paper table and the verdict go into `docs/BUILD_LOG.md`.

The scoring itself is `packages/retrieval/src/recall.ts`; wiring it to a live index needs the
papers ingested, which is why the two tasks land together.
