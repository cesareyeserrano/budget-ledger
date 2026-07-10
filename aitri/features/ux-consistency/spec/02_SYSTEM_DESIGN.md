# Technical Design Document (TRD / SDD)
## Feature: ux-consistency — refinamiento profesional del acabado (T-Ledger)

> **Naturaleza:** cambio a un sistema EXISTENTE. No es un rediseño ni una reconstrucción — es pulido del
> acabado sobre el stack actual (Next.js 15 / React 19 / Tailwind v4 / Zustand / TS). El grueso del trabajo
> vive en la **capa de tokens** (`globals.css`) y en la **adopción** de esos tokens por componentes que hoy
> los ignoran. Solo 2 comportamientos cambian: arrancar en el mes en curso (FR-312) y scroll con rueda
> (FR-313). Todo lo demás es paridad funcional estricta (NFR-301).

---

## Executive Summary

Esta feature no introduce un stack nuevo: **refina** el existente. Las decisiones técnicas se toman para
maximizar profundidad/consistencia visual con el **menor radio de explosión** posible, porque la North Star
es *paridad + acabado* con **cero regresión funcional** y la suite completa (root + grid-ux +
stack-upgrade-theme) en verde (NFR-301/305).

**Stack (todo ya presente en el proyecto — versiones exactas de `package.json`):**

| Capa | Tecnología | Versión | Razón |
|---|---|---|---|
| Framework | Next.js | 15.1.6 | App existente; export estático/offline. No se cambia. |
| UI runtime | React | 19.0.0 | Existente. |
| Estilos/tokens | Tailwind CSS v4 (`@theme inline`) + CSS custom properties | 4.0.0 | El sistema de diseño ya vive aquí; se re-valúan y extienden tokens sin reescribir utilidades. |
| Estado | Zustand | 5.0.3 | Store único existente; solo cambia el default de `period`. |
| Iconos | lucide-react | 0.474.0 | Catálogo amplio para el selector de iconos (FR-309). |
| Overlays | shadcn/ui sobre Radix | `@radix-ui/react-select` 2.3.2, `-tabs` 1.1.16, `-toggle-group` 1.1.14, **+ `@radix-ui/react-popover` (nuevo)** | Primitivas consistentes con foco/Escape/click-fuera (FR-310). |
| Variantes de componente | class-variance-authority | 0.7.1 | Variantes del `Kpi`/`Card` consolidados (FR-308). |
| Calendario | react-day-picker | 9.14.0 | Existente (carga diferida). |
| Charts | recharts | 2.15.0 | Existente; solo se tokeniza el cursor del tooltip (FR-301). |
| Lenguaje | TypeScript | 5.7.3 | Existente. |

**Única dependencia nueva:** `@radix-ui/react-popover` (client-side, sin red — cumple NFR-304). Todo lo
demás ya está instalado.

El trabajo se concentra en: (1) la **capa de tokens** como fuente única (superficies/elevación, radios,
tipografía, eyebrow, contraste AA, tokens faltantes); (2) **adopción** de esos tokens por los componentes
que hoy divergen; (3) **consolidación** de duplicados (Kpi/Card, selector de tipo); (4) dos primitivas
nuevas de UI (`Popover`, `IconPicker`); (5) dos fixes funcionales acotados (mes en curso, rueda).

---

## System Architecture

