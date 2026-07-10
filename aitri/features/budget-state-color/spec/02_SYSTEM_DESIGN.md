# Technical Design Document (TRD / SDD)
## Feature: budget-state-color — el color señala el estado del presupuesto

> **Naturaleza:** cambio a un sistema EXISTENTE, deliberadamente pequeño. Sin stack nuevo, sin
> dependencias nuevas, sin cambios de datos. El trabajo son ~3 archivos: una función pura de dominio,
> su adopción en `BudgetGrid.tsx`, y dos tokens + una leyenda.

---

## Executive Summary

No hay decisiones de stack que tomar: la feature se apoya entera en lo ya sellado por `ux-consistency`.
Lo que **sí** hay que decidir es **dónde vive la regla de estado** y **cómo se expresa**, porque de eso
depende que el color y el glifo no puedan desincronizarse y que la lógica quede bajo el gate de coverage.

| Capa | Tecnología | Versión | Razón |
|---|---|---|---|
| Framework | Next.js | 15.1.6 | Existente. No se toca. |
| UI runtime | React | 19.0.0 | Existente. |
| Lógica de dominio | TypeScript puro (`src/domain/`) | 5.7.3 | La regla de umbral es aritmética pura: no necesita React ni CSS. Va al dominio, donde el gate `coverage ≥80%` (vitest, `include: src/domain/**`) la cubre automáticamente. |
| Estilos/tokens | Tailwind v4 + CSS custom properties | 4.0.0 | Los tokens de estado se **agregan**; no se redefine ninguno. |
| Tests | vitest (unit) + Playwright (e2e) | 3.0.4 / 1.50 | Los runners ya declarados del proyecto. |

**Dependencias nuevas: ninguna.** **Cambios de datos: ninguno.**

La decisión central (ADR-02): el dominio devuelve un **estado semántico** (`within` / `over_soft` /
`over_hard`), no un color. La capa de UI mapea ese estado a **color** y a **glifo**. Así el canal
redundante de WCAG 1.4.1 no puede quedar desalineado del color: ambos derivan del mismo valor.

---

