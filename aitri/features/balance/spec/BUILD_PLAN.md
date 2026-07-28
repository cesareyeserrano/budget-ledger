# BUILD_PLAN — Feature: balance (Phase 4)

Plan generation: **1** (fresh build, 2026-07-25). Epic ids `EP-01..EP-03` asignados una vez, en orden
de dependencia, y NO se renumeran.

Working file — no es artefacto del pipeline, nada lo valida. Existe para la ejecución por incrementos
visibles y para que una sesión que retome el build sepa dónde quedó.

Los 47 TC ids de `03_TEST_CASES.json` están repartidos: cada uno aparece en exactamente UN epic.

---

## EP-01 — Cálculo del balance (dominio puro)   [status: done]
  Delivers:    US-905, US-906, US-907
  FRs:         FR-905, FR-906, FR-907
  Makes pass:  TC-BAL-905h, TC-BAL-905e, TC-BAL-905f, TC-BAL-915e, TC-BAL-925e, TC-BAL-945e,
               TC-BAL-916e, TC-BAL-906h, TC-BAL-906e, TC-BAL-906f, TC-BAL-926e, TC-BAL-907h,
               TC-BAL-907e, TC-BAL-907f, TC-BAL-936e, TC-BAL-908f, TC-BAL-951h, TC-BAL-951f,
               TC-BAL-952h, TC-BAL-952e, TC-BAL-952f, TC-BAL-954f, TC-BAL-955f, TC-BAL-957h,
               TC-BAL-957e, TC-BAL-957f, TC-BAL-958h, TC-BAL-958e, TC-BAL-958f
               (29 TCs — todos unit, sin DOM)
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Es el insumo de todo lo demás: el módulo de presentación (EP-02) solo pinta lo que
               esta función devuelve. Es aritmética pura y testeable sin React, así que se cierra
               primero y con el 100 % de ramas antes de tocar la UI.

## EP-02 — Módulo de Balance en la grilla (presentación + recálculo en vivo)   [status: done]
  Delivers:    US-908
  FRs:         FR-908
  Makes pass:  TC-BAL-908h, TC-BAL-908e, TC-BAL-935h, TC-BAL-935f, TC-BAL-951e, TC-BAL-953e,
               TC-BAL-954h, TC-BAL-954e, TC-BAL-955h, TC-BAL-956h, TC-BAL-956e, TC-BAL-956f
               (12 TCs — e2e a 1440px)
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Consume EP-01. Aquí nacen `BalanceModule`/`BalanceRow`, el código de color por signo
               y la garantía de que editar una celda recalcula en vivo sin recargar (FR-908 sale
               "gratis" del `useMemo` + Zustand, pero hay que demostrarlo contra el DOM real).

## EP-03 — Separación visual del bloque Transferencia   [status: done]
  Delivers:    US-904
  FRs:         FR-904
  Makes pass:  TC-BAL-904h, TC-BAL-904e, TC-BAL-904f, TC-BAL-953h, TC-BAL-953f, TC-BAL-955e
               (6 TCs — e2e)
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Va al final porque dos de sus TCs (TC-BAL-904f, TC-BAL-955e) afirman la AUSENCIA del
               `balance-module` en móvil (≤760px): no se pueden escribir hasta que el módulo exista
               (EP-02). El separador en sí es un cambio de layout aislado, sin dependencia de datos.

---

## Notas de ejecución

- **Sin dependencias nuevas** (restricción de `01_REQUIREMENTS.json`): Next 15 / React 19 / Tailwind v4 /
  Zustand / TypeScript, los ya presentes.
- **El balance NO re-implementa los roll-ups.** `computeBalanceSeries` consume `typeTotals` de
  `src/domain/rollup.ts` — ese es el mecanismo que las NFR-902 exigen preservar intacto.
- **Conflicto detectado en el UX spec y cómo se resolvió:** el *Component Inventory* pide "Saldo total"
  a 15px, y la sección *Tipografía* del mismo spec exige "sin tamaños tipográficos nuevos"
  (NFR-906/ux-consistency). Se resuelve usando la utilidad EXISTENTE `.label` (0.8125rem ≈ 13px),
  que es mayor que la base de la grilla (0.74rem ≈ 11.8px) sin introducir un tamaño nuevo. Cumple
  ambas: "más grande que el resto" y "de la escala existente".