Arquitectura **frontend-only, single-user, offline (localStorage)** — sin backend, sin red en runtime. La
feature no altera la topología; refina las capas de presentación y toca un punto del estado.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Navegador (localhost:3100) — Next.js 15 client, export estático               │
│                                                                                │
│  ┌────────────────────────── CAPA DE TOKENS (globals.css) ──────────────────┐ │
│  │  @theme inline  +  :root / .dark                                          │ │
│  │  · Superficies/elevación: --canvas --surface --surface-2 --sunken         │ │
│  │  · Sombras theme-aware:   --shadow-sm/md/lg  --elev-highlight             │ │
│  │  · Radios:  --radius-xs/sm/md/lg/full                                     │ │
│  │  · Tipografía (utilidades): .display .title .title-sm .label .caption     │ │
│  │                             .eyebrow .tabular                             │ │
│  │  · Texto sobre relleno: --primary-foreground / --on-accent               │ │
│  │  ← FUENTE ÚNICA. FR-301/302/303/305/306/311/314 aterrizan aquí.           │ │
│  └──────────────────────────────────┬───────────────────────────────────────┘ │
│                                      │ (utilidades Tailwind + clases)           │
│  ┌───────────────── SHELLS ─────────▼──────────────┐   ┌──── UI PRIMITIVES ──┐ │
│  │ DesktopShell (>760px)   MobileShell (≤760px)     │   │ ui/Kpi (nuevo,único) │ │
│  │  · TopBar/marca discreta · PageHeader (1 título) │   │ ui/Card (extraído)   │ │
│  │  · año/periodo = pill    · KPIs = <Kpi> único    │   │ ui/popover (nuevo)   │ │
│  │  ┌───────────┐ ┌───────────┐ ┌────────────────┐ │   │ ui/select (fix)      │ │
│  │  │ BudgetGrid│ │ Dashboard │ │ Register(panel) │ │   │ ui/tabs, ui/button   │ │
│  │  │ .tabular  │ │ <Kpi>·<Card>│ tokens/radios   │ │   │ IconPicker (nuevo)   │ │
│  │  │ rueda(H)  │ │ tooltip tok │ TypeToggle único│ │   │ NodeIcon (catálogo)  │ │
│  │  └───────────┘ └───────────┘ └────────────────┘ │   └──────────────────────┘ │
│  └──────────────────────┬───────────────────────────┘                          │
│                         │ (acciones)                                            │
│  ┌──────────────────────▼─────────── ESTADO (Zustand store.ts) ──────────────┐ │
│  │  data: LedgerState   period: PeriodFilter  ← default = MES EN CURSO (FR-312)│ │
│  │  addMovement / setLeafAmount / createNode / renameNode / setNodeIcon / …   │ │
│  └──────────────────────┬─────────────────────────────────────────────────────┘ │
│                         │ (persist)                                             │
│  ┌──────────────────────▼── DOMINIO (mutations/rollup/tree) ── sin cambio ────┐ │
│  └──────────────────────┬─────────────────────────────────────────────────────┘ │
│  ┌──────────────────────▼── data/repository → window.localStorage ── sin cambio┐│
│  └───────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Responsabilidad por componente (nuevo/tocado):**
- **Capa de tokens (`globals.css`)** — fuente única de superficies, elevación, radios, tipografía, contraste. La mayoría de FRs visuales se resuelven aquí y se *heredan* por las utilidades ya usadas.
- **`ui/Kpi.tsx` (nuevo, único)** — tarjeta KPI compartida por Dashboard y DesktopShell (FR-308). Padding único, valor en `.tabular`, eyebrow `.eyebrow`, color/variación por prop.
- **`ui/Card.tsx` (extraído)** — panel con `--surface` + hairline + `--shadow-sm` + `--radius-lg`, reutilizado por Dashboard.
- **`ui/popover.tsx` (nuevo, Radix)** — Popover/PopoverTrigger/PopoverContent con foco, Escape y click-fuera (FR-310), sombra `var(--shadow-lg)`.
- **`IconPicker.tsx` (nuevo)** — grid buscable de ≥40 iconos Lucide dentro de un Popover; persiste vía `setNodeIcon` (FR-309/310).
- **`NodeIcon.tsx` (ampliado)** — `MAP` extendido a ≥40 iconos + `ICON_CATALOG` exportado; fallback consistente.
- **`useHorizontalWheel.ts` (nuevo)** — hook que mapea `deltaY→scrollLeft` en contenedores de scroll horizontal (fila de categorías) (FR-313).
- **`store.ts`** — `period` por defecto pasa a mes en curso (FR-312).
- **Componentes existentes (shells, BudgetGrid, Register/*, Select)** — adoptan tokens/escala/`.tabular`/`.eyebrow`, cabecera con intención, selector de tipo único, fixes de tema.

---

## Data Model

Esta feature es de presentación: **no cambia el modelo de datos ni la persistencia.** Se documenta el
**contrato de preservación** y el único delta (compatible hacia atrás).

### Contrato de preservación (NO cambia — NFR-301)
```ts
// src/domain/types.ts — INTACTO
type NodeType  = "expense" | "income" | "transfer";
type NodeLevel = "group" | "category" | "sub";
type MonthKey  = "ene" | "feb" | ... | "dic";

interface LedgerNode {
  id: string; type: NodeType; level: NodeLevel;
  parentId: string | null; name: string;
  icon: string | null;                 // ← dominio de valores se AMPLÍA (ver delta)
  order: number; system?: boolean;
  budget: Record<MonthKey, number>;    // roll-ups por mes
  actual: Record<MonthKey, number>;
}
interface LedgerState { owner: string; nodes: LedgerNode[]; /* … */ }