## System Architecture

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Navegador — Next.js client (sin backend, sin red)                             │
│                                                                                │
│  ┌────────────── CAPA DE TOKENS (globals.css) ─────────────────────────────┐  │
│  │  :root / .dark                                                           │  │
│  │   + --state-warning : #9E4708 / #E0A458   ← NUEVO (aditivo)              │  │
│  │   + --state-over    : #AD3932 / #EC6A66   ← NUEVO (aditivo)              │  │
│  │     --bg-sunken     : #F1F1F3 / #0F0F12   ← reutilizado (FR-404)         │  │
│  │     --warning / --error  ← INTACTOS (uso actual en toda la app)          │  │
│  └───────────────────────────────┬─────────────────────────────────────────┘  │
│                                   │ (var(--…))                                  │
│  ┌──────────── DOMINIO (puro, sin React ni CSS) ────────────────────────────┐  │
│  │  src/domain/budgetState.ts                                                │  │
│  │    export type BudgetState = "within" | "over_soft" | "over_hard"         │  │
│  │    export function budgetState(budget, actual): BudgetState               │  │
│  │      · actual/budget ≤ 1        → "within"                                │  │
│  │      · 1 < ratio < 1.2          → "over_soft"                             │  │
│  │      · ratio ≥ 1.2              → "over_hard"                             │  │
│  │      · budget = 0 && actual > 0 → "over_hard"  (sin dividir por cero)     │  │
│  │  ← FR-401. Cubierto por el gate coverage (include: src/domain/**)         │  │
│  └───────────────────────────────┬─────────────────────────────────────────┘  │
│                                   │ (BudgetState)                               │
│  ┌──────────── PRESENTACIÓN (src/components/) ──────────────────────────────┐  │
│  │  BudgetGrid.tsx                                                           │  │
│  │   · ejecColor(type,b,e)  → mapea BudgetState → var(--state-*) | --fg      │  │
│  │   · stateGlyph(state)    → "" | "›" | "››"            (FR-402)            │  │
│  │   · <Cell glyph=…>       → dibuja el glifo antes del monto                │  │
│  │   · NodeRow / TypeTotalRow → superficie `bg-sunken` si !row.leaf (FR-404) │  │
│  │  DesktopShell.tsx                                                         │  │
│  │   · GridFooter → leyenda única: color + glifo           (FR-403)          │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  Estado (Zustand) · dominio (rollup/tree) · persistencia (localStorage)        │
│                       ── SIN CAMBIOS ──                                        │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Responsabilidades**

- **`src/domain/budgetState.ts` (nuevo).** Única fuente de verdad de la regla de umbral. Aritmética pura,
  sin React ni CSS. Es la razón por la que FR-401 (tipo `logic`) puede tener tests unitarios de valores
  frontera y quedar bajo el gate de coverage.
- **`ejecColor` (existente, modificado).** Traduce `BudgetState` → variable CSS, **solo para gastos**.
  Ingreso y Transferencia conservan su lógica intacta (NFR-402).
- **`stateGlyph` (nuevo, en el componente).** Traduce el **mismo** `BudgetState` → glifo. Deriva del mismo
  valor que el color: no pueden contradecirse.
- **`Cell` (existente, modificado).** Recibe un `glyph` opcional y lo dibuja antes del monto, `aria-hidden`.
- **`NodeRow` / `TypeTotalRow` (existentes, modificados).** Aplican `bg-sunken` a toda la fila cuando la
  fila **no es editable** (`!row.leaf`).
- **`GridFooter` (existente, modificado).** Una leyenda con los tres estados: color **y** glifo.

---

## Data Model

**Esta feature no cambia el modelo de datos, ni la persistencia, ni los roll-ups.** El estado de
presupuesto es una **derivación pura** de dos números que ya existen.

### Contrato de preservación (NO cambia)
```ts
// src/domain/types.ts — INTACTO
interface LedgerNode {
  id: string; type: NodeType; level: NodeLevel; parentId: string | null;
  name: string; icon: string | null; order: number; system?: boolean;
  budget: Record<MonthKey, number>;   // ← entrada de la derivación
  actual: Record<MonthKey, number>;   // ← entrada de la derivación
}
// Persistencia: localStorage 'ledger.*'. Formato JSON. SIN migración.
// rollupBudget / rollupActual / typeTotals  → INTACTOS
```

### Delta introducido
**Ninguno en los datos.** Se agrega un **tipo derivado**, que no se persiste ni se serializa:

```ts
// src/domain/budgetState.ts (NUEVO)
export type BudgetState = "within" | "over_soft" | "over_hard";
```

Invariantes preservados: claves de localStorage, jerarquía `group → category → sub`, nodos `system`,
roll-ups de padres. Consistencia: **fuerte / síncrona en memoria** (sin cambio).

---

## API Design

App frontend-only: la "API" es la superficie de módulos exportados.

### Contrato PRESERVADO (firmas que NO cambian)
```ts
// domain: rollupBudget, rollupActual, typeTotals, isLeaf, childrenOf  → INTACTOS
// store:  setLeafAmount, createNode, renameNode, deleteNode, moveNode → INTACTOS
// components/format.ts: money, cellNum, typeColorVar, typeTextColorVar, typeFillVar → INTACTOS
```

### Firmas NUEVAS / MODIFICADAS
```ts
// ── src/domain/budgetState.ts (NUEVO — FR-401) ─────────────────────────────
export type BudgetState = "within" | "over_soft" | "over_hard";

/** Umbrales del estado de sobre-consumo (FR-401). Exportados para que el test los use, no los repita. */
export const OVER_HARD_RATIO = 1.2;

/**
 * Estado de consumo de un presupuesto de GASTO.
 *  ratio ≤ 1        → "within"     (incluye el 100% exacto)
 *  1 < ratio < 1.2  → "over_soft"
 *  ratio ≥ 1.2      → "over_hard"
 *  budget = 0 y actual > 0 → "over_hard"  (no se divide por cero)
 *  actual = 0       → "within"    (el em-dash lo resuelve la capa de UI)
 */
export function budgetState(budget: number, actual: number): BudgetState;

// ── src/components/BudgetGrid.tsx (MODIFICADO) ─────────────────────────────
// ejecColor: misma firma pública; para expense delega en budgetState()
function ejecColor(type: NodeType, b: number, e: number): string;

// NUEVO, local al componente — deriva del MISMO BudgetState que el color (FR-402)
function stateGlyph(state: BudgetState): "" | "›" | "››";

// Cell: props += glyph?: string   (se dibuja antes del monto, aria-hidden)
function Cell(props: { …existentes…; glyph?: string }): JSX.Element;

// ── src/components/DesktopShell.tsx (MODIFICADO — FR-403) ──────────────────
// GridFooter: += una línea de leyenda (color + glifo) reutilizando <LegendDot>
```

**Acción de usuario → operación de respaldo.** Ninguna acción nueva: el estado es una *lectura*. Editar una
celda (`setLeafAmount`) recalcula la derivación en el siguiente render, como cualquier otro derivado.

---

## Security Design

- **Auth:** ninguna — app single-user local por diseño. Sin cambio.
- **Superficie de red:** cero. La feature no agrega dependencias, ni fetch, ni assets.
- **Validación de entrada:** `budgetState` recibe dos `number` que ya vienen validados por el dominio
  (`setLeafAmount` aplica `Math.max(0, Math.round(...))`). Aun así la función es **total**: está definida
  para `budget = 0`, `actual = 0` y valores negativos (que el dominio no produce), sin lanzar ni devolver
  `NaN`/`Infinity` al llamador.
- **XSS/inyección:** el glifo (`›`/`››`) es una **constante del código**, nunca dato del usuario, y se
  renderiza como texto por React. No se usa `dangerouslySetInnerHTML`.
- **Datos en reposo:** sin cambio (localStorage sin cifrar, single-user local).

La feature **no amplía la superficie de ataque**: es una función pura y dos reglas de estilo.

---

## Performance & Scalability

- **Coste de la derivación:** `budgetState` es una división y dos comparaciones — **O(1)** por celda. La
  grilla ya calcula `rollupBudget`/`rollupActual` por celda (12 meses × N nodos); el estado se deriva de
  esos dos valores ya computados, sin recorridos adicionales del árbol.
- **Sin re-renders nuevos:** no se agrega estado de React, ni efectos, ni contexto. El glifo y el color se
  calculan durante el render que ya ocurre.
- **Sin coste de bundle:** cero dependencias; el módulo nuevo son ~15 líneas.
- **Superficie de fila (FR-404):** una clase CSS condicional. Cero coste de layout: **no cambia alturas,
  ni anchos, ni el número de nodos** — solo `background-color`.
- **Cota a vigilar:** la sub-celda de mes mide **108px**. El glifo (`0.75rem` + `4px` de margen ≈ 14px)
  reduce el espacio del monto. Un monto de 7 cifras (`1.250.000`) con `››` debe seguir cabiendo. Es la
  única restricción de rendimiento/layout de la feature, y está declarada como riesgo abajo.

---

## Deployment Architecture

- **Modelo de despliegue (explícito):** **web estática Next.js** (`next build` + `next start`), idéntico al
  actual. **Sin backend, sin contenedor nuevo, sin serverless.** Persistencia en `localStorage`.
- **Dependencias de build:** **ninguna nueva**. `package.json` y `package-lock.json` no se tocan.
- **Entornos:** dev (`next dev -p 3100`). Artefacto de despliegue idéntico al de features previas.
- **CI/CD:** `.github/workflows/ci.yml` (preexistente) corre `typecheck`, `lint`, `test:run`, `build` y
  `e2e` en push/PR a `main`. Smoke: la app responde 200 en `/`.
- **Observabilidad:** app cliente sin proceso long-running; no hay endpoint `/health` porque no hay
  servicio propio. Sin logging nuevo (la derivación es pura y no puede fallar de forma observable).

---

## Risk Analysis

### Top riesgos

1. **El glifo desborda la celda de 108px.** `›› 1.250.000` puede recortarse o romper la alineación
   `tabular-nums`. *Mitigación:* el glifo es `flex-none` a `0.75rem`; la celda conserva `justify-end` y
   `whitespace-nowrap`; **test e2e explícito** con un monto de 7 cifras a 1440px.
2. **Cambiar las filas de tipo de `bg-elevated` a `bg-sunken` rompe aserciones previas.** *Mitigación:*
   correr la suite completa; si alguna aserción fija la superficie vieja, actualizarla y **declararla como
   superseded** en el build report (no esconderla).
3. **`budget = 0` produce `Infinity`/`NaN`.** *Mitigación:* la función es total y se testea explícitamente
   en los tres casos (`0/0`, `0/>0`, negativos).
4. **El color y el glifo se desincronizan** (p. ej. alguien cambia un umbral en un solo sitio).
   *Mitigación:* ADR-02 — ambos derivan del **mismo** `BudgetState`; los umbrales viven en una constante
   exportada que el test importa en vez de repetir.
5. **AA se rompe al añadir una superficie.** Ya ocurrió dos veces en el diseño. *Mitigación:* NFR-403 exige
   ≥4.5:1 en las **cuatro** superficies; el test lo calcula, no lo asume.

### Architectural Decision Records

**ADR-01: Dónde vive la regla de umbral**
- Context: FR-401 es de tipo `logic` y su gate exige tests unitarios de valores frontera. Hoy la regla
  vive *inline* dentro de `ejecColor`, en el componente.
- Option A: Dejarla inline en `ejecColor` (componente React) — cero archivos nuevos, pero solo testeable a
  través de e2e o de un render; queda **fuera** del gate de coverage (`include: src/domain/**`).
- Option B: Extraerla a `src/domain/budgetState.ts` como función pura — un archivo más, pero testeable con
  vitest sin DOM, cubierta por el gate de coverage, y reutilizable por los KPIs (BL-004) sin duplicar la regla.
- **Decision: Option B.** El requisito exige tests de frontera; ponerla en el dominio es lo que los hace
  baratos y mecánicamente verificados.
- Consequences: habilita boundary tests directos y una futura reutilización en los resúmenes; obliga a que
  el dominio NO conozca CSS (ver ADR-02).

**ADR-02: Qué devuelve la regla — color o estado**
- Context: el color (FR-401) y el glifo (FR-402) deben coincidir siempre; si divergen, la señal miente y
  WCAG 1.4.1 queda incumplido en silencio.
- Option A: `budgetState()` devuelve directamente la variable CSS (`"var(--state-over)"`) — un paso menos,
  pero mete CSS en el dominio y obliga a derivar el glifo con una **segunda** condición que puede divergir.
- Option B: devolver un **enum semántico** (`"within" | "over_soft" | "over_hard"`) y mapearlo en la UI a
  color **y** a glifo, ambos desde el mismo valor.
- **Decision: Option B.** Hace **imposible** que el color y el canal redundante se contradigan, que es
  precisamente el fallo silencioso que WCAG 1.4.1 busca evitar.
- Consequences: dos funciones de mapeo triviales en la capa de UI; el dominio queda libre de CSS y el
  estado se puede reutilizar (BL-004) sin arrastrar tokens.

**ADR-03: Tokens de estado — redefinir o agregar**
- Context: el ámbar y el rojo deben cumplir AA sobre **cuatro** superficies. Medido, `--warning` (#B45309)
  y `--error` (#C4453E) fallan sobre la celda resaltada de una fila padre (4.18:1 y 4.09:1).
- Option A: Redefinir `--warning` / `--error` con valores más oscuros — un token menos, pero esos tokens se
  usan en toda la app (StorageBanner, dashboard, errores del registro) y el `no_go_zone` de esta feature
  prohíbe redefinirlos; cambiarlos arrastraría regresiones fuera del alcance.
- Option B: **Agregar** `--state-warning` / `--state-over`, de uso exclusivo del estado en la grilla,
  conservando el hue y ajustando solo la luminancia.
- **Decision: Option B.** Respeta el `no_go_zone`, acota el radio de explosión a la grilla, y deja los
  tokens existentes con su semántica actual.
- Consequences: dos tokens más en `globals.css`; hay que documentar cuándo usar `--error` (error de
  aplicación) vs `--state-over` (estado de presupuesto).

**ADR-04: Qué superficie usa la fila no editable**
- Context: FR-404 pide distinguir estructura de dato editable. Las filas de tipo hoy usan la capa
  **elevada** (`--bg-elevated`).
- Option A: Capa **elevada**, como las filas de tipo hoy — consistente con lo existente y sin migrar nada,
  pero **medido: falla AA en oscuro** (`--state-over` sobre la celda resaltada de una fila elevada da
  **4.14:1**), porque en oscuro "elevado" es más claro y el realce lo aclara aún más.
- Option B: Capa **hundida** (`--bg-sunken`), la misma del encabezado — todas las filas no editables sobre
  una única superficie; peor caso medido **5.22:1** en oscuro y **4.85:1** en claro.
- **Decision: Option B.** La accesibilidad decide: A es inviable. Además unifica encabezado + estructura y
  deja el lienzo exclusivamente para el dato editable.
- Consequences: las filas de tipo **migran** de elevada a hundida (cambio visual declarado, riesgo #2); la
  jerarquía visual queda: hundido = estructura, lienzo = dato editable, elevado = overlays.

**ADR-05: Predicado de "fila no editable"**
- Context: el usuario pidió "solo para padres con hijos". Pero `isLeaf()` define: `sub → true`,
  `category → true si no tiene hijos`, **`group → siempre false`** (ni siquiera vacío).
- Option A: `row.expandable` (= tiene hijos) — literal a lo pedido, pero deja un **grupo vacío** con
  apariencia de fila editable cuando en realidad **no lo es**: el usuario intentaría editarlo, que es
  exactamente el defecto que FR-404 corrige.
- Option B: `!row.leaf` (= no editable) — es el **mismo predicado que ya gobierna la edición** en el
  código (`onStart={() => row.leaf && …}`), así que la afordancia no puede desalinearse del comportamiento.
- **Decision: Option B.** La afordancia debe reflejar la regla real de editabilidad, no una aproximación.
- Consequences: un grupo vacío recibe superficie de estructura (registrado en `idea_gaps` para confirmar);
  la apariencia y el comportamiento comparten una única condición.

**ADR-06: Canal redundante del estado**
- Context: ámbar y rojo son un par rojo-verde: indistinguibles para ≈1 de cada 12 hombres.
- Option A: Solo color — cero elementos extra, pero incumple **WCAG 1.4.1** y hace que la gradación de
  gravedad sea invisible para esos usuarios.
- Option B: Glifo de **forma** (`›` / `››`) antes del monto — un `<span>` por celda pasada, `aria-hidden`
  (el dato ya lo portan el monto y el `Pres.` adyacente).
- **Decision: Option B.** Es un requisito de accesibilidad, no una preferencia. Se eligió un glifo y no un
  número porque el usuario descartó el porcentaje por ruido.
- Consequences: coste de ~14px por celda pasada (riesgo #1); la señal sobrevive en escala de grises.

---

## Failure Blast Radius

Component: `src/domain/budgetState.ts` (regla de umbral)
Blast radius: si devuelve un estado equivocado, **todas** las celdas de gasto se colorean y marcan mal.
User impact: el usuario ve un desvío donde no lo hay, o —peor— **no** ve uno que sí existe.
Recovery: es una función pura sin dependencias; los tests unitarios de frontera (89/100/101/119/120/121 %)
la fijan. Un fallo se detecta en `verify-run`, nunca en producción silenciosa. No hay pérdida de datos:
la derivación no escribe nada.

Component: Capa de tokens (`--state-warning` / `--state-over` en `globals.css`)
Blast radius: un token mal formado o ausente deja el color sin resolver → la celda hereda el color del
padre y el estado se vuelve invisible.
User impact: el desvío deja de señalarse (fallo **silencioso**: no hay error, solo ausencia de señal).
Recovery: el glifo (`›`/`››`) **sigue presente** — el canal redundante degrada con gracia y el estado sigue
siendo legible. Detectable en build (Tailwind) y por el test de contraste de `NFR-403`.

Component: Persistencia (`data/repository` → localStorage)
Blast radius: sin cambio por esta feature. Si falla, no se persisten ediciones nuevas.
User impact: aviso no bloqueante (`StorageBanner`); la sesión en memoria sigue usable y el estado se sigue
derivando de los datos en memoria.
Recovery: reintento en la siguiente acción.

---

## Technical Risk Flags

[RISK] El glifo desborda la sub-celda de 108px
Conflict: FR-402 requiere un glifo antes del monto, pero la sub-celda de mes mide 108px y un monto de 7
cifras (`1.250.000`) ya la ocupa casi entera; `›› 1.250.000` puede recortarse o romper la alineación tabular.
Mitigation: glifo `flex-none` a `0.75rem` con `4px` de margen; celda con `justify-end` y `whitespace-nowrap`.
Test e2e obligatorio a 1440px con un monto de 7 cifras en estado `over_hard`, verificando que no hay
recorte ni desbordamiento horizontal.
Severity: medium

[RISK] Migrar las filas de tipo de `bg-elevated` a `bg-sunken` rompe aserciones existentes
Conflict: NFR-404/NFR-405 exigen la suite verde, pero FR-404 cambia la superficie de una fila que ya existe
y que otras features pudieron fijar.
Mitigation: correr la suite completa antes de aprobar el build; actualizar solo las aserciones que fijan la
superficie vieja y **declararlas como superseded** en `04_BUILD_REPORT.json`, conservando sus TC ids.
Severity: medium

[RISK] `budget = 0` produce `Infinity` o `NaN`
Conflict: FR-401 se define sobre un ratio `actual/budget`, pero una categoría puede tener presupuesto 0.
Mitigation: `budgetState` es una función **total**: `budget = 0 && actual > 0 → over_hard`; `actual = 0 →
within`; nunca devuelve `NaN`/`Infinity`. Testeada explícitamente en los tres casos.
Severity: low

[RISK] El color y el glifo se desincronizan
Conflict: NFR-403 (WCAG 1.4.1) exige que el canal redundante coincida siempre con el color, pero son dos
mapeos distintos y un cambio de umbral podría tocarse en un solo sitio.
Mitigation: ADR-02 — ambos derivan del **mismo** `BudgetState`, y el umbral vive en la constante exportada
`OVER_HARD_RATIO`, que el test importa en vez de repetir su valor.
Severity: low

[RISK] Añadir la superficie de fila padre vuelve a romper AA
Conflict: NFR-403 exige ≥4.5:1, pero cada superficie nueva reduce el contraste del estado; ya ocurrió dos
veces durante el diseño (el rojo cayó a 4.46:1 y luego a 4.14:1 con la capa elevada).
Mitigation: los tokens se fijaron midiendo contra las **cuatro** superficies (peor caso claro `#E4E4E6`
→ 4.85:1; peor caso oscuro `#212123` → 5.22:1). El test de `NFR-403` **calcula** el ratio, no lo asume, y
cubre las cuatro.
Severity: medium

---

## Traceability Checklist

Cobertura FR → componente/decisión:
- **FR-401** (umbral neutro/ámbar/rojo) → `src/domain/budgetState.ts` (ADR-01/02) + `ejecColor`.
- **FR-402** (marca de forma `›`/`››`) → `stateGlyph` + prop `glyph` de `Cell` (ADR-02/06).
- **FR-403** (leyenda única) → `GridFooter` en `DesktopShell.tsx`.
- **FR-404** (superficie de fila no editable) → `NodeRow`/`TypeTotalRow` con `bg-sunken` si `!row.leaf`
  (ADR-04/05).

Cobertura NFR → decisión:
- **NFR-401** (Registro intacto) → la feature no toca `src/components/register/**`.
- **NFR-402** (Ingreso/Transferencia intactos) → `ejecColor` delega en `budgetState` **solo** en la rama
  `expense`; las otras dos ramas quedan literalmente iguales.
- **NFR-403** (AA + WCAG 1.4.1) → tokens medidos contra 4 superficies (ADR-03/04) + canal redundante (ADR-06).
- **NFR-404** (cero regresión) → sin cambios en dominio, store ni persistencia; solo color, glifo y superficie.
- **NFR-405** (suite verde) → gate de `verify-run` + quality gates typecheck/lint/coverage.

Verificación:
- [x] Cada FR-* está atendido por ≥1 componente/decisión.
- [x] Cada NFR-* tiene una decisión de diseño correspondiente.
- [x] Cada ADR evalúa ≥2 opciones con su trade-off explícito.
- [x] Los ítems del `no_go_zone` NO aparecen en la arquitectura (no se redefinen `--warning`/`--error`; no
      se toca el Registro ni Recientes; no se muestra el % por fila; no hay aviso temprano; sin cambios de
      datos, layout, columnas, despliegue ni auth).
- [x] Blast radius documentado para 3 componentes críticos.
- [x] Technical Risk Flags completa (5 flags declarados, ninguno critical/high sin mitigación).