- **`--transfer` del spec = `--type-transfer` del código** (vía `typeColorVar("transfer")`).
  El spec nombra el rol; el repo ya tiene el token.
- La marca de negativo del balance es `‹‹` (chevrons IZQUIERDOS), deliberadamente distinta de la marca
  de sobre-consumo de la grilla `›`/`››` — TC-BAL-953e afirma que esos glifos NO aparecen en el balance.

## Registro de cierre de epics

- **EP-01 — done (2026-07-25).**
  `npx vitest run --project app --reporter verbose tests/domain/balance.test.ts` →
  **Tests 29 passed (29)**, `Test Files 1 passed (1)` — los 29 TCs de `Makes pass` en verde.
  Cobertura de `src/domain/balance.ts`: **100 % stmts · 100 % branch · 100 % funcs · 100 % lines**
  (el `coverage_goal` del plan de pruebas pedía 100 % de ramas).
  Archivos: `src/domain/balance.ts`, `tests/domain/balance.test.ts`.

  **Incidencia externa encontrada en esta frontera (NO la causa esta feature).**
  La suite unit completa queda en `1 failed | 181 passed`: falla `TC-BE-084h` de la feature
  `backend`, que afirma `npm audit --audit-level=high` → exit 0. Un aviso publicado después del
  2026-07-24 (GHSA-mh99-v99m-4gvg, `brace-expansion`) mete 18 vulns "high", todas por
  devDependencies. Registrado como **backend/BG-001** (severidad medium: cero rutas de
  producción) y analizado en `aitri/BACKLOG.md`. Se PROBÓ el override a `brace-expansion@5.0.8`
  (deja el audit en 0) y se REVIRTIÓ porque rompe el proveedor de cobertura. Efecto colateral a
  tener presente: mientras ese test falle, vitest no imprime la tabla de cobertura, así que la
  cifra de arriba se midió corriendo `--coverage` sobre `tests/domain tests/integration`.

- **EP-02 — done (2026-07-25).** Los 12 TCs en verde.
  `npx playwright test tests/e2e/balance.spec.ts` → **18 passed** (los 6 de EP-03 incluidos).
  Requirió resolver el conflicto de contraste descrito abajo (el usuario eligió la opción A).
  Archivos: `src/components/BalanceModule.tsx` (nuevo), `src/components/gridLayout.ts` (nuevo,
  geometría compartida para evitar un import circular), `src/components/BudgetGrid.tsx` (monta el
  módulo), `tests/e2e/balance.spec.ts` (nuevo).

- **EP-03 — done (2026-07-25).** Los 6 TCs en verde dentro de la misma corrida: TC-BAL-904h,
  904e, 904f, 953h, 953f, 955e. Archivo tocado: `src/components/BudgetGrid.tsx`
  (`TransferSeparator`, 24px + hairline, antes de la fila de tipo TRANSFERENCIAS).

- **Regresión del proyecto completo: `npx playwright test` → 207 passed, 0 failed, 0 flaky.**
  Ninguna aserción previa de otra feature se tocó ni se rompió.
  En una corrida intermedia, TC-BAL-908e salió *flaky* (pasaba solo en el reintento): tras el drag
  de promoción, el clic que abre el editor se perdía contra la posición vieja de la fila mientras
  React re-renderizaba. Corregido con el patrón `toPass` de Playwright. Un test que solo pasa en
  el reintento miente, así que no se dejó así.

---

## RESUELTO — conflicto entre requisitos aprobados (el usuario eligió la opción A)

**TC-BAL-956e no puede pasar a la vez que TC-BAL-935h y TC-BAL-935f.** No es un defecto de
implementación: son dos requisitos aprobados que se contradicen, porque el UX spec afirmó unos
valores de contraste que no se habían medido sobre la superficie real del módulo.

- `TC-BAL-935h` fija `color === var(--success)`; `TC-BAL-935f` fija `color === var(--error)`.
- `TC-BAL-956e` exige que todo rol de texto mida **≥4.5:1** sobre `--bg-sunken`.
- El UX spec (sección *Design Tokens*) afirma: *"Todos los roles ≥4.5:1 — confirmed"*.

