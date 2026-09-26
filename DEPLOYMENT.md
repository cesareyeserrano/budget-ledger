# Deployment — Ledger (T-Ledger)

A Next.js 15 web app with **Postgres 16 as the single source of truth**, multi-user with sign-in. It
ships as a **Docker container** next to a Postgres container (one Compose project). In the current
deployment it runs on Ultron (a Raspberry Pi 5, 8 GB) and is published **only on the owner's
Tailscale network** with `tailscale serve`, which also terminates TLS. The same image is portable to
any Docker host.

## Requirements
- Docker and Docker Compose on the host.
- Something in front of the app that terminates TLS: `tailscale serve` today, or a reverse proxy.
  The session cookies are `Secure`, so sign-in only works over HTTPS.

## Components
- **app**: the Next.js server (Node 22, standalone output) in a container, listening on port 3000,
  published on the host at `127.0.0.1:3000` only.
- **db**: PostgreSQL 16 (`postgres:16-alpine`) with the named volume `pgdata`. It is **not**
  published on the host; only the app reaches it, through the Compose network.
- **TLS front**: `tailscale serve` forwards `https://<machine>.<tailnet>.ts.net:<port>` to
  `http://127.0.0.1:3000`.

## Configuration (12-factor, all through the environment)

Put the values in a `.env` file next to `docker-compose.yml` on the host (never commit it). See
`.env.example` for every key.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres URL; the host is `db` (the Compose service name). |
| `BETTER_AUTH_SECRET` | yes | Session secret: `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | The public origin of the app (the Tailscale HTTPS URL). |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes | Used by the `db` container to create itself; must match `DATABASE_URL`. |
| `LEDGER_TAG` | no | Image tag to run (default `latest`). Used for rollbacks. |
| `LEDGER_ALLOWED_ORIGINS` | no | Extra CORS origins, comma-separated. Default: only `BETTER_AUTH_URL`. Never `*`. |
| `LEDGER_TRUST_PROXY` | no | Default `false`. See below before changing it. |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `SMTP_FROM` | no | Password recovery by email. All five or none. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `NEXT_PUBLIC_GOOGLE_ENABLED` | no | Google sign-in. Disabled by default. |

`docker-compose.yml` refuses to start if `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`POSTGRES_USER` or `POSTGRES_PASSWORD` is missing, naming the variable. The app also validates its
environment with Zod (`src/server/env.ts`) the first time it needs it.

**Test-only variables — never in production:** `LEDGER_TEST_OVERRIDES`, `LEDGER_TODAY`, `LEDGER_NOW`,
`LEDGER_TEST_FAIL_AFTER` and `LEDGER_RATE_LIMIT_DISABLED`. The production Compose file does not
forward them, and the `security-config` gate fails if it ever does. `LEDGER_RATE_LIMIT_DISABLED` has
no effect without `LEDGER_TEST_OVERRIDES=1`, and the server logs a warning at start-up if it is set.

### `LEDGER_TRUST_PROXY` — decides whether the login brute-force limit works

The rate limit on `/sign-in/email` (5 attempts per 60 s) groups requests by IP. This variable
decides where that IP comes from, and it is a security decision, not a convenience:

- **`false` (default)** — the IP of the TCP connection. The client cannot choose it, so the limit
  always limits. With `tailscale serve` in front, every request arrives from `127.0.0.1`, so all
  clients share one bucket: the limit still stops brute force, but five failed attempts from anyone
  on the tailnet also block the owner for a minute.
- **`true`** — the IP is read from `X-Forwarded-For`. Use it **only** behind a proxy that
  **replaces** that header (for Nginx: `proxy_set_header X-Forwarded-For $remote_addr;`).

Setting it to `true` without such a proxy — or behind one that **appends** to the header — turns the
brute-force protection off: an attacker sends their own `X-Forwarded-For` and rotates it on every
attempt, getting a fresh bucket each time. Nothing in the logs would show it. Do not enable it behind
`tailscale serve` until you have confirmed how it sets that header. When in doubt, keep `false`.

## Build and run

```bash
# on the host, in the project folder (~/apps/budget-ledger on Ultron)
docker compose up -d --build     # build the image and start db + app
docker compose ps                # both services should become "healthy"
docker compose logs -f app
```

The app does **not** apply migrations on start-up. For a first install or any release that adds a
migration, follow **Deploying a new version** below.

Publish it on the tailnet (once):

```bash
tailscale serve --bg --https=<port> http://127.0.0.1:3000
```

## Health check
- `GET /health` answers `200 {"status":"ok"}` without authentication.
- The container's `HEALTHCHECK` targets `/health`, **not `/`**: the root redirects to sign-in, so a
  200 there would not prove the app is healthy.
