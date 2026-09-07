# Runbook

Operating Thesis Copilot in production. PRD §7.5, §12.1, §13.5, §14; PHASES v2 B4.3.

Every command below runs on the VPS from `~/thesis-copilot/infra/compose`, which holds
`docker-compose.prod.yml`, `.env`, and `.last_good_tag`. `COMPOSE` is
`docker compose -f docker-compose.prod.yml` throughout.

> The load test, the first Sentry event, Uptime Kuma's first check and the backup drill are
> **not** yet done — they need the server. `docs/PENDING.md` has each with its exact steps. This
> file describes procedures; it does not claim they have been rehearsed.

---

## 1. What is running

| Service | Port | What it is |
|---|---|---|
| `caddy` | 80, 443 | TLS and reverse proxy. Owns the certificates. |
| `web` | internal | Next.js. Stateless. |
| `api` | internal | NestJS on Fastify. Stateless — sessions are cookies plus Postgres. |
| `worker` | none | BullMQ consumers. No inbound port; this is what makes §7.5 step 2 possible. |
| `postgres` | internal | Everything durable. |
| `redis` | internal | Queues, rate limits, SSE fan-out. |
| `minio` | internal | PDFs, exports, snapshots. |
| `gotenberg` | internal | LibreOffice, for every PDF the product produces. |
| `grobid` | internal | Reference parsing, behind the `grobid` flag. |
| `backup` | none | The nightly cron in §5. |
| `uptime-kuma`, `prometheus` | internal | §14 monitoring. |

Health: `curl -fsS https://$DOMAIN/api/v1/health`. It returns 200 only when Postgres and Redis
both answer, so it is the single check worth alerting on.

---

## 2. Deploy

`release.yml` builds images to GHCR on a tag and runs `infra/scripts/deploy.sh` over SSH. By hand:

```bash
./deploy.sh v0.4.0
```

The script pulls the tag, brings the stack up, runs `prisma migrate deploy`, polls health for 150
seconds, and **rolls back to `.last_good_tag` by itself** if health never comes up. A deploy that
prints `ROLLBACK` has already restored the previous version — do not deploy again until you know
why the new one failed.

### What to check after a deploy

```bash
$COMPOSE ps                       # every service Up, none restarting
$COMPOSE logs --tail=50 api worker
curl -fsS https://$DOMAIN/api/v1/health
```

### Migrations

`deploy.sh` runs `prisma migrate deploy` before health is checked, so a failed migration fails the
deploy. Migrations in this repo are additive by rule — a column is added with a default, never
dropped in the same release that stops writing it — so the previous image keeps working against
the new schema. That is what makes the automatic rollback safe.

---

## 3. Rollback

The deploy script rolls back on its own when health fails. To roll back a release that *is*
healthy but wrong:

```bash
cat .last_good_tag                # the tag you are going back to
./deploy.sh <that tag>
```

**A rollback does not undo a migration.** If the release you are backing out included a
destructive migration, restore from a dump (§6) instead — and treat the destructive migration as
the incident, not the rollback.

---

## 4. Rotate a secret

All secrets are in `.env` on the VPS and in GitHub Actions secrets for the ones CI needs. Rotating
is: change it at the provider, change it in `.env`, restart the services that read it.

