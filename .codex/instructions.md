# AGENTS.md — Aitri Pipeline Rules

This project is managed with **Aitri** — an SDLC pipeline CLI.
All agents (Claude, Codex, Gemini, GitHub Copilot, etc.) must follow these rules.

For the full command surface and flags, run `aitri help`. This document covers the **rules** — what to run, when, and why — not every command's syntax.

**Project layout — THIS project's paths (rendered for its layout, use them literally):** seed brief `aitri/product/IDEA.md` · supporting assets `aitri/product/idea_context/` · artifacts `aitri/product/spec/` · features `aitri/features/<name>/` · narrative backlog `aitri/BACKLOG.md`. Aitri's briefings always print layout-correct paths too. Two similar names, two different things: `.aitri` (dotted file at the project root) is the STATE; an `aitri/` folder (if this project has one) is the CONTENT container.

**`archive/` is historical — never current intent.** When Phase 1 is approved, the seed brief (`IDEA.md` / a feature's `FEATURE_IDEA.md`) is absorbed into that pipeline's `01_REQUIREMENTS.json#original_brief` and the file MOVES to `archive/` inside its unit. Anything in an `archive/` folder is a historical record: do NOT read it as current intent, do not base requirements/design/code on it, and skip it during reviews (it only costs context) — the approved artifacts in `spec/` are the only current truth. Read an archived seed only when explicitly doing intent archaeology (e.g. `aitri audit requirements` work).

---

## Starting a session

Always run first:

```
aitri resume
```

This gives you the current pipeline state, open requirements, test coverage, pending bugs, drift status, and your next action.
Do not start working without it.

If `aitri resume` or `aitri status` reports a version mismatch (CLI version vs project's recorded version), run `aitri adopt --upgrade` first. If the upgrade offers the optional layout migration (`--layout`), do NOT run it yourself — moving the project's directories is the human's call, and the command blocks agents by design; surface the offer to the user instead. Gates depend on matching versions; trying to work around a mismatch corrupts state. `adopt --upgrade` also re-checks your already-approved artifacts against the current gates and lists any the evolved validators would now reject (advisory — your approvals are unchanged); re-derive each flagged phase (`run-phase → complete → approve`) before continuing.

---

## Starting a NEW project — capturing intent is the highest-leverage step

If there is no `.aitri` yet, run `aitri init`. It creates `aitri/product/IDEA.md` (the seed) + config. **The intent you capture here is the only unrecoverable input — everything downstream is faithful execution of it.** So before generating anything:

- **Read the provided context FIRST — and treat it as authoritative, not raw material to re-invent (ADR-065).** If the user pointed you at files, the `aitri/product/idea_context/` folder (root project) or `feature_context/` (a feature), a repo, mockups, or a prior doc/PRD, READ them and derive the problem/users/success from that material. Do not re-ask what a provided document already states — and do not re-DECIDE it: a precise definition the client provided (a business rule, a specific screen, a stated "must", a mockup's design) is the client's decision — carry it into the FRs/design faithfully, do NOT drop it, water it down, or replace it with your own preference. The `_context` folders exist so Aitri BUILDS what the client defined, not re-opens it. Where a provided definition is only partial or ambiguous, **ask to refine and align** before finalizing rather than guessing; you generate/decide (discovery, design, defaults) only for what the provided material leaves ABSENT or incomplete. (For greenfield projects with nothing provided, run `aitri wizard` for a guided interview, or write `aitri/product/IDEA.md` directly.)
- **Designated vs self-discovered context — this decides `confirmed` vs `assumed`.** Context the user *designated* (the `aitri/product/idea_context/` / `feature_context/` folder, or a path/file they pointed you to) may ground a `confirmed` provenance. Context you *found on your own* by scanning the project — a folder nobody told you to use — is `assumed` until you confirm its source with the user: it could be stale, a draft, or another project's material. Never treat a self-discovered folder as authoritative ground truth without confirming it first.
- **Source-capture advisory at `complete requirements`.** If `aitri/product/idea_context/` (or `feature_context/`) holds assets, `complete` lists them and asks you to confirm the FRs reflect them — Aitri cannot verify asset coverage mechanically. **Visual assets (mockups/Figma/PDFs) Aitri cannot read at all:** for each, either capture it as a UX-type FR (which triggers the UX phase) or state explicitly that it is out of scope. A listed asset with no corresponding FR is the single most common silent scope loss — treat the advisory as a real checklist, not noise. Assets left in a legacy `idea/` folder are NOT scanned; move them to `aitri/product/idea_context/`. Capturing the asset as a UX-type FR makes the UX phase write `01_UX_SPEC.md`, which is now reinjected at **Build** as the visual contract and turned into **design-fidelity test cases** at Phase 3 — so the design reaches the implementation and the gate, not just the requirements. When building a UI: open the referenced mockups and implement the spec's declared design (semantic color, affordances, interactions); the structural test cases do NOT guarantee visual fidelity, and tokens alone are not the design.
- **Confirm the three high-stakes inputs with the user — do NOT silently infer them:** the real problem, the success metric (measurable), and the no-go zones / out-of-scope. These are the inputs whose errors are unrecoverable. Mark anything you inferred as `[ASSUMPTION] …` so Phase 1's provenance gate tracks it.
- **Match the effort to the project (proportional).** A landing-page MVP needs a tight, honest pass — a clear problem, the user, one measurable success, the obvious out-of-scope — not a giant process. A complex system needs full context ingestion + elicitation. Don't manufacture ceremony for something small. Iterate agile: ship the MVP, then add capabilities as **features** (`aitri feature init <name>`), each its own proportional mini-pipeline.
- **Optional:** `aitri run-phase discovery` produces a structured, confirmed problem understanding (`00_DISCOVERY.md`) that Phase 1 reads — recommended for anything beyond trivial; it is where the context-ingest + confirm above is formalized. Add `--guided` to run a fixed problem-definition interview; in agent mode (no TTY) it prints the questions for YOU to put to the user, then the discovery briefing.

`aitri help` shows what each artifact maps to in industry terms (`01_REQUIREMENTS ≈ PRD/SRS`, `02_SYSTEM_DESIGN ≈ TRD/SDD`, …).

---

## During the pipeline

- Follow the next-action Aitri prints at the end of each command. When it is a **PIPELINE INSTRUCTION** (a single authoritative step — e.g. after `approve` or `verify`), do exactly that and nothing else. When the command offers a branch (e.g. `complete` → `approve` or `reject`; `status`/`resume` → `Next:`), take the step the situation calls for.
- Do not invent an action Aitri did not offer.
- Do not skip phases, re-open approved phases, or implement before Phase 4 is approved.
- **Phases are completed and approved in order.** Aitri hard-blocks `complete`/`approve` of a phase whose upstream was never validated — a feature cannot reach "5/5 complete & approved" on top of an unvalidated Phase 1 or UX. **Never suppress command output** (e.g. piping `complete`/`approve` to `/dev/null`): a gate rejection exits non-zero, and hiding it makes you build on a phase that never passed. Read every gate result.
- Do not write code during Phases 1, 2, 3. These are planning phases.
- **Optional subagent suggestions.** Some prompts (the build phase, code review, test design, audit) include an "Optional — …" block suggesting an independent adversarial subagent pass (told to *break* your work, not validate it: refute the code, sweep for missed edge cases, fan out by lens). These are suggestions, not gates: Aitri cannot run or verify them, and they consume extra tokens — you/the operator decide whether the change warrants it. **They are the single practice that most catches what "all tests pass" misses** (the worst defects live in untested paths); most worthwhile on anything with real blast-radius (logic, a gate, a schema, a new surface) or security-sensitive work — skip the trivial, accumulate small changes and review the batch.
- Optional phases (`discovery`, `ux`, `review`) only run when Aitri tells you to. Do not invoke them speculatively.
- **`approve` is a human-review checkpoint, not a rubber stamp.** Every `aitri approve <phase>` prints the artifact summary and the phase's Human Review checklist. Present these to the user and get their confirmation — do NOT chain `approve 1 → 2 → 3 → 4 → 5` autonomously. If the project sets `"humanApprovalGate": true` in `.aitri`, agent-mode `approve` is blocked and a human must run it (typical on larger projects; small projects / MVPs approve autonomously by default).
- **The Code Review phase verdict (`review`) is advisory by default.** A PASS/CONDITIONAL_PASS/FAIL verdict does not mechanically gate Phase 5 — surface it to the user and act on a FAIL; do not treat it as auto-blocking or auto-passing. A project can opt in by setting `"reviewGate": true` in `.aitri`, which makes a `FAIL` verdict in `04_CODE_REVIEW.md` **block** `aitri verify-complete` (CONDITIONAL_PASS/PASS still proceed; an absent review never blocks).
- **Seeding / Phase 1 — confirm ground-truth inputs, do not silently infer them.** The seed (IDEA.md → `01_REQUIREMENTS.json`) is the highest-value input in the pipeline; getting it from the user is your job, not guessing it. For the five Tier-A fields — problem, users, baseline, success_metric, no_go_zone — confirm each with the user; mark anything you inferred as assumed and record it in `idea_gaps`. On a fresh seed, `aitri complete 1` blocks if `idea_provenance` is missing or an `assumed` field is not carried in `idea_gaps`. Never label a field `confirmed` the user did not actually confirm. **It also requires a `coverage_map`** — list every distinct need you found in the seed, each mapped to the FR/NFR id that covers it or to `"out_of_scope"` (reason in `no_go_zone`). This is the *visible* record that nothing was silently dropped: a need missing from it is exactly the silent scope loss the pipeline exists to prevent. The gate only checks the list is internally consistent (real ids / out_of_scope), not that it is complete — completeness is caught by comparison, by you at `approve` and by the independent `aitri audit requirements` pass, which re-derives the needs and diffs them against your map. So do the decomposition honestly.
- **Phase 2 — the design must cover every MUST FR.** `aitri complete 2` surfaces (advisory) any MUST FR whose id is not referenced in `02_SYSTEM_DESIGN.md`, so a design that silently omits a requirement is caught at the cheap point. Reference each MUST FR by its id in the design and confirm the design actually addresses it — Aitri checks the id appears, not that it is fully designed.

---

## When verify-run fails or produces skipped tests

`aitri verify-run` writes `04_TEST_RESULTS.json` — **do not hand-write or edit that file.** `verify-run` (and `tc verify`) stamp a hash of the results they produce; `aitri verify-complete` rejects a results file that no longer matches, so editing it to turn failures into passes is blocked at the deploy gate. If tests fail or skip unexpectedly:

- Register the failure as a bug — accept the prompt that `verify-run` offers, or run `aitri bug add` manually.
- Fix the implementation, re-run `aitri verify-run`, then `aitri verify-complete` when the run is clean.
- Critical/high open bugs **block** `aitri verify-complete`, `aitri reconcile --resolve`, and the deploy gate. The next-action ladder will route you to bug work before anything else.
- **All TCs `skip` with passing tests?** Your runner likely writes results to a **file**, not parseable stdout (`.NET`/`dotnet test`, Java Maven/Gradle, pytest `--junitxml`). Point Aitri at the result file: `aitri verify-run --results <file-or-dir>` reads TRX and JUnit-XML. You must pass `--results` explicitly (Aitri does not hunt the tree for result files — a stray/stale one could credit a false pass); point it at the dir (e.g. `--results TestResults/`) and it reads the newest file the run wrote. Or name your test functions/methods after their TC id (`TC_006h…`) so the FQN maps back on stdout.

For tests that genuinely cannot be automated (manual QA, external systems): `aitri tc mark-manual <TC-ID>` sets the TC's `automation` field to `manual` so it can be verified by hand instead of by a runner. A manual TC counts as covered ONLY after you verify it with `aitri tc verify` — a seeded-but-unverified (pending) manual TC does NOT satisfy the FR/e2e coverage gate. If the runner already reported that TC as `fail` or `skip`, `mark-manual` requires `--reason` and records the prior verdict (`downgraded_from`) so a reviewer sees the downgrade — do not relabel a failing test to dodge the gate. When **every** Phase-3 TC is manual, the project has no automated runner by design — `complete build` then accepts a `04_BUILD_REPORT.json` with no `test_runner`/`test_files`. For that all-manual project, `aitri verify-run` does **not** spawn a runner (nothing to run): it seeds `04_TEST_RESULTS.json` with the manual TCs, then you record each with `aitri tc verify <TC-ID> --result pass|fail --notes "..."` (a human at a terminal can instead run bare `aitri tc verify` for a guided checklist that walks each pending manual TC). If an **automated** TC ran but Aitri still could not parse its result, record it against the evidence file instead of re-typing it manual: `aitri tc verify <TC-ID> --result pass|fail --notes "..." --evidence <path-to-result-file>` (if that file is a TRX/JUnit-XML, Aitri confirms it actually reports the TC with the result you claim, and rejects a mismatch). If the TC's prior runner verdict was `fail`/`skip`, the override stamps `downgraded_from` (the same audit trail `mark-manual` leaves) and warns — the override is visible to a reviewer, so never use `--evidence` to wave a genuine failure past the gate.

- **A regression NFR (`category: "Regression"`) is a hard MUST — even with no `priority` field.** When a change must NOT break an existing behavior, write it as an NFR with `category: "Regression"`. Aitri treats that as MUST regardless of priority: it needs the full happy/edge/negative test set at Phase 3 and a compliance entry at Phase 5, and a failing regression test blocks `verify-complete`. (Before, the gate keyed only on `priority: "MUST"`, so a regression NFR written without priority silently escaped every gate while looking documented.)
- **MUST-NFR skipped at the deploy gate (advisory).** If `verify-complete` warns that a MUST NFR reached the deploy gate with no passing test (its test(s) skipped, not failed), do NOT ignore it: a skipped regression NFR is untested. Confirm it is genuinely verified elsewhere (e.g. a separate perf/security suite) or un-skip its test and re-run `verify-run`. Aitri cannot tell a forgotten `test.skip` from an externally-tested NFR, so it surfaces rather than blocks — the judgment is yours.

**Test rigor signals (verify-run):**
- `aitri verify-run --coverage-threshold <N>` measures line coverage and flags it below `N`. Works across stacks (node, `go test`, `pytest`, `jest`/`vitest`) — the coverage tool must already be in the project's deps.
- `verify-run` flags **low-confidence TCs** (≤1 assertion — tests that may pass without verifying real behavior), and `aitri verify-complete` **also surfaces them at the deploy gate** (a reminder that green ≠ exercised, at the moment of deciding to ship). Both are advisory by default. A project can set `"strictAssertions": true` in `.aitri` to make `aitri verify-complete` **block** until each flagged TC has real assertions tied to its `expected_result`. Either way: add assertions that exercise the behavior (not constants / `assert.ok(true)`), then re-run `verify-run`.
- **Mutation gate (fake-pass protection).** A passing test can still be fake — mocks or weak assertions let code "pass" without exercising real behavior, the one thing Aitri can't detect from a green run. The only mechanical catch is mutation testing (break the real code, re-run the tests; a surviving mutant means a test never checked that code). Declare your stack's tool as a `quality_gate`: `{name:"mutation", command:"<stryker|pitest|mutmut|infection …>", required, timeout_ms:1800000}`, configured so it exits non-zero below its score threshold (Aitri gates by **exit code**, it does not parse the score). Mutation is slow — raise `timeout_ms` (default 300000 = 5 min) or it gets killed mid-run. No mutation tool for your stack → skip it; `verify-run` notes the absence once but never blocks.
- **Code-quality gates.** Declare your stack's lint/type-check/security commands in `04_BUILD_REPORT.json#quality_gates` (`[{ name, command, required }]`). `verify-run` runs each and gates on its exit code: a failing `required` gate (default) blocks `verify-complete` and flips `verifyPassed`, exactly like a failing test. Tests prove behavior; quality_gates prove the code is well-built. Declare only tools the project actually has configured; use `required: false` for advisory gates you are adopting gradually.
- **Smoke gate (the app actually runs).** Green tests prove the units behave — they do NOT prove the assembled product boots and serves. A suite can be fully green while the running app returns a server error on every entry point on first launch (bad config, broken bootstrap), because nothing in the test run started the real product. If your target serves requests (web app, HTTP API, service), declare a smoke `quality_gate` that boots the app and asserts its key entry points respond without server errors: `{name:"smoke", command:"<start the app, hit its key routes, fail on 5xx>", timeout_ms:120000}` (a startup-and-curl script, or the project's e2e/health-check runner). A library, CLI, or batch target has nothing to boot — skip it there (do not invent a server). `verify-run` notes the absence once for a UI target with no app-executing gate, but never blocks. **The `command` must be a single executable or script file (e.g. `./smoke.sh`)** — gates run WITHOUT a shell, so an inline `start && curl` chain silently mis-runs (the `&&` becomes a literal argument and only the first program runs); put multi-step boot-and-probe logic in a script.

---

## Code changed outside the pipeline

If `aitri status` reports `reconcile: pending` and the next-action is `aitri reconcile`:

- Run `aitri reconcile` to classify the changes.
- If the diff is refactor or already-registered bug fixes, **commit your fixes first** (including any edit `verify-run` forced), then run `aitri reconcile --resolve` (TTY-gated; requires tests passing, no blocking bugs, and a clean working tree — `--resolve` stamps the baseline at the current commit and rejects while behavioral files are uncommitted, or they re-trigger reconcile after you commit them).
- If the diff contains functional behavior changes, route them through the pipeline: `aitri feature init <name>` or `aitri run-phase requirements` for a root-pipeline change.

The behavioral allowlist filters out documentation, build manifests, lockfiles, CI configs, and generated assets — those will not trigger `reconcile: pending` by themselves.

---

## Artifact drift

If an artifact was modified after approval, `aitri status` shows `⚠️  DRIFT` on that phase. Two paths:

- **Content drift** (meaningful edits to artifact content): run `aitri approve <phase>` to re-approve. Aitri TTY-gates the re-approval and walks you through a review checklist. Re-approving cascade-invalidates downstream phases.
- **Bookkeeping drift only** (hash stale but content effectively unchanged — e.g. after a `git rebase` rewrote the artifact identically): `aitri rehash <phase>` updates the stored hash in place without cascading. Use this **only** when you have read the diff and confirmed nothing semantic changed.

---

## When the pipeline is complete

If `aitri status` shows all phases approved and `deployable: Ready`:

- Run `aitri validate` to confirm deployment readiness.
- **Share the result with product/QA without making them read JSON or code:** `aitri export traceability [--out matrix.md]` renders the traceability matrix (requirement × test cases × pass/fail × compliance) as a Markdown table. Read-only — it reads the existing artifacts and writes only the export. Use it to give a non-coding reviewer a readable view of what was built vs verified.
- Do **NOT** re-open approved phases to redo them (`aitri run-phase 1`, etc.). Re-running an approved phase whose artifact you then change clears its approval, flags drift, **and cascade-invalidates every downstream phase** — they were built on the version you are re-deriving, so each must be re-derived (run-phase → complete → approve) after you re-approve this one (you are warned). When you re-derive a reset downstream phase, `run-phase` prints the **FR delta** (which requirements were added/removed since that phase was last approved) — cover the additions, do not re-derive blind. Note: re-reading a briefing for a phase whose artifact is **unchanged** is a safe no-op — it prints the briefing without resetting state — so reviewing instructions does not cost you progress.
- Do **NOT** implement new functionality outside the pipeline.

If `aitri status` recommends `aitri audit` — run it. The audit is a separate evaluative pass on the completed pipeline; it produces `AUDIT_REPORT.md` and informs whether deploy readiness has degraded since the last audit.

- **`aitri audit requirements` — the idea→requirements completeness check (run it when `resume` suggests it).** (Renamed from `audit coverage`, which still works — the old word collided with test coverage.) This is a DIFFERENT audit from the code audit: it compares the client's original request (discovery / original brief / IDEA) against the functional requirements and lists any client need that no FR covers — the silent scope loss that no mechanical gate catches. Where Phase 1 produced a `coverage_map` (rc.124+), the audit re-derives the needs itself and **diffs** them against that map — a need you find that the map omits is the dropped one. `resume` suggests it once Phase 1 is approved and again whenever the requirements change. It is most valuable in a FRESH session, where you did not write these requirements and review them without bias. Advisory — it never blocks. Act on its findings: re-open Phase 1 to add a missing FR, or record an explicit out-of-scope decision. **A feature has its own intent too** — run `aitri feature <name> audit requirements` to check a feature's own ideation (`FEATURE_IDEA.md` / its absorbed `original_brief`) against the feature's FRs, catching a need the feature decided to do but silently dropped. It compares the feature's intent only (the parent project's FRs are out of scope for that pass) and acts on the same way: re-open the feature's Phase 1 (`aitri feature run-phase <name> requirements`) or record the out-of-scope decision.

- **`aitri audit security` — the adversarial security audit (run it when `resume` suggests it, or before any public deploy).** Attacker-first review of what the project actually EXPOSES: code, repo, dependencies, AND the deployed/running surface (endpoints, headers, exposed docs, shipped assets). Declared security NFRs prove intent, not protection — this audit verifies the posture. Strictly defensive: passive, non-destructive checks only. Findings land as RQ-SEC remediation requirements in `AUDIT_REPORT.md`; route them with `aitri audit plan` (P0s become bugs) and create the proposed verification script as a `quality_gates` entry so `verify` re-checks the posture every cycle. Advisory — it never blocks.

If `aitri resume` says the project is idle (all green, no drift, fresh verify, fresh audit), there is nothing to do. Do not invent work.

**Before pausing or handing off, save the narrative thread.** Aitri auto-persists *where* you are (phase state, events, last action, files touched) but not *why* or *what's next* — the one thing the next session (or another dev) cannot reconstruct. Run `aitri checkpoint --context "what you're doing, why, what's next"`; it persists across later pipeline actions and `aitri resume` surfaces it. If `resume` shows "⚠ No narrative context saved", write one. There is no auto-summary (it would cost tokens for no gain) — you write the line, Aitri keeps it.

---

## Adding new functionality

Three tiers — pick the right one **by size**, not just "is this new behavior?":

- **Trivial** (typo, colour value, single-line CSS, a config value, a comment, a log message): implement directly. No Aitri command.
- **Small** (one-field form addition with no new validation logic, layout/CSS change in a single component, label/copy change that does not alter user-facing contract, additive optional config field): implement directly. No Aitri command.
- **Feature** (new flow, schema migration, cross-component change, new endpoint, new business rule — anything the user could describe in a sentence as "a thing the product does"): `aitri feature init <name>`, then follow the feature pipeline (`run-phase requirements` → … → `approve deploy`).

**When in doubt about behavior change**, lean feature.
**When in doubt about size**, prefer smaller scope first.

The bias toward "treat as feature" is intentional only for **behavioral** ambiguity — not for size. A small, well-scoped change does not need the full pipeline just because the title sounds new.

---

## Feature sub-pipelines

Features are independent sub-pipelines under `aitri/features/<name>/`. Each has its own `01_REQUIREMENTS.json`, tests, manifest, etc.

- All feature commands prefix as `aitri feature <verb> <name> [<phase>]`. Examples: `aitri feature run-phase auth requirements`, `aitri feature approve auth 1`, `aitri feature verify-run auth`, `aitri feature audit auth requirements`.
- **Commands that act on a feature's own data are feature-scoped — the name comes BEFORE the sub-verb:**
  - Manual TCs: `aitri feature tc <name> verify [<TC-ID> --result pass|fail --notes "..."]` (bare = guided checklist) and `aitri feature tc <name> mark-manual <TC-ID> [--reason "..."]`. An all-manual feature seeds + verifies exactly like the root (it will not pass `verify-complete` with zero verification).
  - Bugs: `aitri feature bug <name> <add|fix|verify|close|list> ...` — triages the feature's own `BUGS.json` (the same file `feature verify-complete` gates on).
  - Backlog: `aitri feature backlog <name> <add|list|show|done> ...` — the feature's own `BACKLOG.json`.
  - Cancelling a feature: `aitri feature discard <name>` (TTY-gated — a human confirms). Prefer it over `rm -rf features/<name>/`: if the feature reached the build phase it contributed code to the SHARED codebase (`lib/`, `tests/` outside the feature dir), and discard SURFACES those files so you can revert them via git. Deleting the dir alone leaves that code orphaned and live. Aitri never auto-reverts the code — that is git's job.
- Always follow the PIPELINE INSTRUCTION at the end of each feature command — it emits the correctly scoped next-action with the right prefix.
- Approving feature Phase 4 advances both the feature's reconcile baseline AND the root project's baseline (rc.1+). You should not need to manually `aitri reconcile` on the root after a clean feature completion.

---

## Bugs lifecycle

`aitri bug add` writes to `aitri/product/spec/BUGS.json`. Subsequent transitions:

- `aitri bug fix <BG-ID>` — developer marks it resolved. Add `--resolution "how it was fixed"` to record the resolution note (the word-level companion to the captured fix-commit SHA).
- `aitri bug verify <BG-ID>` — auto-set when the linked TC passes in `verify-run`, or manual.
- `aitri bug close <BG-ID>` — archive. Also accepts `--resolution "..."` for a bug closed without a code fix (won't-fix, duplicate).

Critical and high severity bugs in `open` or `in_progress` state block: `verify-complete`, `reconcile --resolve`, and the deploy gate.

---

## Backlog and audit (off-pipeline)

- `aitri backlog` — manages `aitri/product/spec/BACKLOG.json` (CLI-tracked items). The project also gets a hand-written `aitri/BACKLOG.md` for narrative items — both surfaces coexist; Aitri does not parse the Markdown version.
- `aitri audit` — evaluative pass on the completed pipeline. Produces `AUDIT_REPORT.md`. Deploy gate prefers a fresh audit (<60 days).

---

## What NOT to do

- Do not edit `.aitri/` files directly. The state schema is owned by Aitri; edit via the commands.
- Do not invent new artifact files or rename existing ones. The artifact chain is the contract.
- Do not skip the PIPELINE INSTRUCTION. If Aitri tells you the next action, run that — even if you "know" a shortcut.
- Do not run `aitri approve` on a phase that has not been validated by `aitri complete`.
- Do not implement during planning phases (1, 2, 3).
