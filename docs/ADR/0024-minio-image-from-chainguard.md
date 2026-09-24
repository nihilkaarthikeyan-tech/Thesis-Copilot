# ADR-0024 — MinIO from Chainguard's image, because MinIO's own are gone

**Date:** 2026-09-24
**Status:** Accepted — takes effect in production at the next deploy (`docs/PENDING.md`)
**Supersedes:** the image reference chosen on 2026-09-19 (the prod compose comment), not the
decision to use MinIO (PRD §7.2).

## What happened

MinIO has withdrawn its public container images:

- `docker.io/minio/minio` — 404 since 2025 (why the compose files moved to quay.io on 09-19).
- `quay.io/minio/minio` — **401 to anonymous pulls, found 2026-09-24.** Every CI run since failed
  at container start: the API's integration suites could not start MinIO in Testcontainers, and
  the browser job could not start its `docker run`.
- `dl.min.io` binaries — 410 Gone.

The live server kept working only because the image was already on it. `infra/scripts/deploy.sh`
runs `docker compose pull` on every image, so **the next production deploy would have failed at
its first step.**

## The decision

Use `cgr.dev/chainguard/minio:latest` — Chainguard's maintained build of MinIO (its binary reports
`github.com/chainguard-forks/minio`), public and anonymously pullable at `latest`, rebuilt daily.

- **Same interface:** the S3 API, the `server /data` command (its entrypoint is `minio` itself),
  the root-user environment variables, `/minio/health/live`, and `mc` inside the image, so the
  compose health check (`mc ready local`) is unchanged.
- **Runs as root in the compose files** (`user: '0:0'`). The image defaults to uid 65532; the
  existing volumes were written as root by the old image and would be unreadable otherwise.
- **Proved on real data before choosing it:** the dev volume, written by the old image over three
  weeks, was switched in place — healthy, the same 651 objects before and after, a stored CSL style
  read back intact — and the upload/export browser tests and the Testcontainers suites pass.

## Rejected

- **Building MinIO from source ourselves.** It would work, and would make us the maintainers of a
  storage server's security updates.
- **Moving to another S3 server** (SeaweedFS, Garage, RustFS). A real option if the Chainguard build
  ever lapses, but a data migration in production for a problem an image reference solves.
- **Pinning a digest.** Chainguard's free tier is the `latest` tag; a pinned digest stops receiving
  the fixes that are the reason to use a maintained build. The compose health check and the deploy
  script's health gate are the guard.

## Consequences

- A different build of the storage server reads production's data from the next deploy on.
  `docs/PENDING.md` asks for a backup of the `minio_data` volume first — the backup crons are
  themselves still pending.
- If Chainguard stops publishing it, the fallback is the "another S3 server" row above, with an
  export/import of the bucket.
