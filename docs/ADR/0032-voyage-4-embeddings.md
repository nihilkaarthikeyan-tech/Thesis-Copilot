# ADR-0032 — Embeddings move from `voyage-3` to `voyage-4`

**Date:** 2026-09-25
**Status:** Accepted (the owner's decision: "yes switch to voyage-4")
**Changes:** PRD §7.2's embedding model. The dimension (1024), the schema (`vector(1024)`), the
adapter and every call site are unchanged; only `AI_EMBED_MODEL` moves.

## Why

Read off docs.voyageai.com on 2026-09-25: `voyage-3` is now listed among Voyage's older models at
USD 0.06 per million tokens with no free tokens. `voyage-4` costs the same, defaults to the same
1024 dimensions, takes the same request, and every account's first 200 million tokens on it are
free — about 650 thirty-paper libraries. The live site holds almost no papers, so the switch is
cheapest now: everything already stored has to be re-embedded, and there is almost nothing to
re-embed.

## What a model switch actually requires

A vector from one model cannot be compared with one from another. Changing the model name alone
would leave every stored `SourceChunk` and `ChapterChunk` silently wrong for search — queries in
`voyage-4`, rows in `voyage-3` — with no error anywhere. So:

1. `pnpm ai:verify` first: the provider accepts the id and returns 1024-d vectors. It did.
2. `pnpm ai:reembed` (`apps/api/scripts/reembed-chunks.ts`, new): every chunk's `embedding`
   updated in place, 64 a call, waiting out Voyage's 3-requests-a-minute limit on an account
   without a payment method. Nothing else is touched; safe to re-run.
3. The floor under chat re-measured. `RELEVANCE_FLOOR` (0.30) was placed by hand on `voyage-3`'s
   cosines; a different model's cosines sit differently. The measurement is now a script
   (`pnpm --filter @tc/ai floor`), which the first placement never was. On `voyage-4`: on-topic
   0.529–0.771, in-subject-but-absent 0.384–0.473, off-topic 0.099–0.232. 0.30 sits inside the
   gap, so it stays; `rank.spec.ts` carries both models' populations.

In production the same three steps run at the next release, in that order, inside the thesis
site's own containers: set `AI_EMBED_MODEL=voyage-4` in the VPS `.env`, deploy, re-embed.

## Not done

A column recording which model made each vector, so a mismatch could be detected rather than
remembered. Worth adding the next time the schema changes; until then this ADR and the reembed
script are the guard.