| Secret | Read by | After changing |
|---|---|---|
| `AUTH_SECRET` | api | `$COMPOSE up -d api` — **every session is signed out.** Do it at a quiet hour and say so first. |
| `ANTHROPIC_API_KEY` | api, worker | `$COMPOSE up -d api worker` |
| `VOYAGE_API_KEY` | api, worker | `$COMPOSE up -d api worker` |
| `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | api | `$COMPOSE up -d api`, then re-point the webhook in the Razorpay dashboard and send a test event. |
| `S3_SECRET_KEY` | api, worker, minio | Change it in MinIO first, then `.env`, then `$COMPOSE up -d`. Changing `.env` alone locks the app out of its own bucket. |
| `POSTGRES_PASSWORD` | everything | `ALTER USER ... PASSWORD` inside Postgres, then `.env`, then `$COMPOSE up -d`. |
| `SENTRY_DSN` | api, web, worker | `$COMPOSE up -d` |

Rotate one at a time and check health between each. A rotation that takes the stack down is
indistinguishable from an outage to everyone watching.

---

## 5. Backups

`infra/scripts/backup.sh` runs nightly in the `backup` container: `pg_dump --format=custom`, then
`mc mirror` of the dump and the MinIO bucket to off-site storage. Dumps older than
`BACKUP_KEEP_DAYS` (14) are deleted locally; the off-site copy is kept by that provider's policy.

```bash
$COMPOSE exec backup /app/backup.sh          # run one now
$COMPOSE exec backup ls -lh /backups         # what is there
```

**Test the restore weekly** (§12.1). It restores into a scratch database, counts rows and drops it;
the live database is never touched:

```bash
$COMPOSE exec backup /app/restore.sh --test
```

A backup nobody has restored is a hypothesis.

---

## 6. Restore

```bash
$COMPOSE stop api worker web                 # stop writers first
$COMPOSE exec backup /app/restore.sh --into thesis_copilot /backups/tc-<stamp>.dump
$COMPOSE up -d
curl -fsS https://$DOMAIN/api/v1/health
```

Object storage is separate: `mc mirror offsite/<bucket>/objects/<bucket> local/<bucket>` brings the
PDFs and exports back. A database restored without its objects gives every student a library whose
files 404.

After any restore, check that `_prisma_migrations` matches the running image:

```bash
$COMPOSE exec api pnpm --filter @tc/db exec prisma migrate status
```

---

## 7. Scale the worker to a second VPS (§7.5 step 2)

BullMQ is Redis-backed and the worker has no inbound port, so this needs no code change.

1. Open Redis and Postgres to the second host only — a private network or a firewall rule for that
   IP. Never the public internet.
2. On the new host, copy `.env` and change nothing but `REDIS_URL` and `DATABASE_URL` to point at
   the first host's private address.
3. `docker compose -f docker-compose.prod.yml up -d worker` — that service only.
4. Watch both workers: `$COMPOSE logs -f worker`. Each job is taken once; BullMQ handles the
   division. A job appearing in both logs means two workers share a queue name but not a Redis,
   which means `REDIS_URL` is wrong on one of them.
5. Add PgBouncer when Postgres connection count becomes the limit, not before.

To scale back down, stop the worker on the second host. In-flight jobs are retried by the
remaining worker; nothing is lost, because every job is idempotent on its job id.

---

## 8. When something is wrong

**Health is failing.** `$COMPOSE ps` first. A restarting `api` is almost always a bad `.env` — the
app refuses to start on a missing required variable by design (§0.2), and the reason is the first
line of `$COMPOSE logs api`.

**Jobs are not running.** `$COMPOSE logs --tail=100 worker`. A worker that logged `worker ready`
and then nothing is connected but idle; check Redis (`$COMPOSE exec redis redis-cli ping`). A
worker that is not there at all leaves uploads stuck in `PENDING` forever.

**AI calls are failing.** `/admin/cost-model` says whether the cost model is verified;
`/admin/users` shows per-user spend. A provider outage shows as failed `AiCallLog` rows with the
provider's message; the product degrades to "the model is unavailable" rather than losing work.

**One student is over their cap.** That is the design (§11.5), not an incident. `/admin/users` has
a logged cap reset if it was genuinely our fault.

**Storage is full.** `docker system df`, then `docker image prune -a`. Exports are pruned to the
last five per document; snapshots and library PDFs are not, so MinIO grows with real use.

---

## 9. Dependency audit

Run before a release:

```bash
pnpm audit --prod                  # known advisories in what ships
pnpm outdated -r                   # what has moved
```

Rules for this repo:

- **The stack in PRD §7.2 is fixed.** A major-version bump of Next, Nest, Prisma, TipTap or
  Postgres is a decision, and it needs an ADR before the upgrade, not after.
- Patch and minor updates to everything else: take them, run `pnpm typecheck && pnpm lint &&
  pnpm test`, commit on their own.
- `@citation-js/*` styles are content, not code — the CSL files in `packages/citations/styles`
  carry their own CC BY-SA provenance in that directory's README and are updated deliberately.
- An advisory with no fix available goes in `docs/PENDING.md` with the date and the reasoning, so
  the next person does not rediscover it.
