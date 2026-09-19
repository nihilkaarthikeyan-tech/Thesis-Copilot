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
| `edge` | 127.0.0.1:3100 | nginx. Routes `/api/*` to the API, everything else to the web app. **Loopback only** — the host's own nginx terminates TLS in front of it (ADR-0012). |
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

## 1a. First deploy only — putting the site on the host's nginx

Done once, by a human, and never by the deploy script. The server already runs nginx for sixteen
other domains; this adds a seventeenth file and touches none of the others (ADR-0012).

```bash
# 1. DNS first. The certificate cannot be issued until the name resolves.
#    Add an A record:  thesis  ->  <server ip>     then wait for it:
getent hosts thesis.rademics.ai

# 2. Clone the repo. Its own deploy key (read-only, added once as a GitHub Deploy Key on this
#    repo), never the shared root key -- one key per project, so losing one exposes only this.
ssh-keygen -t ed25519 -N "" -C "deploy-key-thesis-copilot" -f ~/.ssh/deploy_thesis
cat ~/.ssh/deploy_thesis.pub    # add as a Deploy Key on the GitHub repo, read-only, then:
cat >> ~/.ssh/config <<'SSHCFG'

Host github-thesis
    HostName github.com
    User git
    IdentityFile /root/.ssh/deploy_thesis
    IdentitiesOnly yes
SSHCFG
git clone github-thesis:nihilkaarthikeyan-tech/Thesis-Copilot.git ~/thesis-copilot

# 3. deploy.sh lives in infra/scripts (alongside backup.sh/restore.sh, its siblings) but runs from
#    infra/compose (the directory holding docker-compose.prod.yml, .env and .last_good_tag). One
#    symlink bridges that, for both the CI workflow and a by-hand run below.
ln -s ../scripts/deploy.sh ~/thesis-copilot/infra/compose/deploy.sh

# 4. Place the vhost. It is in this repo, reviewed, not generated.
sudo cp ~/thesis-copilot/infra/nginx/thesis.rademics.ai.conf /etc/nginx/sites-available/thesis.rademics.ai
sudo ln -s /etc/nginx/sites-available/thesis.rademics.ai /etc/nginx/sites-enabled/

# 5. Test BEFORE reloading. This is the safety net: nginx checks every site's config, and a
#    mistake here is a refusal rather than an outage. The running sites keep the old config.
sudo nginx -t

# 6. Only if step 5 said "successful":
sudo systemctl reload nginx

# 7. Certificate. certbot edits the file in place to add the TLS lines.
sudo certbot --nginx -d thesis.rademics.ai

# 8. The production .env (infra/compose/.env) is never in git -- build it from
#    .env.production.example by hand, chmod 600, and never let it touch anywhere else.

# 9. GitHub Actions needs its own way in, separate from the repo's own deploy key above (that one
#    is read-only and points the other direction -- VPS reading GitHub, not GitHub reaching the
#    VPS). Generate it, authorize it, and hand only the private half to the repo's secrets --
#    piped directly, never saved to a file or printed, so it never sits in a shell history or a
#    terminal scrollback:
ssh-keygen -t ed25519 -N "" -C "github-actions-deploy-thesis-copilot" -f ~/.ssh/gha_deploy_thesis
cat ~/.ssh/gha_deploy_thesis.pub >> ~/.ssh/authorized_keys
#    From your own machine, with the VPS key added above and gh authenticated:
#      ssh <vps-alias> 'cat ~/.ssh/gha_deploy_thesis' | gh secret set VPS_SSH_KEY --repo <org>/<repo>
#      gh secret set VPS_HOST --repo <org>/<repo> --body "<server ip>"
#      gh secret set VPS_USER --repo <org>/<repo> --body "root"
#      gh secret set DOMAIN --repo <org>/<repo> --body "thesis.rademics.ai"
#      gh secret set NEXT_PUBLIC_API_URL --repo <org>/<repo> --body "https://thesis.rademics.ai"

# 10. Prove it, and prove nothing else moved.
curl -fsS https://thesis.rademics.ai/api/v1/health
for d in rademics.ai bank.rademics.ai gate.rademics.ai neet.rademics.ai; do
  printf '%s %s
' "$d" "$(curl -s -o /dev/null -w '%{http_code}' https://$d/)"
done
```

**If step 3 fails**, fix the file and run it again. Nothing has been reloaded, so nothing is
broken. Do not reload on a failed test.

**To undo it entirely:** `sudo rm /etc/nginx/sites-enabled/thesis.rademics.ai && sudo nginx -t &&
sudo systemctl reload nginx`. The other sites never knew it was there.

Renewal needs no action — the host's certbot cron covers this domain with the rest.

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
curl -fsS http://127.0.0.1:3100/api/v1/health   # the stack itself
curl -fsS https://$DOMAIN/api/v1/health         # through the host's nginx
```

Both, because they fail for different reasons: the first failing means the stack is down, the
second alone failing means the host vhost or its certificate is.

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
