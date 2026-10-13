# Agent API — `/api/agent/v1`

A small, separate door into T-Ledger for an **agent**: a program, with no browser, that reads the
ledger and records movements on behalf of the account owner. It is not the browser API (`/api/v1`):
it has its own authentication, its own seven operations, and nothing else.

Everything the agent writes goes through the same domain functions and the same server-side rules
as a movement registered by hand in the app. The agent and the screen cannot give two different
answers to the same question.

All examples below use invented data.

## Enabling it

The door is **off by default**. With it off, every route under `/api/agent/v1` answers `404`.

| Variable | Meaning |
|---|---|
| `LEDGER_AGENT_API` | Only the exact value `on` enables the door. Anything else, or absent, keeps it off. |
| `LEDGER_AGENT_SOURCES` | Internal sources, **besides loopback**, the door serves. Comma-separated IPv4 addresses or IPv4 CIDR blocks, e.g. the subnet of the Docker network the app shares with the agent. An invalid entry aborts start-up. |

The door only serves requests that arrive **directly** — from the machine itself or from a declared
internal network. A request that came through the public front (`tailscale serve`, Nginx) carries
the real client's address in `X-Forwarded-For` and gets `404`, with or without a valid token. See
`DEPLOYMENT.md`, "Agent door".

## Tokens

An agent identifies itself with a token that belongs to one account. Tokens are created, listed and
revoked **only from a terminal on the server** — there is no HTTP route that does it, so a stolen
browser session cannot mint one.

```bash
# inside the app container (or anywhere with DATABASE_URL set)
node scripts/agent-token.mjs create <account-email> "<name>"   # prints the token ONCE
node scripts/agent-token.mjs list   <account-email>            # id, name, created, last used, state
node scripts/agent-token.mjs revoke <token-id>                 # effective on the next request
```

- The token is shown once. Only its SHA-256 hash is stored: if it is lost, revoke it and create another.
- The **name** is what the app shows next to every movement the token records. Up to 60 characters.
- The token id (`agt_…`) is not a secret: it is what gets listed, logged and revoked.
- Store the token where only the agent's deterministic helper can read it. Never in a repository,
  and never in a prompt.

## Requests

```
Authorization: Bearer <token>
```

No cookie and no `Origin` header. The token is only accepted in that header — not in the query
string, not in the body. Request bodies are JSON, at most 16 KiB, and **strict**: an unknown field is
rejected. Every response is JSON with `Cache-Control: no-store`.

The account always comes from the token. No operation takes an owner id.

### Limits

Per token, in a 60-second sliding window: **30 writes** (`POST`, `PATCH`, `DELETE`) and **120 reads**
(`GET`). Beyond that the answer is `429` with `Retry-After: 60`. Requests with an invalid token are
limited too (20 per 60 s).

## The movement object

```json
{
  "id": "m_8f2k1",
  "type": "expense",
  "target": "s-groceries",
  "targetName": "Groceries",
  "amount": 50000,
  "period": "2026-10",
  "date": "2026-10-10",
  "note": "Corner shop",
  "from": null,
  "to": null,
  "ref": "L300",
  "agent": { "id": "agt_example", "name": "Agent-L" }
}
```

- `type`: `expense`, `income` or `transfer` (a pocket operation).
- `target`: the leaf affected. For a pocket operation it is the pocket.
- `from` / `to`: only for `transfer` — a pocket id or `"@disponible"` (the available balance).
- `ref` and `agent`: `null` for a movement the owner registered by hand.
- `amount` is always an integer, in the account's currency unit.

## Operations

### 1. `GET /tree` — the account's tree

The agent has **no catalogue of its own**: it classifies against this tree, and it cannot change it.

```json
{
  "revision": 412,
  "nodes": [
    { "id": "c-food", "name": "Food", "type": "expense", "level": "category", "parentId": "g-living", "leaf": false },
    { "id": "s-groceries", "name": "Groceries", "type": "expense", "level": "sub", "parentId": "c-food", "leaf": true },
    { "id": "s-trip", "name": "Trip", "type": "transfer", "level": "sub", "parentId": "c-goals", "leaf": true }
  ]
}
```

