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

---

## Hallazgos abiertos (registrados durante otro trabajo)

- ~~**backend/BG-001 — `TC-BE-084h` falla: `npm audit --audit-level=high` sale con exit 1.**~~ **RESUELTO Y CERRADO el 2026-07-28.** La salida estaba donde no habíamos mirado: `minimatch@10.2.6` declara `brace-expansion: ^5.0.8`, o sea está hecho para la versión parcheada. Con los overrides `brace-expansion ^5.0.8` + `minimatch ^10.2.6`: audit en 0 vulnerabilidades, TC-BE-084h pasa, suite completa 243/243 y cobertura 94.46%. El intento del 2026-07-25 (forzar solo brace-expansion) falló porque minimatch CJS hacía `require(...).default`; faltaba subir también minimatch. Registro original abajo. Detectado el 2026-07-25 durante el build de la feature `balance` (no lo causa esa feature).
  Problema: aviso nuevo GHSA-mh99-v99m-4gvg (`brace-expansion`, DoS por expansión no acotada, CVSS 7.5). Genera 18 vulnerabilidades "high" en el árbol. `TC-BE-084h` (NFR-513) afirma que el gate SCA sale en 0, así que la suite unit queda en rojo y **vitest deja de imprimir el reporte de cobertura** mientras el test falle.
  Alcance real: las 18 rutas son **exclusivamente devDependencies** — cadena `eslint`/`eslint-config-next`, `@vitest/coverage-v8` (vía `test-exclude`→`glob`) y `testcontainers` (vía `archiver`). **Cero dependencias de producción**; el patrón glob que se expande lo controla el desarrollador, no un atacante, y el paquete no viaja en el artefacto desplegado. De ahí la severidad `medium` registrada en `BUGS.json` pese al 7.5 del aviso: la reachability real en este producto no es alta.
  Intento de arreglo YA DESCARTADO (no repetirlo a ciegas): `npm` reporta `fixAvailable: false`; el rango vulnerable es `<=5.0.7` y la única versión sana es `5.0.8`. Forzarla con un override en `package.json` **sí deja el audit en 0 y pasa typecheck/lint**, pero **rompe el proveedor de cobertura**: `minimatch` (CJS) hace `require("brace-expansion").default` y la build CommonJS de la v5 no expone ese default → `TypeError: (0 , brace_expansion_1.default) is not a function` en `test-exclude`→`glob`→`minimatch`. Se probó y se revirtió; `package.json`/`package-lock.json` quedaron intactos.
  Caminos posibles (decisión del usuario): (a) esperar a que `minimatch`/`glob` publiquen con `brace-expansion@5.0.8`; (b) cambiar el gate a `npm audit --omit=dev --audit-level=high`, que es lo que el gate parece querer decir (vulns que llegan a producción) — pero eso modifica el alcance de la feature `backend` y su TC, así que va por su pipeline; (c) aceptar el fallo temporalmente.
  Acceptance: `npm audit --audit-level=high` sale 0 **y** `npx vitest run --project app --coverage` imprime la tabla de cobertura sin `Unhandled Error`.

- **stack-upgrade-theme — fuga de trazas `@aitri-trace` al bundle servido al navegador.** Detectada el 2026-07-25 durante el build de `balance` (no la causa esa feature).
  Problema: `grep -rl "aitri-trace" .next/static/` devuelve `chunks/app/layout.js`, que contiene literalmente `@aitri-trace FR-ID: FR-201, US-ID: US-201, AC-ID: AC-201, TC-ID: TC-SUT-201h`. Cualquiera que abra el código fuente en el navegador ve parte del mapa interno de requisitos. La checklist de revisión humana de Aitri pide explícitamente que ese grep no devuelva nada.
  Origen: los JSDoc con `@aitri-trace` de `src/app/providers.tsx:10` y `src/components/useResolvedTheme.ts:10`. Son componentes de cliente, así que sus comentarios viajan al bundle; en los módulos de servidor o de dominio esto no pasa.
  Alcance: solo esa traza (FR-201). Se verificó que el código de la feature `balance` NO filtra: `grep -rlo "TC-BAL\|FR-90[45678]" .next/static/` no devuelve nada, porque sus trazas viven en `src/domain/` y en comentarios que el minificador elimina.
  Files: `src/app/providers.tsx`, `src/components/useResolvedTheme.ts`.
  Behavior: mover la traza fuera del comentario que sobrevive al bundle (o configurar el minificador para eliminar comentarios en los chunks de cliente). Sin cambio de comportamiento visible.
  Acceptance: `grep -rl "aitri-trace" .next/static/` no devuelve ningún archivo tras `npm run build`.

