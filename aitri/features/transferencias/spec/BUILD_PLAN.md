# BUILD_PLAN — feature transferencias (Reservas)

Plan generation: 1 (fresh build, 2026-07-29). Fuente: 01_REQUIREMENTS.json + 02_SYSTEM_DESIGN.md + 03_TEST_CASES.json (67 TCs, todos asignados a exactamente un epic).

Nota de alcance: FR-1013 (SHOULD, helper de trayectoria) no tiene US ni TCs propios — se implementa en EP-04 según Flujo 6 del UX spec; si se recorta, se declara en technical_debt.

## EP-01 — Dominio de reservas (resolvedBalance + reglas + applyReserveOp)   [status: done]
  Delivers:    US-1001, US-1004, US-1006, US-1007
  FRs:         FR-1001, FR-1004, FR-1006, FR-1007
  Makes pass:  TC-TRF-101h, TC-TRF-101f, TC-TRF-104h, TC-TRF-104e, TC-TRF-104f, TC-TRF-204e, TC-TRF-106h, TC-TRF-106f, TC-TRF-106e, TC-TRF-206e, TC-TRF-306h, TC-TRF-406e, TC-TRF-107h, TC-TRF-107f, TC-TRF-107e, TC-TRF-207e, TC-TRF-152h, TC-TRF-152f, TC-TRF-153f, TC-TRF-154h, TC-TRF-154e
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Todo lo demás (grilla, registro, balance, migración) consume esta capa pura — sin ella no hay nada que conectar. (TCs NFR alojados aquí: NFR-1002 unit, NFR-1003 unit 153f, NFR-1004 unit — verifican este mismo dominio.)

## EP-02 — Balance con dos filas y conservación   [status: done]
  Delivers:    US-1009
  FRs:         FR-1009
  Makes pass:  TC-TRF-109h, TC-TRF-109e, TC-TRF-109f, TC-TRF-151h, TC-TRF-151e, TC-TRF-151f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    reserveNet→aportes/retiros depende solo de EP-01; desbloquea el techo bien anclado y las verificaciones de conservación (NFR-1001) antes de tocar UI.

## EP-03 — Migración v2→v3, from/to en 5 capas y servidor transaccional   [status: done]
  Delivers:    US-1010
  FRs:         FR-1010 (+ lado servidor de FR-1004, persistencia de FR-1001)
  Makes pass:  TC-TRF-110h, TC-TRF-110e, TC-TRF-110f, TC-TRF-101e, TC-TRF-304e, TC-TRF-153h, TC-TRF-153e, TC-TRF-154f, TC-TRF-157f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    La UI no puede montarse sobre datos con semántica vieja: primero el dato migra y persiste bien (localStorage v3 + Postgres data_version + insertMovement multi-celda). Incluye re-basar los 8 archivos de tests que siembran ledger.budget.v2 (157f).

## EP-04 — Grilla: celdas-saldo, editor extendido y plano Pres.   [status: done]
  Delivers:    US-1002, US-1003, US-1008
  FRs:         FR-1002, FR-1003, FR-1008, FR-1013 (SHOULD, sin TCs)
  Makes pass:  TC-TRF-102h, TC-TRF-102e, TC-TRF-102f, TC-TRF-202e, TC-TRF-103h, TC-TRF-103e, TC-TRF-103f, TC-TRF-203e, TC-TRF-303e, TC-TRF-108h, TC-TRF-108e, TC-TRF-108f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    La puerta principal (escritorio) — necesita dominio (EP-01), balance (EP-02) y datos migrados (EP-03) para que las tintas, franjas, toast/Deshacer y la marca de plan muestren números reales.

## EP-05 — Registro: tipo Reserva con De→A   [status: done]
  Delivers:    US-1005
  FRs:         FR-1005
  Makes pass:  TC-TRF-105h, TC-TRF-105e, TC-TRF-105f, TC-TRF-205h, TC-TRF-152e, TC-TRF-156e
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    La segunda puerta (móvil 375px) reutiliza el mismo dominio y la acción de store creada en EP-04; los TCs de regresión del registro (152e) y táctiles (156e) viven aquí.

## EP-06 — Reestructuración del árbol conserva saldos   [status: done]
  Delivers:    US-1011
  FRs:         FR-1011
  Makes pass:  TC-TRF-111h, TC-TRF-111e, TC-TRF-111f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    mergeMonthMap para transfer es ortogonal a las puertas — se hace tras estabilizar el dominio para escribir el invariante con la capa resuelta ya probada.

## EP-07 — Observaciones por celda   [status: done]
  Delivers:    US-1012
  FRs:         FR-1012
  Makes pass:  TC-TRF-112h, TC-TRF-112e, TC-TRF-112f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Depende del editor extendido (EP-04) y de from/to persistidos (EP-03): notas derivadas + cellNotes manuales (tabla cell_note + clave v3).