// Persistencia: window.localStorage bajo clave 'ledger.*' (owner="local"). Formato JSON. Sin migración.
// PeriodFilter NO se persiste (estado efímero de sesión).
```
**Invariantes preservados:** claves de localStorage (`ledger.*`, y `theme` de next-themes, aisladas);
firma anti-doble-tap; roll-ups budget/actual; jerarquía group→category→sub; nodos `system`.

### Delta introducido (único, backward-compatible)
- **Dominio del campo `icon` se amplía.** `icon` ya es `string | null`; el schema **no cambia**. La feature
  amplía el conjunto de nombres válidos (de ~13 a ≥40) que el usuario puede elegir (FR-309). Los iconos ya
  guardados siguen siendo válidos. Un `icon` cuyo nombre no exista en el `MAP` de `NodeIcon` **cae a un
  fallback** (`Folder`/`Tag`) — sin crash, sin migración de datos.
- **`period` por defecto** (estado efímero, no persistido): de `{ mode: "year" }` a
  `{ mode: "month", month: <mes del reloj> }` (FR-312). No toca datos guardados.

Modelo de consistencia: **fuerte / síncrono en memoria** (Zustand muta el dominio y persiste tras cada
acción) — sin cambio.

---

## API Design

App frontend-only: la "API" es la **superficie de módulos/componentes exportados**. Se documenta el
contrato preservado y solo las firmas nuevas o modificadas (estilo idiomático TS).

### Contrato PRESERVADO (firmas públicas que NO cambian)
```ts
// store.ts — LedgerStore: addMovement, createNode, renameNode, setNodeIcon, deleteNode,
//            moveNode, setLeafAmount, setPeriod, hydrate  → sin cambio de firma
// domain/*  — addMovement, rollupBudget, rollupActual, typeTotals, dashboardMetrics,
//            childrenOf, isLeaf, canDeleteNode  → INTACTOS
// format.ts — money, cellNum, typeColorVar, typeTextColorVar  → INTACTOS
// lib/date.ts — nowForInput, monthKeyFromDate, dateLabel, …  → INTACTOS
// NodeIcon({ name, level, size?, color? })  → firma preservada (test/consumidores estables)
```

### Firmas NUEVAS / MODIFICADAS
```ts
// ── ui/Kpi.tsx (NUEVO — único, FR-308) ────────────────────────────────
export interface KpiProps { label: string; value: string; color?: string; sub?: string; }
export function Kpi(props: KpiProps): JSX.Element;   // valor en .tabular, eyebrow .eyebrow, padding único

// ── ui/Card.tsx (EXTRAÍDO — FR-308) ───────────────────────────────────
export function Card(props: { title: string; children: React.ReactNode }): JSX.Element;

// ── ui/popover.tsx (NUEVO — Radix, FR-310) ────────────────────────────
export const Popover, PopoverTrigger, PopoverAnchor;
export const PopoverContent: React.FC<React.ComponentProps<typeof Radix.Content>>; // shadow var(--shadow-lg)

// ── IconPicker.tsx (NUEVO — FR-309/310) ───────────────────────────────
export function IconPicker(props: {
  value: string | null;
  onChange: (icon: string) => void;      // → store.setNodeIcon(id, icon)
}): JSX.Element;                          // Popover + grid buscable de ICON_CATALOG (≥40)

