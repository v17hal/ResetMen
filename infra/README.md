# Deploying RESET

One VPS, five containers behind Caddy. 2 GB of RAM is enough for one outlet; the scaling
path for a second is in [docs/03 — Architecture](../docs/03-architecture.md).

```
                    ┌─── Caddy (TLS, auto-renew) ───┐
   :443 ────────────┤                               │
                    │  api.reset.app   → api:4000   │
                    │  reset.app       → web:3000   │
                    │  admin.reset.app → admin:3001 │
                    └───────────────┬───────────────┘
                                    │ internal network only
                     ┌──────────────┼──────────────┐
                  postgres:16     redis:7       backup
                  (checksums)   (no persist)   (nightly)
```

Postgres and Redis publish **no host ports**. A Postgres listening on `0.0.0.0` is how a
shop's customer table ends up on a leak site.

## First deploy

```bash
# 1. DNS: point api / www / admin A records at the VPS before starting Caddy, or the
#    ACME challenge fails and you get a rate limit rather than a certificate.

# 2. Secrets
cp infra/.env.prod.example infra/.env.prod
chmod 600 infra/.env.prod
# Fill in POSTGRES_PASSWORD, the three JWT secrets, Razorpay, MSG91.
# Generate each with: openssl rand -base64 48

# 3. Migrate, then start
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod \
  run --rm api npx prisma migrate deploy

docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d

# 4. Create the first staff login. Never seeded — a default admin password follows a
#    project into production and gets forgotten.
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod \
  exec api node dist/../prisma/seed/create-admin.js owner@reset.app 'a-real-password' OWNER
```

The API **refuses to start** without `FIREBASE_PROJECT_ID`. That is deliberate: customers
sign in through Firebase, and a deployment that looks healthy while nobody can sign in is
worse than one that will not boot.

Payments and SMS are both off for this store — see [doc 11](../docs/11-scope-changes.md).
Razorpay keys become mandatory only if `PAYMENTS_ENABLED` is ever set to `true`.

## Backups

The `backup` container dumps the database and the media volume nightly, keeps 14 days, and
runs once immediately on boot so a fresh deploy has a restore point before the first
customer rather than after the first night.

Two things it does that a bare `pg_dump` does not:

1. Writes to a temporary name and renames on success — an interrupted dump leaves a
   plausible-looking file that restores into a half-empty database, and you find out on the
   day you need it.
2. Verifies the archive is readable **before** pruning anything older. A retention policy
   that deletes good backups to make room for broken ones is worse than none.

### Rehearse the restore — do this before launch, then quarterly

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod \
  run --rm -v ./infra/restore.sh:/restore.sh backup sh /restore.sh --rehearse
```

Restores the newest backup into a scratch database, counts the rows, **verifies the
exclusion constraint came back**, and drops the scratch database. Touches nothing live.

That last check is the point. A restore that brings back every row but not the
`EXCLUDE USING gist` constraint gives you a database that will happily double-book a
station — and nothing else in the stack would notice.

A backup nobody has ever restored is a hypothesis, not a backup.

### Restoring for real

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod stop api
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod \
  run --rm -v ./infra/restore.sh:/restore.sh backup \
  sh /restore.sh --confirm db-20260812-020000.dump
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod start api
```

Requires an explicit filename — there is no `--latest` shortcut on purpose. Choosing the
file is the moment you notice the newest backup predates the incident. It takes a safety
dump of the current state first, so a wrong choice is recoverable.

### Off-site copy

The volume lives on the same disk as the database. Sync it somewhere else nightly:

```bash
0 4 * * * docker run --rm -v reset_backups:/b -v /root/.aws:/root/.aws:ro \
  amazon/aws-cli s3 sync /b s3://reset-backups/ --storage-class STANDARD_IA
```

A backup on the same disk survives a bad migration. It does not survive the disk.

## Updating

```bash
# Pin the new tag in .env.prod, then:
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod pull
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod \
  run --rm api npx prisma migrate deploy
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d
```

Migrations run **before** the new containers start. A container serving traffic against a
schema it does not expect fails in ways that are hard to read.

Rolling back means pinning the previous tag and running `up -d` again — which is why
`.env.prod` pins versions rather than using `latest`.

## Health

| Check | Command |
|---|---|
| Liveness | `curl https://api.reset.app/api/v1/health` |
| Readiness (checks Postgres) | `curl https://api.reset.app/api/v1/health/ready` |
| Container status | `docker compose -f infra/docker-compose.prod.yml ps` |
| API logs | `docker compose -f infra/docker-compose.prod.yml logs -f api` |
| Backup logs | `docker compose -f infra/docker-compose.prod.yml logs backup` |

## Before going live

- [ ] DNS resolves for all three domains
- [ ] `.env.prod` is `chmod 600`, with three *different* JWT secrets
- [ ] `FIREBASE_PROJECT_ID` set — the API will not boot without it
- [ ] **Play app-signing SHA-1 added to Firebase** — the fingerprint real installs carry.
      Sign-in works in testing and fails for every real user until this is done
- [ ] Firebase API key restricted to the app's package + SHA-1 in Google Cloud console
- [ ] **Restore rehearsal passed**
- [ ] Off-site backup sync running
- [ ] First OWNER account created, default passwords nowhere
- [ ] A real booking made, confirmed and scanned in at the counter — the payments-off
      equivalent of the ₹1 payment gate
- [ ] Admin panel IP allowlist decided (see the commented block in the Caddyfile)
- [ ] No-show policy agreed — a booking currently costs nothing to make or break