- Quick check after a deploy:
  ```bash
  curl -s https://<host>/health                                           # {"status":"ok"}
  curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/v1/ledger  # 401 without a session
  ```

## Deploying a new version — production data is always preserved

The user data lives in the `pgdata` volume, never in the image. A deploy replaces the image and,
when needed, moves the schema **forward**; it never recreates the database. These rules keep it
that way:

1. **Back up first, every time.** `pg_dump` right before touching anything (step 1 below). It is
   the only way back if a migration goes wrong, and it enables the "no amount changed" check.
2. **Never delete volumes.** Never run `docker compose down -v`, `docker volume rm` or
   `docker volume prune` on the production host: that deletes the database.
3. **Migrations are forward-only and additive by default.** Each one is registered in
   `drizzle/meta/_journal.json` and applied once, inside a transaction. A migration that rewrites or
   deletes user data must reconcile the existing data, not drop it, and must say so in its feature's
   `DEPLOYMENT.md`.
4. **Migrate with the NEW image.** The migrations travel inside the image. Running them with the
   old one applies nothing and reports success (it happened on 2026-09-23).
5. **Verify against production afterwards** with `scripts/verificar-prod.sh` and the backup: it
   fails loudly if any stored amount changed.

```bash
cd ~/apps/budget-ledger
git pull                                           # the commit you are deploying
export LEDGER_TAG=$(git rev-parse --short HEAD)    # keep the previous image for rollback

# 1. Backup
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > ~/backup-$(date +%F-%H%M).sql
# 2. Build the new image
docker compose build app
# 3. Apply pending migrations WITH THE NEW IMAGE (transactional, idempotent)
docker compose run --rm app node scripts/migrate.mjs
# 4. Start the new code
docker compose up -d
# 5. Verify (mandatory)
scripts/verificar-prod.sh ~/backup-<date>.sql
```

**Trap that already bit once:** `migrate.mjs` applies what is listed in
`drizzle/meta/_journal.json`. A `.sql` file in the folder but **missing from the journal** is
ignored **silently** and the command still says the migrations were applied. Check 3 of
`verificar-prod.sh` catches it.

### Post-deploy verification (mandatory)

The project's `smoke` gate boots the app in a local test environment; it never touches production.
So the last step of every deploy is:

```bash
ssh ultron 'cd ~/apps/budget-ledger && scripts/verificar-prod.sh ~/backup-<date>.sql'
```

It checks, and fails loudly if anything is off: (1) `/health` answers; (2) the running image is the
deployed commit, and that commit is the one on the remote branch; (3) the number of applied
migrations equals the number of journal entries; (4) zero cells whose value differs from the sum of
their movements; (5) zero movements whose period does not match their date; (6) given a backup, that
**no** amount in `amount_cell` changed. For check 6 it writes two temporary copies of the amounts to
a private directory (`umask 077`) and deletes them on exit.

### Migrations and their ordering constraints

Each feature states in `aitri/features/<name>/DEPLOYMENT.md` whether its migration imposes an order:

- `0002`/`0003` (**multi-anio**): STRICT order. Between migrating and deploying, the old app cannot
  read the database (the `month` column disappears). No way back, on purpose.
- `0004` (**cierre-de-mes**): purely additive, no required order.
- `0007`/`0008` (**ciclos**): additive; migrate BEFORE starting the new image, which queries the two
  new tables. The old code works on the migrated database as long as nobody activated cycles.
- `0009` (**diario-de-celda**): additive; migrate before the new image. See the rollback exception.
- `0010` (**fecha-de-comentario**): additive and idempotent; migrate before the new image.
- `0011` (reconcile old cells, BG-043): adds one `adjustment` movement per legacy cell whose value
  did not match its movements. It does **not** change any amount: every cell keeps its value.

## Rollback

There are **two** things that can go back, and they do not cost the same.

### 1. The code — go back to the previous image

The normal case, and **no data is lost**. Images are immutable and tagged by commit:

```bash
export LEDGER_TAG=<previous-tag>
docker compose up -d app
```

If the failed deploy **did not change the database schema**, you are done.

> **Exception — once `diario-de-celda` is deployed, going back to an older image may not be enough.**
> That feature introduced the **adjustment**, the only movement that can have a **negative** amount
> (created when a cell is set to a total lower than the sum of its movements). Code from before it
> rejects negative amounts **when reading** the ledger, so an older image facing a database with even
> one negative adjustment rejects that user's whole ledger. Check before deciding:
>
> ```bash
> docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
>   -c "SELECT count(*) FROM movement WHERE kind = 'adjustment' AND amount < 0;"
> ```
>
> `0` → the older image can still read the database. `> 0` → a code-only rollback does **not** work;
> go to step 2.

