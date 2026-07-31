# Build Plan — servidor-fuente-unica

5 epics. Cada uno se cierra cuando sus TCs `Makes pass` están en verde; entre epic y epic hay
checkpoint con el humano. El orden **no** es negociable: el Epic 2 rompe los tests que dependen de
`LocalStorageRepository`, así que su re-cimentación va **dentro** de ese mismo epic, no al final.

---

## Epic 1 — Retirar el flag de rollout y unificar el punto de construcción

**Requisitos:** FR-1101 · NFR-1103 · NFR-1107 (parcial) · ADR-01, ADR-02, ADR-06
**Riesgo que ataca:** RISK-1 (lógica viva sepultada bajo el flag) — el más alto de la feature.

| Archivo | Acción |
|---|---|
| `src/lib/serverMode.ts` | **Eliminar** |
| `src/data/makeRepo.ts` | **Eliminar** (ADR-02) |
| `src/state/store.ts` | `makeRepo()` sin ramas; **convertir a incondicional** (no borrar) los 3 bloques sepultados: `resync` ante 409 (:85), limpieza `ledger.*` (:187-194), seam `__ledgerStore` (:284) |
| `src/app/page.tsx` | Quitar `if (!SERVER_MODE) void hydrate()` — la hidratación es solo del gate (ADR-06) |
| `src/lib/authClient.ts` | Actualizar el comentario de contrato que cita el modo |

**Disciplina para RISK-1:** los tres bloques se tocan **uno a uno**, cada uno con su commit lógico y su
TC. Prohibido el borrado mecánico del `if` — es exactamente cómo se pierde el `resync`.

**Makes pass:** TC-SFU-101h · 101e · 101f · 203h · 203e · 203f

---

## Epic 2 — Postgres como única fuente + re-cimentar los tests que caen

**Requisitos:** FR-1103 · FR-1104 · FR-1105 · FR-1106 · NFR-1101 · ADR-03, ADR-04, ADR-05

| Archivo | Acción |
|---|---|
| `src/data/repository.ts` | Conservar **solo** la interfaz `LedgerRepository`. Retirar `LocalStorageRepository` y `stripLegacyUnassigned` |
| `src/domain/migrate.ts` | **NO se toca — CORREGIDO durante el epic.** `migrateStateV3toV4` tiene un consumidor vivo en el servidor (`ensureV4InTx`, `ledgerRepo.ts:161`). El plan original decía eliminarlo: habría roto una migración transaccional de producción (ADR-04 corregido) |
| `src/domain/types.ts` | Retirar `LEGACY_BUDGET_KEYS` (claves del almacén que muere). **Conservar `STORAGE_KEYS`** — la limpieza necesita los nombres a borrar (ADR-05) |
| `tests/helpers/inMemoryRepository.ts` | **Nuevo** — fake que implementa `LedgerRepository` (ADR-03) |
| `tests/integration/persistence.test.ts` | Re-apuntar a `InMemoryRepository` + cobertura de robustez contra `ServerRepository` (RISK-2) |
| `tests/integration/feature-stack.test.ts` | Re-apuntar a `InMemoryRepository` |
| `tests/integration/backend/repo-sync.test.ts` | Re-apuntar a `ServerRepository` — mata el pass falso de TC-BE-027h |
| `tests/integration/reserve-migration.test.ts` | **Re-apuntar** al camino de servidor (`ensureV4InTx`) — su sujeto sigue vivo; muere el vehículo |

**RISK-2 explícito:** NFR-003 raíz ("robustez de persistencia local") pierde su implementación. Su
*intención* —ante datos corruptos no se rompe, se recupera— se re-apunta al camino de servidor. **No**
se declara NFR-003 cumplido por un test que ya no existe; queda anotado en `technical_debt`.

**Makes pass:** TC-SFU-103h/e/f · 104h/e/f · 105h/e/f · 106h/e/f · 201h/e/f

---

## Epic 3 — Sesión obligatoria

**Requisitos:** FR-1102 · NFR-1102 · NFR-1106

| Archivo | Acción |
|---|---|
| `src/components/auth/LoginGate.tsx` | Colapsar `LoginGate` + `ServerGate` en uno. Eliminar el passthrough (`:66`). Fail-closed: sin sesión → formulario |

Sin tocar better-auth (no_go_zone). El gate es comodidad de UI; la barrera real sigue siendo el 401 de
la API — se verifica que **ambas** existen, no que una cubra a la otra.

**Makes pass:** TC-SFU-102h/e/f · 202h/e/f · 206h/e/f

---

## Epic 4 — Sistema de diseño en la pantalla de acceso

**Requisitos:** FR-1107 · FR-1108

| Archivo | Acción |
|---|---|
| `src/components/ui/input.tsx` | **Nuevo** primitivo `cva`, misma forma que `button.tsx`, escala `--control-md`/`--control-lg` |
| `src/components/auth/AuthForm.tsx` | Reescribir con `Input`/`Button` + clases del sistema. **Cero cambio de comportamiento** |
| `src/components/auth/LogoutButton.tsx` | **Nuevo** — extraído del JSX inline del gate; `Button` variante `ghost` |
| `src/components/auth/AuthPending.tsx` | **Nuevo** — unifica los DOS indicadores de carga duplicados (`LoginGate:17-23` y `page.tsx:29-36`) |
| `src/app/layout.tsx` | Actualizar `metadata.description` (FR-1107) |

**Contrato de regresión innegociable (RISK-3):** se conservan literales los 9 `data-testid`, los
`aria-label`, los `autoComplete` y los textos de error. La suite de `backend` (85 TCs) es el detector.

**Makes pass:** TC-SFU-107h/e/f · 108h/e/f

---

## Epic 5 — Gate estático, CI y regresión completa

**Requisitos:** NFR-1104 · NFR-1105 · NFR-1107 · NFR-1108

| Archivo | Acción |
|---|---|
| `scripts/no-legacy-mode.sh` | **Nuevo** — exit ≠0 si aparece `SERVER_MODE`, `LEDGER_SERVER_MODE` o `LocalStorageRepository` en `src/`. Alcance **solo** `src/` |
| `tests/e2e-backend/helpers/globalSetup.ts` | Dejar de definir `NEXT_PUBLIC_LEDGER_SERVER_MODE` |
| `.env.local` / `.env.example` / compose / docs | Retirar la variable (NFR-1107) |
| `04_BUILD_REPORT.json` | Declarar el gate `no-legacy-mode` en `quality_gates` |

**Por qué el gate en vez de un test:** el criterio "grep = 0" es una comprobación estática; escribirla
como test violaría la regla Behavior-vs-Implementation del pipeline. Como gate corre en cada `verify` y
es honesta sobre lo que es. **Y el gate se prueba fallando** (TC-SFU-207f siembra el flag y exige
exit≠0): un gate que nunca se vio fallar no protege nada.

**Makes pass:** TC-SFU-204h/e/f · 205h/e/f · 207h/e/f · 208h/e/f

---

## Definition of Done (verificar antes de `complete 4`)

- [ ] Los 48 TCs de Fase 3 en verde
- [ ] `npm run typecheck` y `npm run lint` limpios
- [ ] `scripts/no-legacy-mode.sh` → exit 0
- [ ] Suite completa del proyecto verde contra Postgres (las 10 features previas)
- [ ] `@aitri-trace` en cada función que implementa un requisito
- [ ] Sin TODO/FIXME en código de producción
- [ ] `technical_debt` declarado — incluida la deuda de NFR-003 raíz (RISK-2)
- [ ] Ningún `@aitri-trace` ni `console.log` en assets servidos al navegador
