# AUDIT_REPORT.md — backend (feature)

## Requirements Coverage

Auditoría independiente que re-deriva las necesidades del brief de la feature (seed brief:
`FEATURE_IDEA.md`) y las contrasta contra los FRs/NFRs de `01_REQUIREMENTS.json`. Ejecutada
tras `aitri adopt --upgrade` (rc.171 → rc.172). Los tres gaps hallados ya fueron resueltos en
el mismo ciclo de Fase 1 (antes de aprobar), por lo que quedan como **RESUELTOS** con el FR/NFR
que los cubre.

### Gaps hallados y resueltos

**[GAP-1]** `RESUELTO (era UNCOVERED)` — Cifrado de la información financiera de los usuarios
  - Fuente: observación del usuario ("es una app de finanzas multiusuario, se debe cifrar de alguna
    forma la información financiera de los usuarios"). El brief exige seguridad y aislamiento por
    `ownerId` pero NO declaraba explícitamente cifrado de datos financieros.
  - Estado previo: UNCOVERED — NFR-501 cubría hashing de contraseñas y "transporte seguro" de forma
    genérica, sin un requisito de cifrado de los datos financieros en tránsito y en reposo.
  - Acción: se añadió **NFR-511 (Security)** — cifrado en tránsito (TLS/HTTPS obligatorio) y en reposo
    (datos financieros y credenciales no legibles en claro en el almacenamiento), mecanismo concreto
    diferido a Fase 2. Registrado en `coverage_map`.

**[GAP-2]** `RESUELTO (era PARTIAL)` — Cierre de sesión (logout) / fin del ciclo de la sesión
  - Fuente: brief §New Behavior ("una sesión que identifique al usuario en cada request") — describe
    el inicio de la sesión pero no su terminación explícita.
  - Estado previo: PARTIAL — FR-503 cubría la identidad por request pero no el logout ni la
    invalidación de la sesión.
  - Acción: se añadió una acceptance_criteria de logout a **FR-503** (tras logout la sesión deja de
    resolver a un usuario y un request posterior recibe 401) y su AC en US-503.

**[GAP-3]** `RESUELTO (era PARTIAL)` — Estado inicial de un usuario nuevo (empty/seed state)
  - Fuente: brief §Provenance ("arranque limpio (sin migrar el localStorage actual)") + eje
    empty/zero-data del Requirement Depth Protocol — qué ve una cuenta recién creada.
  - Estado previo: PARTIAL — FR-506 cubría la persistencia pero no el estado inicial con el que
    arranca un usuario nuevo ni la garantía de no arrastrar el localStorage previo.
  - Acción: se añadió **FR-513 (persistence)** — un usuario nuevo obtiene un ledger propio, aislado y
    utilizable (semilla o vacío usable, decidido en diseño), sin datos de otros ni migración del
    localStorage. Registrado en `coverage_map` + US-513.

### Trazabilidad — necesidades verificadas como cubiertas

Todas las necesidades del brief mapean a un FR/NFR o a una línea explícita de out-of-scope:

- API de servidor con contrato versionado, filtrada por usuario → FR-507
- Multiusuario / aislamiento por `ownerId` desde el día uno → FR-505
- Registro/login email+contraseña → FR-501 · Google OAuth → FR-502
- Sesión por request + logout → FR-503 · Gating de la API (401) → FR-504
- Esquema de BD por usuario (usuarios/credenciales, nodos, presupuestos, ejecutados, movimientos) → FR-506
- Impl de servidor de `LedgerRepository` → FR-508
- Split de almacenamiento (localStorage solo tema/prefs) → FR-509
- Sync al recargar → FR-510 · Sync en vivo sin recarga → FR-511
- Persistencia portátil (reinicio + cambio de host) → FR-512
- Estado inicial de usuario nuevo / arranque limpio → FR-513
- Seguridad línea base OWASP (hashing, validación, authz por objeto, secretos) → NFR-501 · **Cifrado financiero → NFR-511**
- Ciberseguridad en serio: endurecimiento auth/sesión + cabeceras + anti-fuerza-bruta + CORS → NFR-512
- Gates de seguridad en CI (SCA/vuln deps, sin secretos) + auditoría adversarial pre-deploy → NFR-513
- Estándar de ingeniería del backend a nivel profesional (paridad o superior al front) → constraint + NFR-503/NFR-509
- Observabilidad → NFR-502 · CI/CD → NFR-503 · Healthcheck → NFR-504
- Fiabilidad/portabilidad → NFR-505 · Rendimiento (sin degradar roll-up cliente) → NFR-506
- Must-not-break (dominio puro, grilla/registro/edición, suite verde, portabilidad) → NFR-507..510
- Out of scope: apps nativas · atarse a un host · roles/compartir/equipos · cambiar UI/dominio/roll-ups ·
  migrar localStorage · mover cálculo al servidor → `no_go_zone`

**Resultado:** Complete — cada necesidad trazada mapea a un FR/NFR o a una línea explícita de
out-of-scope. Los 3 gaps que la auditoría encontró frente a la versión previa quedaron resueltos
en este mismo ciclo antes de la aprobación.