## EP-08 — Cierre: accesibilidad, performance y suite agregada   [status: done]
  Delivers:    — (cierre de NFR-1005, NFR-1006, NFR-1007; sin US propia)
  FRs:         — (NFRs)
  Makes pass:  TC-TRF-155h, TC-TRF-155e, TC-TRF-155f, TC-TRF-156h, TC-TRF-156f, TC-TRF-157h, TC-TRF-157e
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Solo puede cerrarse al final: perf medida sobre el sistema completo (≤150ms/30 alcancías), AA en ambos temas sobre las tintas ya montadas, y la suite agregada del monorepo en verde con las re-derivaciones documentadas (build report).

## EP-09 — Change request FR-2509: textos de la sección de la celda   [status: done]
  Delivers:    US-1012 (sin cambio de comportamiento)
  FRs:         FR-1012
  Makes pass:  TC-TRF4-012h, TC-TRF4-012e
  Build steps: skeleton → persistence/integrations → hardening (solo textos: sin persistencia ni lógica)
  Why here:    Change request aprobado el 2026-09-14 desde diario-de-celda (FR-2509), fase 3 re-aprobada el 2026-09-15. «Observaciones» → «Detalle», «Añadir observación» → «Añadir comentario», «Sin observaciones este mes» → «Sin movimientos ni comentarios». Mismos data-testid. También cambia la etiqueta en techo-de-flujo.spec.ts (TC-TDF-080h), solo en el código del e2e.

---

## Checkpoints / evidencia
(al cierre de cada epic: resultado del run de sus TCs + notas)

### EP-01 (2026-07-29) — done
- `npx vitest run tests/domain/reserve.test.ts` → **21/21 ✓** (los 21 TCs del epic).
- Suite app completa tras re-base: **204/204 ✓**.
- Código: nuevo `src/domain/reserve.ts` (resolvedBalance memoizado por identidad, validateReserveWrite
  con techo global + piso en cadena, applyReserveOp, applyReserveCellEdit, clearReserveCell);
  `ids.ts` extraído de mutations (uid/nextSeq compartidos sin ciclo); `Movement.from/to` en types;
  `normalizeNote` movida a validation (re-export compat); `addMovement`/`setLeafAmount` delegan para
  transfer (ADR-05); `deleteNode` limpia por ambos extremos; `balance.ts#reserveNet` re-implementado
  como delta de saldos resueltos (FR-1009).
- Semántica fijada del piso en cadena (DESIGN_OPTIONS §9.1): al reducir un mes previo, los retiros ya
  operados del PRIMER mes explícito posterior deben seguir ejecutables (`explicit(m1)+d ≥ 0`); limit
  del veredicto = "el saldo que quedaría". Techo en cadena: bloquea solo lo que la escritura EMPEORA
  vs el estado base (protege datos migrados que ya violaban — coherente con ADR-04).
- Re-derivaciones aplicadas en `tests/domain/balance.test.ts`: TC-BAL-907h/907f/936e re-basados a
  semántica saldo (declarados en NFR-1007); TC-BAL-958h whitelist de imports +"./reserve" (ajuste de
  allowlist, el sentido del test —pureza— intacto).

### Iteración de feedback (2026-07-29, tras probar el usuario con sus datos) — done
- Reporte: «se perdió el arrastre» — la migración escribía los 12 meses EXPLÍCITOS, así que en
  datos migrados no quedaba ni una celda gris y toda la grilla parecía "acumulado". FIX: migración
  DISPERSA (`migrate.ts#cumsum` escribe explícito solo donde hubo aporte > 0) — saldos resueltos
  idénticos, el gris de arrastre sobrevive la migración. Tests re-ajustados: TC-TRF-110h/153h
  (spec migración), TC-TRF-110e (backend) ahora afirman la forma dispersa + resolved.
- Reporte: «no sé qué significan Volver al arrastre / Planear trayectoria» — tooltips explicativos
  en ambos botones (title, lenguaje del usuario).
- Runs tras el fix: vitest completo **292/292 ✓** · e2e transferencias+registro **19/19 ✓**.
- NOTA para datos de dev YA migrados (densos, marcados v3): el fix no re-corre sobre ellos — la
  marca lo impide por diseño. Opciones: re-sembrar el ledger de dev, o sparsificar una vez
  (borrar celdas transfer cuyo valor == resuelto del mes previo; no cambia ningún saldo).

### EP-08 (2026-07-29) — done · CIERRE DEL BUILD
- `tests/domain/reserve-perf.test.ts` → **3/3 ✓** (155h ≤150ms real, 155e memoización por contador,
  155f gasto sin validación) · e2e a11y → **3/3 ✓** (156h claro+oscuro con contraste computado,
  156f canales no cromáticos) · `tests/integration/reserve-closure.test.ts` → **2/2 ✓** (157h los
  67 TCs presentes exactamente una vez; 157e re-derivaciones auditadas mecánicamente).
