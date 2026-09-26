# Security Policy

Ledger (T-Ledger) is a personal-finance web app. The repository is public, but the data in any
deployment is private by definition, so vulnerabilities are taken seriously.

## Supported versions

| Version       | Supported |
| ------------- | --------- |
| 0.0.1-beta    | ✅        |
| < 0.0.1-beta  | ❌        |

The project is in beta: only the latest version receives security fixes.

## Reporting a vulnerability

**Do not open a public issue.** Issues are visible to everyone and would expose the flaw before a
fix exists.

Use **GitHub Security Advisories**: the **Security → Report a vulnerability** tab of this
repository. The report stays private between you and the maintainer, and the fix and the CVE can be
coordinated in the same thread.

Include, as far as possible: affected version, reproduction steps, expected impact and any PoC. A
reproducible report gets fixed much faster.

### What to expect

- **Acknowledgement:** within 72 hours.
- **Initial assessment** (severity and whether it is accepted): within 7 days.
- **Fix:** critical and high vulnerabilities take priority over any other work; the rest follow the
  normal pipeline cycle.
- You will be credited in the advisory unless you prefer to stay anonymous.

## Scope

**In scope:** the application code (`src/`), the authentication and session layer, the API, the
database queries, the `Dockerfile` and the CI workflows.

**Out of scope:** vulnerabilities that require physical or administrator access to the machine
running the app; `docker-compose.dev.yml` and the `Dockerfile` values marked as placeholders — they
are throwaway development/build credentials (`dev-secret-not-for-production`,
`build-time-placeholder`), never production values; automated scanner output without a
demonstrated impact.

## Secret handling

This repository **does not contain and has never contained real secrets**. Sensitive configuration
is injected through environment variables (`.env.local` locally, ignored by git; runtime
environment variables in production). `.env.example` documents the required keys, always with empty
values or placeholders.

Three controls back this up:

- **`.gitignore`** covers `.env`, `.env.local` and `.env.*.local`.
- **`scripts/secret-scan.sh`** runs in CI on every pull request and on every push to `main`, and
  fails the build on a hardcoded secret. It uses gitleaks when available and a pattern-based
  fallback otherwise (the CI runner currently uses the fallback).
- **GitHub secret scanning and push protection** are enabled: GitHub blocks a push that contains a
  credential from a known provider.

If you find a real secret leaked in the history, report it through the channel above **before**
opening anything public.