// ── NodeIcon.tsx (AMPLIADO — FR-309) ──────────────────────────────────
export const ICON_CATALOG: { name: string; Icon: LucideIcon }[];   // ≥40 entradas (nuevo export)
export const CATEGORY_ICONS: string[];                              // preservado (compat)
// NodeIcon(...) firma sin cambio; MAP interno ampliado a ≥40 + fallback

// ── lib/useHorizontalWheel.ts (NUEVO — FR-313) ────────────────────────
export function useHorizontalWheel<T extends HTMLElement>(): React.RefObject<T>;
// adjunta onWheel no-pasivo: si el contenedor desborda en X, deltaY → scrollLeft (+preventDefault)

// ── store.ts (MODIFICADO — FR-312) ────────────────────────────────────
// period inicial: { mode: "month", month: currentMonth() }   (currentMonth() ya existe en el archivo)

// ── RETIRADO ──────────────────────────────────────────────────────────
// ui/toggle-group.tsx (ToggleGroupItem) — componente muerto; TypeToggle queda como selector único (FR-308)
```

Acción de usuario → operación de respaldo (User Flows del UX spec): registrar → `store.addMovement`;
editar celda → `setLeafAmount`; crear/renombrar/borrar/reparent nodo → `createNode/renameNode/deleteNode/moveNode`;
**elegir icono → `IconPicker` → `setNodeIcon`**; cambiar periodo → `setPeriod`; cambiar tema → next-themes.
Ninguna acción del flujo queda sin operación.

---

## Security Design

- **Auth:** ninguna — app single-user local por diseño (no_go_zone: no se introduce auth). Sin cambio.
- **Superficie de red:** cero en runtime (NFR-304). Fuentes self-hosted (`next/font`); Lucide y Radix son
  client-side puros; el Popover y el IconPicker no hacen fetch. Se verificará 0 peticiones al cargar, cambiar
  tema, abrir overlays y guardar.
- **Validación de entrada:** se preserva la existente (coerción numérica en grilla/monto:
  `replace(/[^0-9]/g,"")`, `Math.max(0, round(...))`; `parsePesos`). El **IconPicker no acepta texto libre
  para `icon`**: el usuario solo elige de `ICON_CATALOG` (lista cerrada), por lo que el valor persistido es
  siempre un nombre conocido; un valor desconocido (dato viejo/manipulado) cae a fallback en `NodeIcon`.
- **XSS/inyección:** React escapa por defecto; **no se usa `dangerouslySetInnerHTML`**. Los iconos se
  renderizan como componentes React (no como strings de SVG), así que un nombre de icono no puede inyectar
  markup. El texto de nodo/nota se renderiza como texto.
- **Cabeceras / CSP:** sin cambio respecto al despliegue actual; no se añaden orígenes externos (compatible
  con una CSP estricta sin `connect-src` remoto). La nueva dependencia Radix no añade orígenes.
- **Datos en reposo:** localStorage sin cifrar — aceptado y sin cambio (dato personal, single-user, local);
  esta feature no altera el modelo de amenaza existente.

Confianza: todo el input proviene del propio usuario en su dispositivo; no hay frontera multiusuario ni
servidor. La feature **no amplía la superficie de ataque**.

---

## Performance & Scalability

- **Bundle (riesgo principal):** el selector de iconos **NO importa todo lucide-react** (miles de iconos).
  Usa un `ICON_CATALOG` curado de ≥40 iconos con imports nombrados estáticos (tree-shakeable) — coste ~pocos
  KB (ADR-06). react-day-picker sigue en carga diferida (`dynamic`, ssr:false). `@radix-ui/react-popover` es
  pequeño y client-only.
- **Elevación por CSS:** las sombras/`highlight` son propiedades CSS (compositor), no re-render de React.
  Cambiar de tema conmuta variables CSS: sin tormenta de renders.
- **Tipografía:** utilidades de clase (`.display/.title/.eyebrow/.tabular`) en `globals.css` — cero JS,
  resolución en el motor de estilos.
- **Rueda (FR-313):** el handler mapea `deltaY→scrollLeft` con trabajo O(1) por evento (no listeners
  globales por fila; se adjunta por contenedor horizontal). `overscroll-behavior: contain` evita capturar el
  scroll de la página.
- **Escala de datos:** sin cambio — la grilla renderiza 12 meses × N nodos; los roll-ups son los mismos.
  Cotas de tamaño de localStorage sin cambio. v1 sigue single-year 2026.
- **Consolidación Kpi/Card:** reduce árbol duplicado (un componente en vez de dos definiciones divergentes)
  — neutro/positivo en render.

---

## Deployment Architecture

- **Modelo de despliegue (explícito):** **web estática Next.js** (el mismo que hoy — export estático /
  `next start`), servida en `localhost:3100` en desarrollo. **Sin contenedor nuevo, sin backend, sin
  serverless.** Esta feature no cambia el pipeline de despliegue (no_go_zone).
- **Dependencias de build:** se agrega `@radix-ui/react-popover` a `dependencies`; `package-lock.json` se
  actualiza. Sin cambios de infra ni de variables de entorno.
- **Entornos:** dev (`next dev` en :3100). El artefacto de despliegue es el mismo bundle estático que las
  features previas.
- **CI/CD (NFR-306):** `ci.yml` corre la suite completa (vitest unit + integration + Playwright e2e) en push/PR
  a `main`; gate de humo = el contenedor/app responde **200 en `/`**. Se añaden quality_gates existentes
  (typecheck, lint) al ciclo de `verify-run`. Los nuevos tests (unit + e2e con prefijo TC-UXC-*) se integran
  a la misma suite; la regresión (root + grid-ux + stack-upgrade-theme) debe seguir verde.
- **Observabilidad:** app cliente sin proceso long-running; los avisos al usuario (quota) siguen vía
  `StorageBanner`/toast. No hay endpoint `/health` porque no hay servicio propio (frontend estático).

---

## Risk Analysis

### Top riesgos
1. **Re-valuación de tokens invierte canvas/surface en claro** (hoy `--bg`=blanco, `--bg-card`=gris; pasa a
   `--bg`=gris, `--bg-card`=blanco). Riesgo: e2e/aserciones que dependan de un color/clase concreta.
   *Mitigación:* conservar los **nombres de utilidad** (`bg`, `bg-card`, `bg-elevated`) y solo re-valuar +
   añadir tokens nuevos (`--surface-2`, `--sunken`) donde haga falta una capa nueva; correr la suite completa
   (NFR-305) antes de aprobar.
2. **FR-312 (mes en curso) puede abrir KPIs en $0** si el mes actual no tiene ejecutado (el default `año` se
   eligió justamente para evitarlo). *Mitigación:* es una decisión de producto explícita del usuario (FR-312);
   el usuario cambia a `Año` con un toggle existente. Aceptado.
3. **FR-313 (rueda→horizontal) puede secuestrar el scroll vertical de la página.** *Mitigación:* mapear
   `deltaY→scrollLeft` solo en contenedores **horizontal-only** (fila de categorías) y solo cuando desbordan
   en X; la grilla conserva scroll nativo bi-axial; `overscroll-behavior: contain`.
4. **Consolidar Kpi y retirar ToggleGroupItem** puede romper tests que referencian esos nodos.
   *Mitigación:* preservar `data-testid`/`aria` (`type-*`, `type-sign-*`, KPIs); un único componente
   canónico; suite verde.
5. **Nueva dependencia `@radix-ui/react-popover`** (cadena de suministro / bundle). *Mitigación:* Radix es
   mantenido activamente, client-only, sin red (NFR-304); superficie mínima.

### Architectural Decision Records

**ADR-01: Estrategia de tokens de superficie/elevación**
- Context: hay que dar profundidad (lienzo gris + cards que flotan) y añadir capas (surface-2/sunken) sin romper las utilidades ya usadas por toda la app.
- Option A: **Renombrar** los tokens a los nombres del spec (`--canvas/--surface/--surface-2/--sunken`) y reescribir cada clase `bg-card`/`bg-elevated` en todos los componentes — semántica limpia, pero radio de explosión enorme y alto riesgo de regresión.
- Option B: **Re-valuar** los tokens existentes (`--bg`→lienzo gris, `--bg-card`→surface blanca) conservando los nombres de utilidad, y **añadir** solo los tokens/utilidades nuevos que representan una capa nueva (`--surface-2` para popovers, `--sunken` para el encabezado de grilla), reasignando puntualmente el encabezado a `bg-sunken` y los overlays a `surface-2`.
- Decision: **Option B** — cumple la profundidad pedida con cambios localizados; protege la suite (NFR-305) y honra "pulido, no rediseño".
- Consequences: habilita profundidad con bajo riesgo; deja una capa de aliasing (nombres internos ≠ nombres del spec) documentada en `globals.css`; si a futuro se quiere el naming del spec, es un refactor aparte.

**ADR-02: Modelo de elevación (bordes vs bordes+sombra)**
- Context: el estado actual es "bordes sobre rellenos" plano; el mockup aprobado pide profundidad.
- Option A: Solo hairline (statu quo) — plano, sin profundidad; no satisface FR-301.
- Option B: **Hairline + sombra suave theme-aware** (`--shadow-sm/md/lg`, `--elev-highlight` en oscuro).
- Decision: **Option B** — sombra sutil (sin glow/gradiente) por token, distinta por tema.
- Consequences: profundidad en claro y oscuro; acepta una sombra ligera como coste; centralizada en tokens.

**ADR-03: Tipografía/eyebrow — arbitrary values vs utilidades semánticas**
- Context: ~17 tamaños `text-[…rem]`, 5 eyebrows distintos, `font-[450]` no estándar.
- Option A: Seguir con arbitrary values Tailwind por sitio — perpetúa la deriva.
- Option B: **Utilidades semánticas** en `globals.css` (`.display/.title/.title-sm/.label/.caption/.eyebrow/.tabular`) aplicadas en todos lados.
- Decision: **Option B** — una escala con roles, un solo eyebrow, pesos estándar.
- Consequences: consistencia y menor deriva; los componentes migran de `text-[…]` a clases de rol.

**ADR-04: Consolidación de Kpi/Card**
- Context: `Kpi` está duplicado y divergente (Dashboard vs DesktopShell: padding y regla de cifra distintos).
- Option A: Duplicado con props sincronizadas manualmente — frágil, vuelve a divergir.
- Option B: **Un componente `<Kpi>` compartido** (`ui/Kpi.tsx`) + `<Card>` extraído, reutilizados por ambos.
- Decision: **Option B** — un componente, un padding, una regla de cifra (`.tabular`).
- Consequences: elimina divergencia; ambos consumidores adoptan la misma firma.

**ADR-05: Selector de tipo único (adoptar vs retirar)**
- Context: `TypeToggle` (custom, relleno sólido + `role=tab` + `data-testid`) coexiste con `ToggleGroupItem` (Radix, "hecho para esto" pero **muerto**, nunca usado).
- Option A: Refactorizar `TypeToggle` para envolver la primitiva Radix `ToggleGroup` — "más correcto", pero cambia semántica (tab→toggle) y `data-testid`/aria de los que dependen los tests → riesgo de regresión.
- Option B: **Conservar `TypeToggle` como control canónico** (estandarizando radio y contraste AA) y **retirar** el `ui/toggle-group.tsx` muerto.
- Decision: **Option B** — satisface FR-308 ("el no usado se retira") con el menor radio de explosión y sin tocar el comportamiento/aria que la suite verifica.
- Consequences: un único patrón de selector; se borra código muerto; se evita reescribir semántica de accesibilidad probada.

**ADR-06: Catálogo del selector de iconos (bundle)**
- Context: se pide un selector "rico" (≥40 iconos Lucide) sin inflar el bundle.
- Option A: Importar dinámicamente todos los iconos de lucide (`dynamicIconImports`) — miles de iconos, peso y complejidad altos.
- Option B: **`ICON_CATALOG` curado (≥40) con imports nombrados estáticos**, buscable/filtrable en cliente.
- Decision: **Option B** — cumple "≥40 y buscable" con coste de bundle mínimo y tree-shaking.
- Consequences: catálogo finito (ampliable editando una lista); persistencia de nombre estable; sin coste de red.

**ADR-07: Primitiva de overlay para calendario/iconos**
- Context: el popover del calendario es un `div` absoluto con listener `mousedown` propio; el icon picker necesita overlay accesible (FR-310).
- Option A: Mantener overlays ad-hoc — sin gestión de foco estándar, duplicado, frágil.
- Option B: **Adoptar `@radix-ui/react-popover`** (shadcn `ui/popover.tsx`) para calendario e IconPicker — foco, Escape, click-fuera, portal, `var(--shadow-lg)`.
- Decision: **Option B** — consistencia y accesibilidad; client-only, sin red.
- Consequences: una dependencia nueva pequeña; overlays uniformes; se retira el manejo manual de click-fuera del `DateTimeField`.

**ADR-08: Default de periodo = mes en curso (FR-312)**
- Context: el store arranca en `{ mode: "year" }` (elegido para que los KPIs no abran en $0). El usuario pide arrancar en el mes en curso.
- Option A: Mantener `año` — contradice FR-312.
- Option B: **`{ mode: "month", month: currentMonth() }`** usando el helper `currentMonth()` (ya presente, hoy sin uso), derivado del reloj.
- Decision: **Option B** — cumple FR-312; el usuario cambia libremente a Año/otro mes.
- Consequences: los KPIs abren sobre el mes actual (posible $0 si no hay ejecutado — aceptado); `period` sigue efímero (no persistido).

**ADR-09: Scroll con rueda horizontal (FR-313)**
- Context: filas horizontales (categorías) no responden a la rueda de un mouse (solo `deltaY`).
- Option A: Depender de `shift+rueda`/trackpad nativo — no cumple "la rueda desplaza".
- Option B: **Hook `useHorizontalWheel`** que, en contenedores que desbordan en X, mapea `deltaY→scrollLeft` (`preventDefault`), con `overscroll-behavior: contain`.
- Decision: **Option B** — la rueda desplaza horizontalmente donde el layout es horizontal; la grilla conserva scroll nativo bi-axial.
- Consequences: afordancia de scroll consistente; el handler se adjunta solo a contenedores horizontal-only para no secuestrar el scroll de página.

---

## Technical Risk Flags

[RISK] Re-valuación de tokens de superficie invierte claro (canvas/surface)
Conflict: FR-301 requiere lienzo gris + cards blancas que floten, pero hoy `--bg` es blanco y `--bg-card` es gris (invertido); e2e/aserciones pueden depender del valor/clase actual.
Mitigation: conservar nombres de utilidad (`bg`/`bg-card`/`bg-elevated`), re-valuar y añadir solo tokens nuevos (`--surface-2`/`--sunken`); correr la suite completa (NFR-305) antes de aprobar.
Severity: medium

[RISK] Mes en curso puede mostrar KPIs en $0
Conflict: FR-312 exige arrancar en el mes actual, pero el default `año` existía para evitar $0 cuando el mes en curso no tiene ejecutado.
Mitigation: decisión de producto explícita del usuario; el toggle Mes/Año permite volver a la vista agregada. Aceptado.
Severity: low

[RISK] Mapear rueda deltaY→scrollLeft puede secuestrar el scroll vertical de la página
Conflict: FR-313 exige rueda horizontal en filas, pero un `preventDefault` mal acotado bloquearía el scroll natural.
Mitigation: aplicar solo a contenedores horizontal-only y solo cuando desbordan en X; grilla con scroll nativo bi-axial; `overscroll-behavior: contain`.
Severity: medium

[RISK] Consolidar Kpi y retirar ToggleGroupItem puede romper tests
Conflict: NFR-305 exige suite verde, pero mover/retirar componentes puede afectar selectores/aria.
Mitigation: preservar `data-testid`/`aria` (`type-*`, KPIs); un único componente canónico; ejecutar regresión completa.
Severity: low

[RISK] Nueva dependencia @radix-ui/react-popover
Conflict: NFR-304 exige cero red en runtime y superficie mínima; toda dependencia es compromiso de mantenimiento.
Mitigation: Radix client-only, sin fetch, mantenido activamente; se añade una sola primitiva reutilizada por 2 overlays.
Severity: low

---

## Failure Blast Radius

Component: Capa de persistencia (data/repository → localStorage)
Blast radius: si `localStorage` falla (quota/indisponible), no se persisten movimientos/ediciones nuevas.
User impact: aviso NO bloqueante (`StorageBanner`/`storageError: "quota"`); la sesión en memoria sigue usable.
Recovery: reintento en la siguiente acción; el estado en memoria no se pierde durante la sesión. Sin cambio por esta feature.

Component: Capa de tokens/tema (globals.css `@theme` + :root/.dark)
Blast radius: un token mal formado o ausente deja utilidades sin resolver → colores/superficies rotas en toda la app.
User impact: superficies sin estilo/monocromas (no crash funcional).
Recovery: detectable en build (Tailwind) y en la suite e2e de tema; se corrige en CSS. Riesgo acotado por conservar nombres de utilidad (ADR-01).

Component: Resolución de iconos (NodeIcon MAP / ICON_CATALOG)
Blast radius: un `icon` guardado cuyo nombre no exista en `MAP` (dato viejo/manipulado).
User impact: se muestra el icono de fallback (`Folder`/`Tag`); sin crash, sin pérdida de dato.
Recovery: automático (fallback); el usuario puede re-elegir un icono del catálogo.

---

## Traceability Checklist

Cobertura FR → componente/decisión:
- **FR-301** superficie/elevación + 2 bugs de tema → Capa de tokens (ADR-01/02), `Dashboard` (cursor tooltip tokenizado), `ui/select` (sombra `var(--shadow-lg)`).
- **FR-302** escala de radios → `--radius-xs/sm/md/lg/full` + adopción en cards/campos/botones/chips/overlays.
- **FR-303** escala tipográfica → utilidades `.display/.title/.title-sm/.label/.caption` (ADR-03), pesos estándar.
- **FR-304** cabecera con intención → `DesktopShell`/`MobileShell`: TopBar/marca discreta + un título + año como pill.
- **FR-305** cifras en DM Mono → `.tabular` en grilla/KPI/recientes/registro.
- **FR-306** eyebrow único → clase `.eyebrow` (ADR-03).
- **FR-307** registro coherente → `Register/*` adoptan superficie/borde/radio por token + elevación.
- **FR-308** consolidar Kpi/Card + selector único → `ui/Kpi` + `ui/Card` (ADR-04); `TypeToggle` único, retiro de `toggle-group` (ADR-05).
- **FR-309** icono rico → `NodeIcon` catálogo ≥40 + `IconPicker` (ADR-06).
- **FR-310** overlays shadcn/Radix → `ui/popover` (ADR-07) en calendario e IconPicker.
- **FR-311** contraste AA sobre relleno → `--primary-foreground` + relleno income activo `#15803D`, peso ≥600.
- **FR-312** mes en curso → `store.ts` default (ADR-08).
- **FR-313** rueda vertical+horizontal → `useHorizontalWheel` + `overscroll-behavior` (ADR-09).
- **FR-314** nitpicks → `ui/select` (clase malformada), pesos `font-[450]`→estándar, tokens `--radius-full`/`--primary-foreground`.

Cobertura NFR → decisión:
- **NFR-301** paridad → contrato de preservación (Data Model/API); solo FR-312/313 cambian comportamiento.
- **NFR-302** identidad → tokens re-valuados, no reemplazados; acentos por tipo y default de tema (Sistema) intactos.
- **NFR-303** AA/foco/target → tokens de contraste, `:focus-visible` conservado, `min-h-[48px]` conservado.
- **NFR-304** sin red → Radix/Lucide client-side, fuentes self-hosted (Security/Performance).
- **NFR-305** suite verde → gate de `verify-run` + regresión (Deployment).
- **NFR-306** CI/CD → `ci.yml` corre suite en push/PR; smoke 200 en `/`.

Verificación:
- [x] Cada FR-* está atendido por ≥1 componente/decisión.
- [x] Cada NFR-* tiene una decisión de diseño correspondiente.
- [x] Cada ADR evalúa ≥2 opciones.
- [x] Los ítems del no_go_zone NO aparecen en la arquitectura (sin rediseño/reconstrucción; sin cambio de modelo de datos salvo FR-312/313; sin marca/hue nuevo; sin reordenar indicadores/columnas; sin cambio de despliegue/auth/navegación).
- [x] Blast radius documentado para 3 componentes críticos.
- [x] Technical Risk Flags completa (5 flags declarados).