- **AGREGADO FINAL: vitest completo 292/292 ✓ · Playwright cliente 245/245 ✓ · Playwright backend
  15/15 ✓** — cero rojo en el monorepo (NFR-1007).
- Re-derivación adicional descubierta por el agregado: TC-SUT-227e re-basado a tipo gasto (el tipo
  transfer ya no usa CategoryRow; su estado vacío lo cubre TC-TRF-105e). Documentada en el report.
- Instrumentación: `__reservePerfCounters`/`__resetReservePerfCounters` en reserve.ts (solo tests).
- 04_BUILD_REPORT.json escrito (manifest completo, 3 deudas técnicas declaradas, re-derivaciones
  documentadas, gates: typecheck/lint/coverage/smoke/e2e + unit.sh como runner).

### EP-07 (2026-07-29) — done
- `tests/domain/reserve-notes.test.ts` → **1/1 ✓** (112f) · e2e grilla → **10/10 ✓** (incluye 112h,
  112e) · suites: app **224/224 ✓** · backend **63/63 ✓**.
- Código: `CellNote`/`CellNotesMap` + `LedgerState.cellNotes` (delta aditivo); dominio
  `cellObservations` (derivadas del journal from/to + manuales, por antigüedad) y `addCellNote`
  (rechaza >280 SIN truncar); clones preservan cellNotes; persistencia local v3 con cellNotes;
  servidor: `ledgerStateSchema.cellNotes`, `rowsToState`/`insertSnapshot`/`saveLedger` con la tabla
  `cell_note` (snapshot replace incluido); UI: punto indicador 4px + tooltip (máx 3 + «+N más»),
  sección «Observaciones» del editor con contador ≤280 en `--error` y blur-commit protegido por
  relatedTarget (el foco dentro del editor no comitea la celda).

### EP-06 (2026-07-29) — done
- `tests/domain/reserve-restructure.test.ts` → **3/3 ✓** (111h, 111e, 111f) · suite app **223/223 ✓**.
- Código: `mergeReserveMonthMap` en mutations (materializa el arrastre de AMBAS series y suma
  saldos resueltos — 12 explícitos) + despacho `mergeMonthMapForType` en los TRES sitios de fusión
  FR-604 de moveNode; `tests/helpers/totals.ts` gana `resolvedYearByMonth` (el invariante de
  conservación para transfer: Σ resolved(m) idéntico antes/después, mes a mes).

### EP-05 (2026-07-29) — done
- `tests/e2e/transferencias-registro.spec.ts` → **6/6 ✓** (105h, 105e, 105f, 205h, 152e, 156e) y
  re-run del spec de grilla → **8/8 ✓** (14/14 en el run conjunto, Playwright contra el build real).
- Código: `TypeToggle` renombrado «Reserva» (cierra el pendiente de FR-911); `ReserveRow.tsx`
  (chips De/A con saldo visible, «Disponible» primero, subs aplanadas «Grupo · Hoja», exclusión
  mutua dinámica De=A imposible, estado vacío con guía, táctiles ≥48px); `Register.tsx` monta
  ReserveRow para el tipo transfer, guía «Máx./Margen del mes» bajo el monto (pasa a --error y
  deshabilita Guardar al exceder — prevención H5), guarda vía `addMovement` con from/to (delega en
  applyReserveOp) y muestra el overlay de confirmación con «$X · De → A»; `availableMargin` en el
  dominio; `ConfirmOverlay` con resumen de operación.

### EP-04 (2026-07-29) — done
- `tests/domain/reserve-grid.test.ts` → **4/4 ✓** (203e, 303e, 108h, 108f) ·
  `tests/e2e/transferencias.spec.ts` → **8/8 ✓** (102h/e/f, 202e, 103h/e/f, 108e, Playwright real).
- Suite e2e completa del monorepo: **234/234 ✓** · app **220/220 ✓**.
- Código: `ReserveCells.tsx` (celda-saldo con tres tintas + «0» pleno + «—», badge SALDO, editor con
  franja de bloqueo inline que NO se cierra, preview de efectos derivados Aplicar/Cancelar, «↺ Volver
  al arrastre», popover «Planear trayectoria…» FR-1013, banner one-shot con flag
  `ledger.ui.reservasNoticeSeen.v1`); `reserveText.ts` (mensajes únicos para ambas puertas);
  `BudgetGrid.tsx` (branch transfer: totales y padres por saldos resueltos, marca «!» de plan);
  store: `applyReserveEdit` + undo de un nivel por referencia (ADR-07) + `clearReserveCell` +
  `applyPlanTrajectory`; `Toaster` con acción «Deshacer» (6s); `planTechoMonths`/`reserveLeafDelta`
  en el dominio.
