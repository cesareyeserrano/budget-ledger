# Ledger (T-Ledger)

A web app for **personal finances against a budget**. You plan each category month by month, record
what you actually spend and earn, set money aside in savings pockets, and see how every month closes.
It is multi-user with sign-in, and **Postgres is the single source of truth**. One responsive app: on
a small screen it shows **only the register** (record a movement); on a desktop, the full app (the
budget grid, the Balance and the dashboard). The user interface is in Spanish.

Main capabilities: a hierarchical budget grid (group › category › subcategory) with planned vs.
actual per month; a cell detail that lists the movements behind each actual value; reserves
(savings pockets) with contributions and withdrawals; month closing and reopening; multi-year
ranges; and optional **pay cycles** (e.g. the 21st to the 20th) instead of calendar months.

Built following the Aitri SDLC pipeline (requirements → UX →
architecture → tests → implementation → verification). The artifacts live in `aitri/product/spec/`
and, per feature, in `aitri/features/<name>/`.

## Running it

Local development needs Node.js 22 and Docker. Full details are in [DEV_ENV.md](DEV_ENV.md).

```bash
npm install
cp .env.example .env.local   # set BETTER_AUTH_SECRET (openssl rand -base64 32)
npm run db:up                # Postgres + DB viewer in Docker
npm run db:migrate           # apply the migrations
npm run dev                  # http://localhost:3100
```

Tests:

```bash
npm run test                 # unit + integration (Vitest)
npm run test:e2e             # end-to-end (Playwright, against an ephemeral Postgres)
npm run typecheck && npm run lint
./smoke.sh                   # boots the app and checks that its main routes respond
```

Production runs as a Docker container behind Nginx, with Postgres in the same Compose project. See
[DEPLOYMENT.md](DEPLOYMENT.md).

---

## Technical decisions (the *why*, not just the *how*)

### 1. Pure TypeScript domain core (`src/domain/`)
All business logic — roll-ups, reserves, month closing, cycles, movement adjustments, tree
operations — is **pure functions with no React, DOM or database**. They take a state and return a
new state. Reason: this is the part with the highest value and risk (data integrity), and isolating
it makes it **deterministically testable** without mounting the UI or a database. The UI and the
server are projections of the domain, not its owners.

### 2. Roll-ups are **derived**, never stored
The total of a parent node (category, group, type) is **computed** from its leaves (planned = sum
of the leaves; actual = sum of the subtree). It is never persisted. Reason: the invariant
"parent == sum of its children" **cannot drift** by construction, which removes a whole class of
bugs. The grid computes all roll-ups in a single pass per change and caches the result.

### 3. The server is the source of truth
The client talks to `/api/v1` through a repository interface (`src/data/`); the store never talks
to storage directly. The server validates every write with the same domain rules the client uses
(`src/server/`), so a stale or modified client cannot corrupt a ledger. Every row carries an
`ownerId`, and every route filters by the signed-in user.

### 4. Validation at every trust boundary
Everything that crosses a boundary — API request bodies and environment variables — goes through
**Zod** schemas. Invalid input is rejected with an explicit error, never trusted.

### 5. State with Zustand and derived selectors
Editing a grid cell must update its ancestors without re-rendering the whole grid (performance
budget: ≤150 ms per edit). Zustand allows granular subscriptions; React Context would propagate to
every consumer.

### 6. A structure-only seed
A new account starts with a default category tree and **no amounts**: the first-run card asks for
the opening balance and the user fills in their own numbers (user decision, 2026-09-07: no sample
amounts, only the structure).

### 7. Deliberate divergences from the original prototype
The prototype is the **visual** source of truth (design tokens, layout). The **business rules** are
set by the approved requirements and depart from the prototype on purpose: no proportional
distribution (you edit leaves), deleting moves amounts to an "Unassigned" category per type, the
phone shows only the register, and nodes are reparented by drag and drop. See
`aitri/product/spec/01_UX_SPEC.md`.

---

## Stack
Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Zustand · Zod · Better Auth ·
PostgreSQL 16 with Drizzle ORM · @dnd-kit · Recharts · lucide-react.
Tests: Vitest (unit and integration, Testcontainers for Postgres) and Playwright (end-to-end).

## Structure
```
src/domain/      pure core (types, tree, rollup, reserve, closure, cycles, adjust, mutations, validation)
src/data/        client-side repository and live sync against /api/v1
src/state/       Zustand store
src/server/      auth, sessions, rate limiting, env, API schemas, Postgres access (data/, db/), mail
src/app/         pages, layout, design tokens (globals.css), /api/v1 routes, /health
src/components/  grid, Balance, dashboard, register, cell detail, settings
drizzle/         SQL migrations (applied with scripts/migrate.mjs)
tests/           domain/ · unit/ · integration/ (Vitest) · e2e/ · e2e-backend/ (Playwright)
scripts/         quality gates, migrations, password reset, production verification
```

## License
MIT — see [LICENSE](LICENSE).
