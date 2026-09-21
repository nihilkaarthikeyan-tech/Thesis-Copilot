# ADR-0016 — three chat scopes, and what a web result is allowed to be

**Date:** 2026-09-21
**Status:** Accepted
**Extends:** FR-4.9 (chat over the library), and is constrained by §10.6 (grounding).

## What prompted it

The owner sent a screenshot of a competitor's editor. Its chat panel offers three buttons —
**Web Ask**, **Library Ask**, and a *Current document* chip — where ours offered one thing: the
uploaded library.

Two of those three were straightforward gaps. The third was not, and it is the reason this ADR
exists rather than a line in the build log.

## The easy one: `document`

A student cannot ask anything about their own draft. "What have I already said about adoption
barriers?" is a question people genuinely have at 1 a.m. in chapter four, and the answer is sitting
in the database.

**Decision: the student's chapters are passed directly, not indexed.** They change on every
keystroke, so an index of them would be stale before it was written; passing the text costs no
embedding call, which also matters while the Voyage account is rate-limited to 3 requests a minute
(`docs/PENDING.md`).

Two consequences follow and both are deliberate:

- **Nothing in this scope is citable.** Chapter passages carry no `sourceId`, so `postProcessChat`
  strips any citation the model produces against them. That is correct: a claim about your own
  draft is not a citation, and the bibliography must never gain an entry pointing at the thesis
  itself.
- **`isOffTopic` is skipped.** It is a cosine floor and these passages have no cosines — they were
  included because the student asked about this document, not because a vector search ranked them.
  Running the floor would mean inventing a score. An empty document still refuses, which is the
  case that actually matters.

## The hard one: `web`

A prose answer synthesised from web pages is **exactly what this product exists not to produce**.
§10.6 says the model may cite only passages present in the request; anything else is stripped and
counted as `HALLUCINATED_CITE`. A web answer has no passage to ground against, no page number, and
nothing that can enter a bibliography. Shipping one would mean either breaking the grounding rule
or shipping a confident paragraph a student cannot cite and cannot check — and a thesis is the one
document where an uncitable confident paragraph is worst.

Three options were put to the owner:

| | |
|---|---|
| **(a)** Don't build it | Grounding is the product; the gap is a feature |
| **(b)** Build it as marked, non-citable background reading | Honest, but still a paragraph nobody can use |
| **(c)** Let a web hit be **promoted into a real source** | Keeps the promise and gives the feature a job |

**The owner chose (c), and it is the right answer.**

### What (c) actually means

**A web result is not an answer. It is a candidate source.**

The scope searches the scholarly indexes the product already uses — OpenAlex, and Semantic Scholar
when a key is configured — and returns real works with real metadata: title, venue, year, citation
count, preprint status, open-access status. **No prose is generated. The model is not called at
all**, which is also why this scope is not metered: there is no provider spend to meter, and a cap
on a search that costs nothing would be a cap for its own sake.

Adding one goes through `POST /documents/:id/sources/resolve` — the identical path a pasted
bibliography takes. From that moment it is an ordinary `Source`: fetched, chunked, embedded, and
citable through the grounded pipeline. Nothing skips the queue and nothing gets a special case.

So the student's loop becomes: *ask on Web → add the paper → ask the same question on Library →
get a grounded, cited answer.* The panel says exactly that, because a feature that answers a
different question from the one asked has to admit it.

### What this refuses to do, stated plainly

It answers **"what has been written about X?"** It does not answer **"what is the answer to X?"**

The second is the question a general-purpose assistant answers, and it is the one a thesis tool
must not — not because it is hard, but because an answer with no passage behind it is the failure
mode the entire product is built to prevent.

## Consequences

**Feature parity without adopting the competitor's risk.** All three buttons now exist. One of
them behaves differently from theirs, and the difference is the argument for this product.

**The web scope degrades quietly.** OpenAlex needs no key. Semantic Scholar is optional and its
failure is logged and swallowed, so a missing key narrows the results rather than emptying them.

**A new way into the library that is not the literature-search screen.** `SearchService` remains
the place for a systematic, logged, gap-mapped search. This is the opportunistic one — you were
writing, you wondered, you found something, you added it. Both end in the same `Source` table.

**`document` scope is bounded, not complete.** Six chapters, 9,000 characters each. A thesis is
larger than a prompt, and silently answering from half of it would be worse than a bound that can
be stated.