- Re-derivaciones e2e adicionales (superseded por FR-1002/FR-1009, documentar en build report):
  TC-BAL-953e (6→7 filas), TC-BAL-909e/909f (fila «retiros» en el pliegue), TC-BAL-953f y
  TC-BSC-452e (tinta de transfer: --accent-light → --fg de saldo explícito; el propósito del TC
  —fuera de los umbrales de gasto, sin marca ›— se conserva y se refuerza).
- Nota: TC-TRF-102f ejerce hoy grilla; al cerrar EP-05 se le añade la operación por registro.

### EP-03 (2026-07-29) — done
- `tests/integration/reserve-migration.test.ts` → **6/6 ✓** (110h, 101e, 153h, 153e, 154f, 157f) ·
  `tests/integration/backend/reserve-server.test.ts` → **3/3 ✓** contra Postgres efímero (110e
  concurrente real, 110f cinco capas por las rutas reales, 304e multi-celda transaccional).
- Suites completas: app **216/216 ✓** · backend **63/63 ✓**.
- Código: `domain/migrate.ts` (cumsum puro por hoja transfer, ambos planos); `validation.ts` unión
  discriminada v2|v3 + from/to + cellNotes en schema; `STORAGE_KEYS.budget` → `ledger.budget.v3` +
  `LEGACY_BUDGET_KEY`; `repository.ts` migra one-shot al cargar (re-persiste v3, borra clave vieja);
  `seed.ts` genera trayectorias de saldo para transfer (meses no ejecutados AUSENTES);
  `db/schema.ts` + `drizzle/0001_transferencias.sql` (ADITIVA: ledger.data_version, movement.from_id/
  to_id, tabla cell_note); `server/schemas.ts` from/to en input y api; `ledgerRepo.ts`: migración
  lazy transaccional con `for update` + re-check, `saveLedger` estampa data_version=3 (un snapshot
  v3 jamás se re-migra), `insertMovement` persiste el diff completo de celdas.
- Re-base declarado (NFR-1007): los 8 archivos que sembraban `ledger.budget.v2` pasados a v3; el
  literal viejo vive SOLO en el spec de migración (TC-TRF-157f lo verifica mecánicamente).

### EP-02 (2026-07-29) — done
- `npx vitest run tests/domain/reserve-balance.test.ts` → **6/6 ✓** · suite app completa **210/210 ✓**.
- `BalanceModule.tsx`: fila nueva «+ Retiros del mes» (tone reserve, siempre visible, 0 sin retiros);
  «− Reservas del mes» pasa a pintar SOLO aportes (`reserveAportes`/`reserveRetiros`). La aritmética
  de `monthBalance` intacta; conservación verificada con el escenario del usuario (500→500→450) y
  con secuencias deterministas de 120 operaciones (TC-TRF-109f).

### Re-derivación v3→v4 (2026-07-30) — pipeline normalizado
- Fase 1 reescrita al modelo v4 (14 FRs + 7 NFRs, coverage_map de 24 necesidades) — auditoría
  independiente de requisitos: 31/31 cubiertas, 0 gaps. UX spec y TRD re-derivados (ADR-01v4).
- Fase 3: 67 TCs nuevos con prefijo TC-TRF4-* (los TC-TRF-* del modelo v3 quedan superseded).
- Suite completa reescrita: unit (38) + integration app (10) + backend (2) + e2e (17, en 19 runs).
- Runs finales: vitest app **229/229 ✓** · backend **62/62 ✓** · Playwright **246/246 ✓** ·
  typecheck y lint limpios.
- Los hallazgos adversariales del 2026-07-30 quedaron como TCs negativos permanentes
  (TC-TRF4-004e/104e/011f) y la migración v3→v4 con retiros sintetizados como TC-TRF4-010h/010e.

### EP-09 (2026-09-15) — done · change request FR-2509
- Fase 3 re-aprobada con TC-TRF4-012h/012e cambiados solo en texto (ids y campos verificados contra HEAD).
- `ReserveCells.tsx`: «Detalle», «Añadir comentario» (aria-label y placeholder), «Sin movimientos ni comentarios».
  Sin cambio de lógica ni de data-testid. Etiqueta también en `techo-de-flujo.spec.ts` (TC-TDF-080h).
- Runs: Playwright TC-TRF4-012h, TC-TRF4-012e y TC-TDF-080h **3 passed** (exit 0) · reserve-closure
  TC-TRF4-157h/157e/157f **3/3 ✓** · typecheck y lint exit 0 · sin restos de los textos viejos en src ni tests.
- Pendiente fuera de esta feature: `BudgetGrid.tsx:364-365` («dejar una observación») y su
  `cierre-de-mes.spec.ts:159` — lo resuelve diario-de-celda (FR-2509).