> **Note — once `fecha-de-comentario` is deployed, going back loses the comment dates.** Migration
> `0010` adds `cell_note.date`. An older image ignores it when reading and does start, but its first
> save rewrites the ledger without that column: comments written after the deploy keep their text
> and lose their date.

### 2. The database — restore the backup

Only if the database is really damaged. **Restoring takes the database back to the moment of the
backup: everything written afterwards is lost.** That is why the backup is taken right before the
deploy, to keep that window as short as possible.

```bash
docker compose stop app
cat ~/backup-<date>.sql | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose start app
```

### The schema does not go back

A schema change (a column, a table, an index) is **not** reverted: it is fixed with a new forward
migration. Drizzle does not generate down migrations, and hand-writing SQL in the middle of an
incident is the worst moment to do it. Restoring the backup is the only real way back for the
schema, with the data loss described above.

**Rule of thumb:** go back to the previous image first. Touch the backup only if the database is
broken, knowing what it costs.

## Recovering access

### From a terminal (the current way)

**Decision of 2026-08-27:** password recovery for this deployment is done over SSH, not by email.
The script runs with Node.js from the project folder on the host (dependencies installed):

```bash
DATABASE_URL=postgres://... npm run user:reset-password -- <email>
# generates a random password and prints it. With your own:
DATABASE_URL=postgres://... npm run user:reset-password -- <email> "<new-password>"
```

It invalidates **all** sessions of that account, like the email flow does: access obtained before
the change does not survive it. Limitation accepted: only someone with access to the machine can
use it.

### By email (dormant)

The email flow is built and verified (feature `recuperar-acceso`), but sending real mail needs an
external relay, and without an own domain no option avoids the spam folder. Without the `SMTP_*`
variables the endpoint answers `503` and the screen says so; configuring them enables it.

- All five or none: a partial configuration counts as not configured.
- `SMTP_PASSWORD` must be an **app password**, never the mailbox password.
- None of them has the `NEXT_PUBLIC_` prefix: they are server credentials, and the `security-config`
  gate fails if one reaches the browser bundle.
- Port `465` uses implicit TLS; `587` and `1025` use STARTTLS or plain text (development).
- In development, `npm run mail:up` starts Mailpit (SMTP on `1025`, inbox on
  `http://localhost:8025`, both bound to loopback).

After configuring it, request a recovery for a real account and check the response: `200` = sent ·
`502` = the SMTP server does not answer (the log has the reason) · `503` = variables missing.

## Encryption

### In transit
All client↔server traffic goes over TLS, terminated by `tailscale serve` (Tailscale traffic is also
encrypted end to end between devices). The app sends HSTS. Financial data and credentials never
cross the network in clear text.

### At rest
- **Credentials:** hashed with **argon2id**, never stored in plain text.
- **Financial data:** the Postgres volume (`pgdata`) should sit on encrypted storage (LUKS on an own
  host, or the provider's encrypted storage). Without the volume key, a stolen disk or leaked copy
  does not reveal the data.
- **Backups:** encrypt `pg_dump` output (age/gpg) before it leaves the host.

## Session and HTTP security
Session cookies are `HttpOnly; Secure; SameSite`. Login is rate-limited (5 per 60 s per IP). The app
sends HSTS, `X-Content-Type-Options: nosniff` and a CSP with `frame-ancestors 'none'`. CORS is
restricted to `LEDGER_ALLOWED_ORIGINS` (never `*`). Every `/api/v1` route except the password
recovery request requires a session; the `security-config` gate enforces it.

## Branches
Three fixed branches, and no other long-lived ones:

| Branch | Role | How code gets in |
|---|---|---|
| `develop` | development | direct push |
| `staging` | testing / integration | PR from `develop` |
| `main` | production | PR from `staging`, with `build-and-test` and `security` green |

Merges use **merge commits only** (squash and rebase are disabled): four tests compare against
anchor commits, and rewriting history breaks them. The three branches are protected against
deletion and force push. Dependabot opens its PRs against `develop`.

Deploying to Ultron is manual today (the steps above). Deploying automatically on every merge to
`main` is planned as a separate feature; it must follow the same rules (backup, migrate with the new
image, verify).

## CI
`.github/workflows/ci.yml` runs on every push to `main`, on every PR to `main`, `staging` or
`develop`, and weekly. Job `build-and-test`: install → typecheck → lint → unit + integration tests →
build → E2E (Playwright, the app against an ephemeral Postgres) → backend E2E. Job `security`:
dependency audit (`npm audit`) and secret scan (`scripts/secret-scan.sh`). `codeql.yml` runs
GitHub CodeQL. Any failure fails the pipeline.
