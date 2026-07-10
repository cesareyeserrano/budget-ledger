# BUILD_PLAN — budget-state-color

Working file (no Aitri gate). Execution state for Phase 4. On resume: continue from the first
non-`done` cluster.

**Layer roadmap inside every cluster:** skeleton → integración → hardening (tests + gates).

---

## C1 — La regla de umbral vive en el dominio · `status: done`

**FR:** FR-401 (parte lógica) · **TCs:** TC-BSC-401h, TC-BSC-401e, TC-BSC-401f, TC-BSC-411e

- **Nuevo:** `src/domain/budgetState.ts` — `BudgetState`, `OVER_HARD_RATIO`, `budgetState(budget, actual)`.
- **Nuevo:** `tests/domain/budget-state.test.ts` — fronteras 89/100/101/119/120/121 % (el 120 000 se
  deriva de `OVER_HARD_RATIO`, no se escribe a mano) + degenerados (presupuesto 0, ejecutado 0,
  negativos) + volumen 6 000 derivaciones.

**Por qué primero:** es la única fuente de verdad del estado; el color (C3), el glifo (C3) y la
leyenda (C5) derivan del mismo enum. Nada de UI se puede escribir bien antes. Entra al gate de
coverage (`include: src/domain/**`) por vivir aquí (ADR-01).

---

## C2 — Tokens de estado + prueba de contraste AA · `status: done`

**FR:** soporte de FR-401/FR-402 · **NFR:** NFR-403 · **TCs:** TC-BSC-453h