A movement can only be recorded on a node with `"leaf": true`. Nodes of type `transfer` are pockets.
If no node fits, the agent must not invent one: it keeps the movement pending on its side and asks
the owner to create the category in the app.

### 2. `GET /movements` — movements of a period, or one by reference

| Query | Meaning |
|---|---|
| `period=YYYY-MM` | Optional. Default: the current period of the account. |
| `node=<id>` | Optional. Only movements under that node (a leaf, a category or a group). |
| `ref=<ref>` | Returns the single movement with that origin reference. Excludes the other two. |

```json
{ "period": "2026-10", "movements": [ { "id": "m_8f2k1", "…": "…" } ] }
```

With `ref`: `{ "movement": { … } }`.

### 3. `POST /movements` — record a movement

An expense or an income:

```json
{ "type": "expense", "target": "s-groceries", "amount": 50000, "date": "2026-10-10", "note": "Corner shop", "ref": "L300" }
```

A pocket operation — reserve, withdraw or move:

```json
{ "type": "transfer", "from": "@disponible", "to": "s-trip", "amount": 200000, "date": "2026-10-10", "ref": "L310" }
```

| From | To | Meaning |
|---|---|---|
| `@disponible` | a pocket | **reserve** |
| a pocket | `@disponible` | **withdraw** |
| a pocket | another pocket | **move** |

- **The period is never sent.** The server derives it from `date` with the account's own calendar
  (calendar month, or pay cycle). A movement always lands in the period of its date.
- `date`: `YYYY-MM-DD` (a time, `YYYY-MM-DDTHH:mm`, is accepted too).
- `note`: optional, up to 280 characters.
- `ref`: **required**, 1–128 characters, opaque. See below.

Answers: `201` with `{ "movement": …, "revision": n }` when created.

#### The origin reference makes the call idempotent

`ref` is the agent's own identifier for what it is recording — its sequence number, or the bank's
transaction id plus the account. It is unique per account among the movements that exist.

| Situation | Answer |
|---|---|
| No movement has that `ref` | `201`, created |
| A movement has that `ref` and the same type, leaf (or `from`/`to`), amount and date | `200` with the existing movement. Nothing is written. The note is not compared. |
| A movement has that `ref` with different content | `409 reference_conflict`, with the existing movement in `error.detail.movement` |

So a retry after a network error is safe: send the same body again. Two simultaneous requests with
the same `ref` leave one movement. Undoing a movement frees its `ref`.

### 4. `PATCH /movements/{key}` — correct an expense or an income

`{key}` is the movement id, or `ref:` followed by the URL-encoded reference (`/movements/ref:L300`).

```json
{ "amount": 45000 }
```

At least one of `amount`, `date`, `note`, `target`. Nothing else: the period and the reference cannot
be changed. Answers `200` with `{ "movement": …, "revision": n }`.

- **Only movements recorded by an agent.** A movement the owner registered by hand answers `404`.
- A pocket operation cannot be corrected (`422 unsupported_type`): undo it and record it again.
- A movement can only be moved to a period that already has data in the ledger.

### 5. `DELETE /movements/{key}` — undo a movement

Removes a movement recorded by an agent, including pocket operations.

```
DELETE /api/agent/v1/movements/ref:L300
```

```json
{ "revision": 413 }
```

The rules still apply: undoing a reserve whose money was already withdrawn is
rejected (`domain_rule_violation`, rule `piso`), and if the owner already lowered that pocket's cell
in the app the answer is `422 cell_already_changed` — there is nothing left to subtract.

### 6. `GET /summary` — the figures of a period

`?period=YYYY-MM`, optional (default: the current period).

```json
{
  "period": "2026-10", "mode": "cycle", "start": "2026-09-21", "end": "2026-10-20", "closed": false,
  "revision": 412,
  "nodes": [
    { "id": "s-groceries", "name": "Groceries", "type": "expense", "level": "sub", "parentId": "c-food",
      "budget": 800000, "actual": 320000, "remaining": 480000 }
  ],
  "totals": {
    "income":  { "budget": 0, "actual": 3000000 },
    "expense": { "budget": 1000000, "actual": 570000, "remaining": 430000 }
  },
  "balance": { "available": 2230000, "reserved": 950000 },
  "pockets": [ { "id": "s-trip", "name": "Trip", "contributed": 200000, "balance": 950000 } ]
}
```

