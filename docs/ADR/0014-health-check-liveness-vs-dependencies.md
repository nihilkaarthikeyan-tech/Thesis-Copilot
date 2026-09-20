# ADR-0014 — the health check probed the wrong provider, and let a third party restart us

**Date:** 2026-09-20
**Status:** Accepted
**Amends:** PHASES 0.6's "returns DB/Redis/MinIO/provider status", and the behaviour
`health.controller.ts` documented as "answers 200 only when all of them are up".

## What was wrong

Two things, found by reading the first 24 hours of production logs (2026-09-20).

**It watched a provider we do not use.** `probeProvider` fetched `https://api.anthropic.com/v1/models`.
ADR-0011 moved both tiers to OpenAI months ago; no configured model routes to Anthropic, and the
key is deliberately unused. So the check was backwards in both directions: if **OpenAI** went down
the endpoint would still answer "up" and nothing would notice, while a hiccup at **Anthropic** — a
service this product does not call — could mark our containers unhealthy. Same class of straggler
as the missing `OPENAI_API_KEY` in `.env.production.example`, found during the same deploy.

**It let any third-party blip restart us and roll back releases.** Three endpoints consume
`/api/v1/health`, and they act on it very differently:

| Consumer | Reads | Acts by |
|---|---|---|
| Docker `healthcheck` | HTTP status | marking the container unhealthy after 3 failures |
| `deploy.sh` | HTTP status | **rolling back the release** |
| Uptime Kuma (§14) | body keyword `"status":"ok"` | alerting a human |

Because provider reachability counted toward the 200/503, an OpenAI outage would have marked both
API replicas unhealthy and — if it happened during a release — rolled back a perfectly good deploy.
Restarting our container does not fix OpenAI, and neither does shipping the previous image. This is
the same mistake, in a different file, as `deploy.sh` health-checking the public URL: *a signal that
triggers an action should only carry things that action can fix* (ADR-0012).

Observed, not theorised: three spurious 503s in the first 24 hours (13:33, 00:38, 05:29), each a
transient failure reaching a host the product never calls. None were consecutive, so nothing
actually restarted — `RestartCount=0` on all twelve containers. That is luck, not design.

## Decision

**Report every dependency. Let only the ones we can act on decide the HTTP status.**

- `database`, `redis`, `objectStorage` — **core**. If one of these is down this process genuinely
  cannot serve, and replacing the container is a reasonable thing to try. These decide 200 vs 503.
- `llmProvider`, `embeddings` — **reported, not fatal**. Probed against the vendors actually
  configured, derived from the model ids by the same `providerForModel` the router uses, so the
  check cannot drift from the configuration again the way it just did.

The body's `status` field becomes `ok` only when *everything* is up, and `degraded` when a provider
is unreachable while core infrastructure is fine. So:

- **Uptime Kuma still alerts** on a provider outage — its keyword `"status":"ok"` stops matching.
- **Docker and `deploy.sh` do not act** on it — the response is still 200.

Two signals already existed in one response; this gives each one the job it is suited to. PHASES
0.6's "returns … provider status" is satisfied — the provider status is still returned, and now for
the right provider.

## Why not just fix the URL

That was the smaller half. Pointing the probe at OpenAI would have fixed the "watching the wrong
thing" bug and left the "a vendor outage rolls back our releases" bug entirely in place — arguably
making it *more* likely to fire, since it would then be watching a host we depend on heavily rather
than one we never call.

## Consequences

**A provider outage is now visible but not self-destructive.** `/health` answers 200 with
`"status":"degraded"` and the failing provider named. A human is paged; nothing restarts.

**Embeddings are checked for the first time.** Voyage is as load-bearing as the LLM — no embeddings
means no indexing, no retrieval, no chat — and nothing was watching it. Worth knowing given the
account is still rate-limited to 3 requests/minute (`docs/PENDING.md`).

**Still reachability only, never a completion.** Unchanged from the original: a health check must
not cost money or draw on a cap (PRD §11). A 401 or 405 is a fine answer — it proves the host is
serving.

**The endpoint makes two outbound calls instead of one**, every 30 seconds per replica. Both are
HEAD-weight and neither can fail the container any more, so the added flakiness has nowhere to go.
