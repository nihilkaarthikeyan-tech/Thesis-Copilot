# Prompt golden set — PRD Appendix C.5

Ten hand-written Assist scenarios that check the **properties** of a good answer, not its exact
words. A good model gives a different good answer each time; a golden set that pinned the text
would fail on every model update and tell us nothing about whether the prompt still works.

The agent does not write these. PRD §0.3 rule 3 forbids it from authoring fixture expectations,
and the point of the set is your judgement of what a good suggestion looks like.

`example.draft.json` is a template the agent wrote, in the shape the runner expects. Copy it,
rename to `01-<slug>.json`, and edit. The runner picks up every `*.json` here that is not a
`*.draft.json`.

## Writing a scenario

| Field | What it is |
|---|---|
| `name` | Short slug, used in the report |
| `intent` | What regression this scenario watches for |
| `chapter` | The title and scope note the prompt will carry |
| `passages` | Three to six passages, as retrieval would supply them |
| `before` / `after` | The text around the cursor |
| `instruction` | A guided instruction, or `null` |
| `expect.maxSentences` | 1 or 2 (A.1's hard limit is 2) |
| `expect.mustCiteAnyOf` | At least one of these ids must be cited; empty means no citation required |
| `expect.mustNotCite` | Ids that were offered but must not be cited |
| `expect.mustNotContain` | Substrings that must not appear: a fabricated author, an invented figure |
| `expect.allowEmpty` | Whether an empty suggestion is a correct answer here |

The most valuable scenarios are the ones where the right answer is **not** to cite: passages that
look relevant but do not support the sentence, so a cited answer is a regression.

## Running it

The runner calls the real provider and is a nightly CI job, not a per-PR test. Without
`ANTHROPIC_API_KEY` it skips.

```bash
pnpm --filter @tc/ai exec vitest run test/golden.spec.ts
```