What each figure means — the same definitions the app uses:

| Figure | Meaning |
|---|---|
| `budget` | **Presupuestado**: what was planned for that node in the period. A parent is the sum of its leaves. |
| `actual` | **Ejecutado**: what was actually recorded in the period. A parent is the sum of everything under it. |
| `remaining` | `budget − actual`. Negative means the node went over its plan. |
| `totals.income` / `totals.expense` | The same, for all income and all expenses of the period. |
| `balance.available` | **Disponible**: what can be spent. Carried from period to period: what was available before, plus income, minus expenses, minus what was reserved net of withdrawals. |
| `balance.reserved` | **Saldo reservado**: everything set aside in pockets, accumulated. |
| `pockets[].contributed` | What was put into that pocket **in this period**. |
| `pockets[].balance` | **Saldo de bolsillo**: what that pocket holds in total — contributions minus withdrawals up to this period. |

A valid period with no data answers `200` with zeros.

### 7. `GET /period` — the period of a date

`?date=YYYY-MM-DD`, required.

```json
{ "period": "2026-10", "mode": "cycle", "start": "2026-09-21", "end": "2026-10-20", "closed": false }
```

`mode` is `month` or `cycle`. Use it instead of computing the pay cycle on the agent's side, and to
know beforehand that a period is closed.

## Errors

```json
{ "error": { "code": "invalid_target", "message": "…", "detail": { } } }
```

A rejected write changes nothing: no movement, no cell, no revision.

| Code | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | No token, malformed, unknown or revoked. The same answer in all four cases. |
| `not_found` | 404 | The door is off; the request came through a proxy; the account has no ledger yet; the movement, reference or node does not exist **in this account**; or the movement was registered by hand. |
| `rate_limited` | 429 | The token's limit for the window was reached. `Retry-After: 60`. |
| `payload_too_large` | 413 | Body over 16 KiB. |
| `invalid_payload` | 422 | The body does not validate: unknown field, wrong type, amount not a positive integer, impossible date, note or reference too long. |
| `invalid_target` | 422 | The leaf does not exist, is not a leaf, or is not of the movement's type; or the `from`/`to` of a pocket operation are not valid. |
| `invalid_period` | 400 | `period` is not `YYYY-MM`. |
| `invalid_date` | 400 | `date` is missing or malformed, or no period of the ledger contains it. |
| `closed_period_violation` | 422 | The movement's period is closed. |
| `domain_rule_violation` | 422 | A pocket rule would be broken. `error.detail.violations` lists `{ rule, period, leafId?, limit }`: `techo` (more than the period allows; `limit` is the most that fits), `piso` (more than the pocket holds; `limit` is what it holds), `deficit` (later periods already used that money). |
| `reference_conflict` | 409 | The `ref` already recorded a different movement. |
| `unsupported_type` | 422 | Trying to correct a pocket operation. |
| `negative_cell` | 422 | The change would leave a cell below zero. |
| `cell_movement_mismatch` | 422 | The change would leave a cell different from the sum of its movements. |
| `cell_already_changed` | 422 | Undoing a reserve whose cell the owner already lowered in the app. |
| `internal_error` | 500 | Unexpected failure. Nothing was written; retry with the same `ref`. |

## What the agent cannot do

By construction — these operations do not exist under `/api/agent/v1`:

- create, rename, move or delete categories, groups or pockets;
- close or reopen periods, or change the cycle configuration, the opening balance or the budget;
- save the whole ledger, or read or touch another account;
- correct or undo a movement the owner registered by hand;
- create, list or revoke tokens.

A token is also useless against the browser API: `/api/v1` answers `401` to it.

## Traceability in the app

Every movement an agent records shows a label with the token's name in the cell detail (desktop) and
in the category screen (phone). The owner can edit or delete it from the app like any other; the
label stays with the movement and the browser cannot forge, change or remove it.

Each request leaves one log line on the server with the token id — never the token, the note or the
amount:

```
[2026-10-10T15:04:05.000Z] POST /api/agent/v1/movements 201 (18ms) rid=00a1 agent=agt_example
```
