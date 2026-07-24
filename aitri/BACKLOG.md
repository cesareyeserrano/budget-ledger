# Backlog

> Open items only. Closed items go in CHANGELOG.md or commit history.
> Priority: P1 (critical) · P2 (important) · P3 (nice to have)

---

## Entry Standard

Every backlog entry should be self-contained — implementable in a future session with zero memory of the original conversation. Before adding an item, verify it answers all of these:

| Question | Why it matters |
| :--- | :--- |
| **What is the user-visible problem?** | Prevents implementing a solution looking for a problem |
| **Which files are affected?** | Implementer knows where to start without exploring |
| **What is the exact behavior change?** | Removes ambiguity about what "done" looks like |
| **Are there decisions pre-resolved?** | Captures trade-offs decided during analysis, not during implementation |
| **What does the test or check verify?** | Defines the acceptance criterion |

**Minimum entry format:**

```
- [ ] P? — **Title** — one-line description of the user-visible problem.
  Problem: <why this matters; what breaks without it>
  Files: <lib/..., test/..., docs/...>
  Behavior: <what changes — inputs, outputs, validation rules>
  Decisions: <any trade-offs already resolved>
  Acceptance: <how to verify it works — test or manual check>
```

Entries without `Files` and `Behavior` are considered incomplete and should be expanded before scheduling.

---

## Open

<!-- Example entry below. Delete it and add real items. It is here so the format is concrete on first read. -->

- [ ] P3 — **Example: surface deploy timestamp in CLI status** — operators have to read CI logs to know whether the last deploy is current.
  Problem: there is no in-app indicator that a deploy succeeded; the team checks CI manually after every push, which is friction and easy to forget.
  Files: `lib/commands/status.js`, `test/commands/status.test.js`.
  Behavior: when the project records `last_deploy_at` (set by the deploy job), `status` renders a `Last deploy: <relative time>` line in the header. Absent → omit the line entirely.
  Decisions: relative time only (no absolute date), capped upstream at "30+ days ago" — exact dates belong in CI logs, not in the daily-driver CLI header.
  Acceptance: unit test asserts the header includes the line when the field is present and omits the line when absent.

---

## Diferidos conscientemente (cerrados en el backlog CLI, NO implementados)

Registro de por qué se cerró cada uno — `aitri backlog done` no guarda motivo. Cerrados el 2026-07-24.

- **backend/BL-004 — Cifrado a nivel de campo de montos y notas (era P2). NO IMPLEMENTADO.**
  Estado real: `amount` sigue en claro como `bigint` en `src/server/db/schema.ts` (tablas `amount_cell` y `movement`); ADR-08 delega el cifrado en reposo al volumen, lo que protege disco y backup pero no una query directa a la BD. Riesgo vigente: quien obtenga acceso de lectura a Postgres lee los montos.
  Por qué se difiere: es una feature propia, no un parche — exige gestión de claves (AES-GCM) y rompe los `CHECK amount >= 0` y cualquier query numérica sobre el monto.
  Para retomar: `aitri feature init field-encryption`. Ver NFR-511 en `05_TRACEABILITY.json`.

- **backend/BL-002 — CSP con nonce (era P3). Cerrado como decisión aceptada, no como trabajo hecho.**
  Las otras dos partes del ítem sí están implementadas: `poweredByHeader: false` (`next.config.mjs`) y el rate-limit de `/sign-up/email` (`src/server/auth.ts`).
  La CSP mantiene `'unsafe-inline' 'unsafe-eval'` en `next.config.mjs`: Next inyecta scripts y estilos inline sin nonce en este setup, y endurecerla rompe la app. El comentario del archivo ya documenta el trade-off. Revisar si Next habilita nonces nativos.
  El gate `scripts/security-config.sh` que proponía el audit no se creó.
