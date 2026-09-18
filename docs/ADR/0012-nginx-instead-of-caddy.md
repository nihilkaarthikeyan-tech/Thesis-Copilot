# ADR-0012 — nginx instead of Caddy, because the server already has one

**Date:** 2026-09-18
**Status:** Accepted
**Supersedes:** PRD §7.2's "Proxy / CI | Caddy 2", and §13.2's `caddy` service.

## What the PRD assumed

§13.1 describes the target host as a fresh VPS — "8 vCPU, 16 GB RAM, 160 GB NVMe, Ubuntu 24.04"
— and §13.2 puts a Caddy container in front, publishing `80:80` and `443:443`, terminating TLS and
obtaining its own certificates. That is the right design for a machine this product has to itself.

## What is actually there

The server this will run on (`srv1555044`, inspected 2026-09-17) is not a fresh VPS. It already
runs **eight other projects in 65 containers**, and **nginx owns ports 80 and 443** as the shared
edge for sixteen domains, with certbot renewing fifteen certificates against it.

Only one process can bind a port. Deploying §13.2 as written would mean our Caddy fails to start —
or, if it won reached the port first, sixteen live sites belonging to other projects would go down.
That is not a risk worth taking for a formatting preference.

Every other project on that box already solves this the same way: the app publishes on a loopback
port (Bank on 5010, Gate on 5008, PublishMate on 8180) and nginx proxies to it. We are the odd one
out, and the fix is to stop being.

## Decision

**Drop the Caddy container. Publish the stack on `127.0.0.1:3100` and let the host's nginx
terminate TLS and proxy to it.**

Concretely:

- `infra/compose/Caddyfile` is replaced by `infra/compose/edge.conf`, an **nginx container inside
  our own stack** doing the same routing Caddy did: `/api/*` to the API, `/metrics` to 404,
  everything else to the web app.
- That container publishes **only** `127.0.0.1:3100:80`. Nothing of ours is reachable from the
  internet except through the host's nginx.
- `infra/nginx/thesis.rademics.ai.conf` is the host vhost. It is **not installed by the deploy** —
  it is a file for a human to review and place, once, by hand.

## Why keep an nginx inside the stack at all

It would be simpler to publish `web` and `api` directly on two loopback ports and skip the inner
proxy. Two reasons not to:

1. **`api` runs `replicas: 2`** (§13.2). A fixed host port cannot be published by two containers —
   the second fails to bind. The inner proxy reaches `api:3001` by Docker's service DNS, which
   round-robins across the replicas, so the replica count stays a compose concern rather than
   becoming the host's problem.
2. **One place decides routing.** `/api/*` versus the web app, and the `/metrics` 404, are product
   decisions in this repo. Pushing them into the host's nginx would put our routing in a file
   owned by whoever administers the server, and split it from the code it serves.

This also matches PublishMate on the same box, which publishes `publishmate_prod_nginx` on
`127.0.0.1:8180` for exactly this reason.

## Consequences

**TLS moves to the host.** Caddy obtained certificates automatically; certbot on the host does it
now, the same way it does for the other fifteen domains. One extra manual step at first deploy,
and then it renews with everything else. `docs/RUNBOOK.md` has the command.

**The security headers move to the host vhost.** HSTS is only meaningful on the connection that
terminates TLS, so `Strict-Transport-Security`, `X-Content-Type-Options` and `Referrer-Policy` are
set in `thesis.rademics.ai.conf`, not in `edge.conf`. §12.1 is satisfied in a different file, not
abandoned.

**Streaming still has to not be buffered.** Appendix B.8 requires Assist tokens to reach the
browser as they are produced; Caddy did it with `flush_interval -1`. The API already sends
`X-Accel-Buffering: no`, which nginx honours natively, and both nginx layers additionally set
`proxy_buffering off` on `/api/`. Belt and braces, because a buffered stream is not a crash — it is
ghost text that arrives in one lump, which reads as "the feature is slow" rather than "the proxy is
misconfigured".

**A second reverse proxy is a second hop.** Measured cost is a sub-millisecond loopback forward;
the SSE read timeout is set to 10 minutes at both layers so a long coherence run is not cut off.

## What this does not change

The stack is otherwise §13.2 exactly: same images, same internal network, same healthchecks, same
volumes, same backup container. Nothing but the front door moved.

## If the product ever gets its own server

Revert to §13.2 as written. The Caddyfile is preserved in this ADR's history rather than deleted
from the repo's memory, and `edge.conf` is a dozen lines. This decision is about the machine, not
about Caddy being wrong.