- **Modificado:** `src/app/globals.css` — se **agregan** `--state-warning` (#9E4708 / #E0A458) y
  `--state-over` (#AD3932 / #EC6A66) en `:root` y `.dark`. `--warning` y `--error` quedan intactos (ADR-03).
- **Test:** el TC **lee los tokens desde `globals.css`** y **calcula** las cuatro superficies por
  composición real del tinte (`--accent` al 6% sobre la fila), en vez de asumir los hex del spec.
  16 ratios ≥ 4.5:1.

**Por qué segundo:** la UI de C3 no puede referenciar variables que no existen, y el gate de AA debe
fallar antes de que exista una sola celda pintada, no después.

---

## C3 — Color y glifo en la celda `Ejec.` · `status: done`

**FR:** FR-401, FR-402 · **NFR:** NFR-402, NFR-403 (1.4.1)
**TCs:** TC-BSC-402h, TC-BSC-402e, TC-BSC-402f, TC-BSC-452h, TC-BSC-452e, TC-BSC-452f, TC-BSC-453f

- **Modificado:** `src/components/BudgetGrid.tsx`
  - `ejecColor(type, b, e)` — misma firma; **solo la rama `expense`** delega en `budgetState()`.
    Ingreso y Transferencia quedan literalmente iguales (NFR-402).
  - `stateGlyph(state)` — nuevo, deriva del **mismo** `BudgetState` que el color (ADR-02/06).
  - `Cell` gana `glyph?: string`, dibujado antes del monto, `aria-hidden`, `flex-none`, `0.75rem`,
    `margin-right: 4px`. La celda conserva `justify-end` + `whitespace-nowrap`.
- **Nuevo:** `tests/e2e/budget-state-color.spec.ts` — siembra `localStorage` con un dataset a medida
  (110 %, 130 %, 100 % exacto, 120 % exacto, 7 cifras, ingreso al 130 %, transferencia) y afirma
  **colores computados** reales, no clases.

**Riesgo #1 (declarado):** la sub-celda mide 108 px. `TC-BSC-402e` verifica `scrollWidth ≤ clientWidth`
en la celda de 7 cifras con `›› 1.300.000` a 1440 px.

---

## C4 — Superficie de estructura en las filas no editables · `status: done`

**FR:** FR-404 · **NFR:** NFR-403 (AA en la app real), NFR-404 · **TCs:** TC-BSC-404h, TC-BSC-404e,
TC-BSC-404f, TC-BSC-453e, TC-BSC-454f

- **Modificado:** `src/components/BudgetGrid.tsx` — `NodeRow` y `TypeTotalRow` aplican `--bg-sunken`
  a **toda** la fila (columna fija + celdas de mes) cuando `!row.leaf`. Predicado = el mismo que ya
  gobierna la edición (ADR-05), así la afordancia no puede desalinearse del comportamiento.
  El tinte del mes resaltado se compone **sobre** la superficie de la fila (por eso la celda
  resaltada de un padre es #E4E4E6, la peor superficie clara).
- Las filas de tipo **migran** de `bg-elevated` a `bg-sunken` — cambio visual buscado (ADR-04).

**Riesgo #2 (declarado):** alguna aserción previa puede fijar `bg-elevated` en la fila de tipo. Se
actualiza y se **declara `superseded`** en `04_BUILD_REPORT.json` (lo exige TC-BSC-455f). No se esconde.

**Por qué después de C3:** C4 crea la superficie más oscura de la grilla; medir AA (453e) sobre la app
real solo tiene sentido cuando el color de estado ya se pinta.

---

## C5 — Leyenda única en el pie de la grilla · `status: done`

**FR:** FR-403 · **TCs:** TC-BSC-403h, TC-BSC-403e, TC-BSC-403f

- **Modificado:** `src/components/DesktopShell.tsx` — `GridFooter` gana una línea con
  `data-testid="grid-legend"`: los tres estados nombrados, cada uno con su **punto de color** y su
  **glifo**, reutilizando el `LegendDot` que el pie ya usa. Una sola vez, nunca por fila.

---

## C6 — Regresión, gates y manifiesto · `status: done`

**NFR:** NFR-401, NFR-404, NFR-405 · **TCs:** TC-BSC-451h, TC-BSC-451e, TC-BSC-451f, TC-BSC-454h,
TC-BSC-454e, TC-BSC-455h, TC-BSC-455e, TC-BSC-455f

- Regresión del Registro (propagación de color por tipo, intacta) y de que los tokens de estado
  **no se filtran** fuera de la grilla.
- Edición inline + persistencia + filtro Mes/Año + roll-ups + Recientes: idénticos.
- Suite completa en verde; `typecheck`, `lint`, `coverage ≥80%`, `smoke` declarados como
  `quality_gates` en `04_BUILD_REPORT.json`.

**Entorno:** parar el dev server antes de correr e2e/build (el `next build` pisa el `.next` del
`next dev`). La app corre en 3100; Playwright levanta su propio server en 3220.

---

## Observación levantada al usuario (fuera de alcance de esta feature)

El encabezado de la vista Resumen (`DesktopShell`, no el pie) tiene su propia leyenda con un punto
`--error` rotulado **"Sobre presupuesto"**. Tras esta feature, "sobre presupuesto" ya no es un solo
rojo `--error`, sino ámbar/rojo con glifo. Esa leyenda queda desalineada del nuevo código de estado.
**No se toca aquí**: cambiarla es una modificación de comportamiento visible que no cubre ningún FR
aprobado. Candidata a backlog.

---

## Progreso

| Cluster | Estado | Nota |
|---|---|---|
| C1 dominio | done | 4/4 TCs verdes. Función total; el 120 % se deriva de `OVER_HARD_RATIO`. |
| C2 tokens + AA | done | 16/16 ratios ≥4.5:1. El test PARSEA `globals.css` y COMPONE el tinte del 6 %: `#e4e4e6` y `#eaeaeb` salieron del cálculo, no del spec. |
| C3 color + glifo | done | Riesgo #1 **descartado por medición**: `›› 1.300.000` da `scrollWidth ≤ clientWidth` en la sub-celda de 108px. |
| C4 superficie | done | Riesgo #2 **no se materializó**: la suite completa (162 e2e) pasa sin tocar una sola aserción previa. Cero `superseded` que declarar. |
| C5 leyenda | done | Una sola `grid-legend`, con color Y glifo por estado. |
| C6 regresión + gates | done | 83 unit/integration + 162 e2e verdes. typecheck/lint exit 0, coverage 93.25 % global y **100 % de ramas** en `budgetState.ts`. |

## Hallazgos del build (registrados, no escondidos)

1. **El test de AA falló primero por el PARSER, no por el diseño.** Chrome devuelve un `color-mix()`
   resuelto como `color(srgb 0.89498 0.89498 0.903059)`, no como `rgb()`. Leerlo como enteros daba
   3.39:1. Corregido el parser: `0.89498 × 255 = 228` → la superficie real ES `#e4e4e6`, exactamente
   la peor superficie que el diseño predijo. El TC ahora fija ese valor además del ratio.
2. **La siembra de `localStorage` tenía que ser idempotente.** `addInitScript` corre en CADA
   navegación: sin una guarda, la recarga de TC-BSC-454h pisaba la edición que el test acababa de
   hacer, y la persistencia habría dado un falso negativo.
3. **Riesgo #2 (aserciones `bg-elevated`) no ocurrió.** Ninguna suite previa fijaba la superficie de
   la fila de tipo. `technical_debt` y las notas de `superseded` quedan vacías **porque lo están**,
   no porque se hayan omitido.
