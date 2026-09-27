# Local development environment

The app always runs in server mode: Postgres is the single source of truth and every user signs in.
Locally you run Postgres (plus an optional DB viewer and a mail catcher) in Docker, and the Next.js
dev server on your machine against it. This is a **development** environment, not production: it
uses fixed development credentials.

## First run

```bash
npm install
cp .env.example .env.local        # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
npm run db:up                     # Postgres + pgweb in Docker (loopback only)
npm run db:migrate                # apply the migrations in drizzle/
npm run dev                       # http://localhost:3100 (hot reload)
```

The first account you register gets its own ledger, persisted in Postgres. Data survives restarts
because it lives in the named volume `ledger_devdata`.

## Start / stop

```bash
npm run db:up        # start Postgres and the DB viewer
npm run mail:up      # optional: Mailpit, for the password-recovery emails
npm run db:down      # stop everything (DATA is kept in the ledger_devdata volume)

# stop and DELETE the data (clean start; run db:migrate again afterwards)
docker compose -f docker-compose.dev.yml down -v
```

Run `npm run db:migrate` again after pulling code that adds a migration: the dev server uses the new
code immediately, and an unapplied migration shows up as an empty or broken app.

## Access

| What | Where |
|---|---|
| **App** (`npm run dev`) | http://localhost:3100 |
| **DB viewer** | http://localhost:8081 (pgweb — connects automatically, no login) |
| **Postgres** | `localhost:5432` · user/pass/db = `ledger` / `ledger` / `ledger` |
| **DB URL** | `postgres://ledger:ledger@localhost:5432/ledger` |
| **Mailpit** (`npm run mail:up`) | SMTP `localhost:1025` · inbox http://localhost:8025 |
| **Health** | http://localhost:3100/health → `{"status":"ok"}` |

Postgres, pgweb and Mailpit are bound to `127.0.0.1` only, so they are not reachable from the local
network.

## Inspecting the database

```bash
# Option A — pgweb (starts with db:up, connects automatically)
#   → open http://localhost:8081

# Option B — Drizzle Studio (visual web viewer, run separately)
DATABASE_URL="postgres://ledger:ledger@localhost:5432/ledger" npx drizzle-kit studio
#   → open https://local.drizzle.studio

# Option C — psql
docker exec -it ledger-dev-db psql -U ledger      # \dt, SELECT * FROM movement; ...

# Option D — your own GUI (TablePlus/DBeaver/pgAdmin) with the connection data above
```

## Notes

- **Ports:** the app uses 3100 and Postgres 5432. If something else already uses them, stop it or
  change the `ports:` in `docker-compose.dev.yml`.
- **API calls from scripts** must send an `Origin` header matching the app
  (`Origin: http://localhost:3100`); without it the API answers 403, starting with the login.
- **Google OAuth** is disabled without credentials (the button shows as disabled). To try it, set
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env.local` and `NEXT_PUBLIC_GOOGLE_ENABLED=true`.
- **Password recovery by email** needs the five `SMTP_*` variables. Point them at Mailpit
  (`localhost:1025`) and the emails stay in its inbox without leaving your machine.
- **The `app` service of `docker-compose.dev.yml`** runs a production build of the app in Docker
  (http://localhost:3100, no hot reload). It does **not** apply migrations, so run
  `npm run db:migrate` first. Like the other services it listens on `127.0.0.1` only.
- **Testing from a phone** on the same network: `npm run dev:lan` serves the dev app on all
  interfaces. It is an explicit choice; stop it when you are done.
- **Production** uses `docker-compose.yml` (real secrets from the environment, no development
  defaults). See `DEPLOYMENT.md`.