- **Las tres tarjetas del encabezado (resumen del mes/año) chocan con el módulo de Balance.** Detectado el 2026-07-27 revisando el diseño de la feature `balance`.
  Problema: en la misma pantalla, sin scroll, la tarjeta dice `DISPONIBLE $0` y el balance dice `Saldo disponible 300`. Misma palabra, dos cálculos distintos: la tarjeta hace `presupuesto de gastos − ejecutado` (solo gastos, es "cuánto me queda del presupuesto"), el balance hace `saldo anterior + flujo − reservas` (es "cuánta plata tengo"). Los dos números son correctos; el choque es de rótulo. Quien mire rápido va a pensar que uno está mal.
  Contexto del usuario (2026-07-27): las tres tarjetas —PRESUPUESTO · GASTOS, EJECUTADO, DISPONIBLE— son **el resumen del mes o año** y **todavía no están trabajadas a fondo**. Por eso se difiere: no tiene sentido renombrar una pieza cuyo diseño completo está pendiente. Cuando se aborden, resolver el choque es parte del trabajo, no un ítem aparte.
  Files: `src/components/DesktopShell.tsx` (las tarjetas `<Kpi>`, ~línea 99-105).
  Behavior: al rediseñar el resumen, el rótulo "DISPONIBLE" debe dejar de colisionar con "Saldo disponible" del balance — renombrando la tarjeta (p. ej. "Presupuesto restante") o redefiniendo qué mide.
  Decisions: NO se toca ahora. El diseño de `balance` ya lo había señalado como riesgo en su Risk Analysis ("doble 'disponible' en pantalla") y se mantiene abierto conscientemente.
  Acceptance: no queda en la pantalla de Resumen más de un elemento rotulado "disponible" con cálculos distintos.

- **Sistema de color de la grilla: tres códigos superpuestos, el rojo significa tres cosas.** Propuesta preparada el 2026-07-27 a pedido del usuario, para llevar a una revisión de UX/UI fintech. NO implementada.
  Problema: hoy conviven tres sistemas de color en la misma superficie. (1) *Identidad de tipo* — `--type-expense` rojo, `--type-income` verde, `--type-transfer` azul. (2) *Estado de presupuesto* (feature budget-state-color) — `--state-warning` ámbar >100 %, `--state-over` rojo ≥120 %. (3) *Balance* — `--success-strong` verde ≥0, `--error-strong` rojo <0, azul en el reservado. Resultado: el ROJO significa "esto es un gasto", "te pasaste mucho" y "estás en negativo" según dónde esté; el verde significa "esto es un ingreso" y "tu saldo está sano". Cuando un color significa tres cosas, deja de informar — que es exactamente lo que el usuario reporta como "el uso de colores no me convence".
  Principio propuesto: **el color codifica ESTADO, no CATEGORÍA.** La categoría ya la dice el rótulo de la fila; gastarle color es desperdiciar el canal más fuerte de la pantalla. Es la práctica estándar en productos densos de finanzas personales: tabla casi monocroma, color reservado a la excepción — lo que está mal o exige acción.
  Aplicado aquí significaría: retirar el color de identidad de tipo de las filas y celdas (queda el ícono y el rótulo para distinguirlas), y dejar el color solo para (a) sobre-consumo del presupuesto y (b) saldo negativo. El verde quedaría solo para el saldo sano, no para "esto es un ingreso".
  Alcance real: **transversal, toca features ya cerradas** — `budget-state-color` (FR-401/402/404), `ux-consistency` (FR-311, los `--type-*-fill`), `stack-upgrade-theme` (FR-204, `typeColorVar`) y el Registro móvil, que propaga el color por tipo. NO es un ajuste; es una feature con su propio pipeline.
  Decisión del usuario: prefiere guía de UX/UI fintech antes de decidir. Esta entrada es el insumo para esa conversación, no la decisión.