**Medición real (calculada, no estimada), tema CLARO sobre `--bg-sunken` (#f1f1f3):**

| token | valor claro | ratio | AA (≥4.5) |
|---|---|---|---|
| `--fg-secondary` | #55555d | 6.55 | pasa |
| `--type-transfer` | #2f6db4 | 4.69 | pasa |
| `--success` | #2f7d53 | **4.45** | **FALLA** |
| `--error` | #c4453e | **4.36** | **FALLA** |

En tema OSCURO los cuatro roles pasan con holgura (6.21 – 9.28). El fallo es exclusivo del claro.

De dónde viene el error del spec: `--success` sobre BLANCO da 5.03:1 y sobre `--bg` (#f7f7f8) da
4.69:1 — ahí es donde vive la card "DISPONIBLE" que el spec tomó como referencia. Sobre la
superficie HUNDIDA, que es la que el propio spec exige para el módulo, cae a 4.45:1.

**Ya aplicado (dentro de mi alcance, sin decisión pendiente):** el módulo NO sigue el resaltado del
mes filtrado. Ese tinte era una adición mía, no la pedía el spec, y componía la superficie hasta
#e4e4e6, donde los ratios caen a 3.96 (`--success`), 3.88 (`--error`) y 4.17 (`--type-transfer`) —
o sea, arrastraba también al azul. Quitarlo reduce el conflicto a su núcleo irreducible.

**Opciones (ninguna se tomó — cambian el spec o el set de TCs):**

- **(A) Añadir variantes AA-seguras del mismo tono** (p. ej. `--success-strong` #2b704c → 5.28:1 y
  reutilizar `--state-over` #ad3932 para el rojo, que ya existe y ya es AA-seguro sobre las
  superficies de la grilla). **Hay precedente directo en este repo:** la feature
  `budget-state-color` añadió `--state-warning`/`--state-over` exactamente por este motivo
  (su ADR-03: "se AGREGAN en vez de redefinir --warning/--error, que se usan en toda la app").
  Coste: TC-BAL-935h/935f fijan `--success`/`--error` por nombre, así que hay que re-derivar
  Fase 3 → re-abre y cascada-invalida. Cuidado adicional: usar `--state-over` haría que el rojo del
  balance sea el MISMO que el de sobre-consumo de la grilla, lo que roza el espíritu de NFR-903.
- **(B) Oscurecer `--success` y `--error` globalmente.** Radio de impacto amplio: los usa toda la
  app (card DISPONIBLE, StorageBanner, dashboard, registro) y obliga a re-verificar el AA de las
  otras features.
- **(C) Aceptar 4.45/4.36 como desviación consciente** y relajar TC-BAL-956e. Es la única que no
  toca código, pero incumple WCAG AA en tema claro y contradice la NFR-906; quedaría como
  `technical_debt` explícito.

**DECISIÓN DEL USUARIO (2026-07-25): opción A.** Implementado así:

- `src/app/globals.css` añade `--success-strong` (claro `#2d7650` → **4.87:1**; oscuro `#5fbe82`,
  igual que el base) y `--error-strong` (claro `#ad3932` → **5.46:1**; oscuro `#ec6a66`). Se
  AÑADEN, no se redefinen `--success`/`--error`, que usa toda la app. En tema oscuro las variantes
  coinciden con su token base, así que ahí **no hay ningún cambio visual**.
- `BalanceModule` los consume; `01_UX_SPEC.md` y `03_TEST_CASES.json` quedaron actualizados con la
  tabla de contraste **medida** y una nota que deja constancia del error previo del spec.
- El set de TCs sigue siendo **47**: no se creó, renombró ni omitió ninguno; solo se corrigió el
  texto de TC-BAL-935h, 935f y 956e para nombrar los tokens correctos.

**Fase 4 completada** (`aitri feature complete balance 4` → OK). Queda pendiente la aprobación
humana, ver abajo.

---

## Pendiente al cerrar la sesión — dos aprobaciones que exigen un humano en terminal

Editar `01_UX_SPEC.md` y `03_TEST_CASES.json` deja esas dos fases en **DRIFT**, y Aitri bloquea la
re-aprobación en modo agente por diseño: *"an agent cannot re-approve after an in-place edit"*.
No se intentó rodear el gate. Un humano debe revisar el diff y correr:

```
aitri feature approve balance ux
aitri feature approve balance tests
```

Ojo: re-aprobar `ux` **cascade-invalida** las fases downstream, así que hay que re-derivarlas
después. La alternativa sancionada para un agente es `aitri feature run-phase balance ux`, que
re-abre la fase y permite re-derivar limpio.
