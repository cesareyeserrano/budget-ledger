# Technical Design Document (TRD / SDD) — Ledger (T-Ledger)

## Executive Summary

> **Nota de re-derivación (2026-08-04).** Este documento se actualizó tras re-aprobar la Fase 1. La arquitectura
> cambió de forma sustancial respecto a la v1 original por dos features aprobadas: **`backend`** (autenticación,
> contrato `/api/v1`, PostgreSQL, sync SSE) y **`servidor-fuente-unica`** (FR-1101..FR-1106: se retiró el modo
> localStorage y Postgres quedó como ÚNICA fuente de verdad). Donde el texto original describía una SPA
> client-side con localStorage, ahora describe el sistema vigente; las decisiones superadas se conservan como
> registro en §ADRs, no como instrucción.

Ledger es una **app web cliente-servidor** en **Next.js 15.x (App Router)** + **React 19** + **TypeScript 5.x**,
estilada con **Tailwind CSS v4** + **shadcn/ui** (Radix), gráficos **Recharts 2.x**, íconos **lucide-react**,
drag-and-drop **@dnd-kit/core 6.x**, validación **Zod**, estado **Zustand**. La persistencia vive en
**PostgreSQL** (Drizzle) tras el contrato versionado **`/api/v1`**, filtrado por `ownerId`, con **Better Auth**
(argon2id) para sesión y **SSE** para sincronización en vivo entre dispositivos. El cliente accede a los datos
por un **repositorio único** (`ServerRepository`), construido en un solo punto (`state/store.ts`, FR-1101).
`localStorage` guarda EXCLUSIVAMENTE preferencias del navegador — ninguna clave `ledger.*` (FR-509).

El diseño se ancla en la **lógica de referencia verificada del prototipo** (`Ledger (offline).html` — roll-up,
semilla determinista, edición de hoja) y en las **reglas de negocio vigentes** de Fases 1/UX (que se apartan del
prototipo: sin distribución proporcional, **borrado bloqueado hasta vaciar** en vez de "Sin asignar", móvil solo
Registrar, drag-drop, sin teclado numérico). Todo el dominio (jerarquía, roll-ups, borrado, reparent, semilla)
vive en un **núcleo TypeScript puro** sin React ni DOM — esto hace verificables FR-002/003/004/008/015 y el
invariante de regresión NFR-005, y es lo único que NO cambió al pasar al servidor (NFR-507 lo protege).

**Decisiones clave (ADRs en §Risk Analysis):** Next.js 15 (constraint + imagen Docker + `/health` para smoke) ·
Zustand con selectores memoizados (guardrail ≤150ms, NFR-001) · roll-ups **derivados, no almacenados**
(invariante padre==Σhojas por construcción) · **PostgreSQL como única fuente de verdad tras un repositorio
único** (sustituye al swap localStorage/Supabase originalmente previsto) · escrituras serializadas con
coalescencia (BL-010) sobre un modelo snapshot-replace · @dnd-kit para reparent accesible.

North Star: demo funcional end-to-end sin bugs. La arquitectura prioriza **corrección verificable del dominio**
y **coherencia de los datos entre dispositivos** sobre escalabilidad horizontal (una sola instancia; ver OBS-1).

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Browser (cliente)                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Next.js 15 App Router — app/layout.tsx (tokens CSS :root)      │  │
│  │  app/page.tsx → <ResponsiveShell> ("use client")               │  │
│  └───────────────┬───────────────────────────┬────────────────────┘  │
│      ≤760px       │                           │  >760px                │
│        ┌──────────▼─────────┐       ┌─────────▼──────────────────────┐ │
│        │  MobileShell       │       │  DesktopShell                  │ │
│        │  SOLO <MovementForm>│      │  MovementPanel · BudgetGrid ·  │ │
│        │  (sin RecentList)  │       │  Dashboard · CategoryTree      │ │
│        └──────────┬─────────┘       └─────────┬──────────────────────┘ │
│                   │  UI (shadcn/ui, Recharts[lazy], @dnd-kit)          │
│        ┌──────────▼──────────────────────────────────────────────────┐│
│        │  State — useLedgerStore (Zustand)                           ││
│        │  actions: addMovement, createNode, renameNode, deleteNode,  ││
│        │           moveNode, setLeafAmount, setPeriodFilter, hydrate ││
│        │  selectors: rollupBudget, rollupActual, variance,           ││
│        │             dashboardMetrics, visibleTree                   ││
│        └──────────┬───────────────────────────────┬──────────────────┘│
│         invoca    │                                │  load/save         │
│        ┌──────────▼─────────────┐       ┌──────────▼──────────────────┐│
│        │  domain/ (TS puro)     │       │  LedgerRepository (iface)   ││
│        │  tree, rollup, sign,   │       │  └ ServerRepository         ││
│        │  seed, deleteNode,     │       │     (único punto, FR-1101)  ││
│        │  moveNode, editLeaf    │       └──────────┬──────────────────┘│
│        └────────────────────────┘                  │ fetch (JSON)      │
└────────────────────────────────────────────────────┼───────────────────┘
                                                     │  cookie SameSite
┌────────────────────────────────────────────────────▼───────────────────┐
│                      Servidor Next.js (mismo bundle)                    │
│   /api/auth/[...all]  — Better Auth (argon2id, sesión en Postgres)     │
│   /api/v1/ledger      — GET/PUT snapshot del libro (filtra ownerId)    │
│   /api/v1/movements   — alta/baja de movimientos                       │
│   /api/v1/sync/stream — SSE: notifica cambios a los otros dispositivos │
│   /health             — healthcheck para el smoke gate                 │
│   withApi(): sesión obligatoria + validación Zod + allowlist de Origin │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ Drizzle
                       ┌─────────▼──────────────┐
                       │  PostgreSQL            │
                       │  ledger (por ownerId)  │
                       │  user / session (auth) │
                       └────────────────────────┘
   Deploy: Docker (next start) → Nginx (TLS/headers) → Ultron (Pi 5)
```

**Componentes y responsabilidad:**
- **ResponsiveShell** — elige Mobile/Desktop por media-query 760px (FR-010). Única responsabilidad: layout raíz.
- **MobileShell** — monta SOLO `MovementForm` (FR-001, FR-010, divergencia v1 #1). No importa grilla ni dashboard (garantiza que no estén en el DOM en móvil). La lista de recientes se retiró (BL-003): el guardado se confirma por `ConfirmOverlay` + reset del monto. Monta también el `StorageBanner` (BL-022).
- **DesktopShell** — orquesta MovementPanel (slideIn), BudgetGrid, Dashboard, CategoryTree y el toggle Resumen/Dashboard. Monta también el `StorageBanner` sobre la grilla y el dashboard (BL-022: antes vivía solo en móvil, así que en escritorio los fallos de persistencia ocurrían en silencio).
- **BudgetGrid** — divs flex + sticky (columna categoría 240px, encabezados 12 meses); edición inline SOLO de celdas-hoja; drag-drop de reparent (FR-006, FR-015).
- **useLedgerStore (Zustand)** — estado de trabajo en memoria; acciones (mutaciones puras del dominio) + selectores (roll-ups derivados memoizados). Persiste vía repositorio con **escrituras serializadas y coalescencia** (BL-010): `persist` apunta el snapshot más reciente y el drenador mantiene UN save en vuelo; al terminar envía el último pendiente. El modelo es **snapshot-replace**, así que los intermedios no importan. Ante 409 (revisión obsoleta) hace `resync` preservando la ventana de undo (BG-011).
- **domain/ (TS puro)** — funciones sin efectos: `rollup`, `signOf`, `varianceOf`, `deleteNode`, `canDeleteNode`, `moveNode`, `editLeaf`, `buildSeed`. Núcleo verificable (Fase 3). NFR-507 lo protege: pasar al servidor NO cambió su lógica de cálculo.
- **LedgerRepository** — interfaz de persistencia. La única implementación de producción es `ServerRepository` (HTTP contra `/api/v1`); los tests usan un fake en memoria. `LocalStorageRepository` y `stripLegacyUnassigned` **salieron de `src/`** con la feature `servidor-fuente-unica` (FR-1105).
- **withApi (servidor)** — envoltura de las rutas: exige sesión válida (FR-504), valida el cuerpo con Zod antes de castearlo (BG-012), y aplica una allowlist de `Origin` en mutaciones como defensa en profundidad (la defensa CSRF efectiva es la cookie `SameSite`; ver RQ-SEC-008).
- **syncHub (servidor)** — publica los cambios por SSE a los demás dispositivos del mismo usuario (FR-511). Singleton en memoria del proceso: con más de una instancia degradaría a "hasta la próxima recarga" (OBS-1/TRF-01).

**Patrón de interacción:** cliente-servidor con **UI optimista**. Una mutación muta el store y recomputa selectores de inmediato (guardrail ≤150ms), y la persistencia va en diferido y serializada; si el guardado no llega o la respuesta es ilegible, el `StorageBanner` lo comunica en vez de fingir que se guardó (BG-012, BL-022). Los otros dispositivos se enteran por SSE (FR-511) y, en su defecto, en la siguiente recarga (FR-510). Sin paginación (dataset acotado a 1 año).

## Data Model

Persistencia: **PostgreSQL** vía Drizzle, aislada por `ownerId`, servida por `/api/v1/ledger` como snapshot con
número de revisión (control optimista: un PUT con `baseRevision` obsoleta recibe 409 y el cliente hace `resync`).
Todo lo que entra por la API se valida con **Zod** antes de castearlo (BG-012); si no hay datos → semilla
(FR-013). `localStorage` NO participa: solo guarda preferencias del navegador (FR-509).

### Entidades (TypeScript)
```ts
type NodeType  = 'expense' | 'income' | 'transfer';   // 3 tipos FIJOS (FR-002, D-1)
type NodeLevel = 'group' | 'category' | 'sub';
type MonthKey  = 'ene'|'feb'|'mar'|'abr'|'may'|'jun'|'jul'|'ago'|'sep'|'oct'|'nov'|'dic';

interface LedgerNode {
  id: string;              // uid (prototipo: 'n' + base36(now) + rand); crypto.randomUUID en prod
  ownerId: string;         // FR-014 + FR-507: aislamiento real por usuario autenticado
  type: NodeType;          // heredado del tipo raíz; invariante en reparent (no cruza de tipo)
  level: NodeLevel;
  parentId: string | null; // null solo para grupos
  name: string;            // 1..60, no vacío
  icon: string | null;     // glifo Lucide (group/category) | null (sub)
  system?: boolean;        // legado: marcaba "Sin asignar". Ya NO se crea por ningún camino;
                           // los guards !system se CONSERVAN como única defensa ante datos
                           // heredados en Postgres (su saneador salió con FR-1105)
  order: number;           // posición estable dentro del padre (v1 no reordena; se preserva)
}
// Solo HOJAS almacenan montos: nodeId -> { MonthKey -> number COP entero ≥0 }
type AmountMap = Record<string, Partial<Record<MonthKey, number>>>;
interface Movement {
  id: string; ownerId: string; type: NodeType;
  catId: string; subId: string | null;
  target: string;   // = subId ?? catId (hoja destino; SIEMPRE resuelve un nodo existente)
  amount: number;   // entero ≥1 COP
  month: MonthKey; createdAt: number;
}
interface PersistedNodes  { version: 1; ownerId: string; nodes: LedgerNode[]; }                 // key: ledger.nodes.v1
interface PersistedBudget { version: 2; budgets: AmountMap; actuals: AmountMap; movements: Movement[]; } // key: ledger.budget.v2
```

### Reglas / constraints del modelo
- **isLeaf (prototipo):** `sub` siempre es hoja; `category` es hoja si no tiene hijos.
- **Invariante de tipo:** un nodo y sus descendientes comparten `type`; `moveNode` rechaza destino de otro tipo (FR-015).
- **~~"Sin asignar"~~ — RETIRADO (FR-003).** La categoría fija del sistema se eliminó por decisión del usuario (feature `grid-ux`, FR-110). Ningún camino crea ya nodos `system`; los guards que los protegen se conservan como defensa ante datos heredados (FR-1105).
- **Borrado seguro (FR-003):** `deleteNode` devuelve `{blocked:"has_children"}` si el nodo tiene hijos (BG-002), `{blocked:"has_data"}` si tiene Presupuestado o Ejecutado > 0 en cualquier mes de su subárbol (BG-001), y solo borra si está vacío — eliminando sus entradas en `budgets`/`actuals` y sus movimientos históricos. La señal es el **monto vigente**, no el journal: un nodo vaciado a 0 SÍ se borra aunque haya registrado movimientos (BG-006; el journal es inmutable, y sin esta regla el nodo sería imborrable para siempre). La vía para vaciarlo es el reparent de FR-015.
- **Roll-up (FR-004, verificado `cellSums`):** NUNCA se persiste el total de un padre. `budget(parent,m)=Σ budget(leaf,m)` sobre `leafDescendants`; `actual(parent,m)=Σ actual(node,m)` sobre `subtreeIds` (incluye montos directos en categoría-hoja).
- **Traslado al crear 1ª subcategoría (FR-002, prototipo `addNode`):** al convertir categoría-hoja en padre, sus budgets/actuals se mueven a la nueva sub (los totales no caen).
- **Edición de hoja (FR-006, D-3, prototipo `commitEdit`):** `setLeafAmount` fija `max(0, round(valor))` en budgets/actuals de la **hoja**. NO hay rama de distribución a padres (divergencia v1 #3).
- **Semilla determinista (FR-013, `genBudget`):** base por hoja según `type` y `hash(id)` redondeada a 10.000; ejecutado = base × factor-mes × jitter; factores `{ene:.96,feb:1.07,mar:.86,abr:1.14,may:.91,jun:.55,jul..dic:0}`. Sin `Math.random` (todo por hash).
- **Preservación:** rebuild greenfield; claves/forma provienen del prototipo. No hay datos de producción que preservar.

## API Design

App client-only: la "API" es la **superficie del dominio + store** (contrato para Fase 3/4). Firmas idiomáticas TS.

### `domain/` (puro, sin React)
```ts
// rollup.ts
function leafDescendants(nodes: LedgerNode[], nodeId: string): string[];
function subtreeIds(nodes: LedgerNode[], nodeId: string): string[];
function rollupBudget(s: BudgetState, nodeId: string, month: MonthKey): number;
function rollupActual(s: BudgetState, nodeId: string, month: MonthKey): number;
// sign.ts (FR-008)
function signOf(type: NodeType): '+' | '−' | '↔';
type Variance = 'over' | 'favorable' | 'under' | 'neutral';
function varianceOf(type: NodeType, budget: number, actual: number): Variance;
// mutations (puras: reciben estado, devuelven estado nuevo)
function addMovement(s: LedgerState, input: NewMovement): LedgerState;                 // FR-001
function createNode(s: LedgerState, input: NewNode): LedgerState;                       // FR-002
function renameNode(s: LedgerState, id: string, name: string): LedgerState;             // FR-002
function deleteNode(s: LedgerState, id: string): { state: LedgerState } | { blocked: 'group_not_empty' }; // FR-003
function moveNode(s: LedgerState, id: string, dest: {kind:'category'|'group', id:string}):
  { state: LedgerState } | { rejected: 'cross_type' | 'invalid_target' };              // FR-015
function setLeafAmount(s: LedgerState, leafId: string, month: MonthKey, kind:'budget'|'actual', value: number): LedgerState; // FR-006
function buildSeed(ownerId: string): LedgerState;                                       // FR-013
function dashboardMetrics(s: LedgerState, period: {mode:'month'|'year', month?:MonthKey}): DashboardVM; // FR-009
```

### `LedgerRepository` (persistencia — punto de sustitución FR-014)
```ts
interface LedgerRepository {
  load(ownerId: string): Promise<LedgerState | null>;   // null si no hay datos → caller usa buildSeed
  save(ownerId: string, state: LedgerState): Promise<void>;
}
class ServerRepository implements LedgerRepository { /* fetch /api/v1/ledger; Zod al validar la respuesta */ }
// Retiradas de src/ por FR-1105: LocalStorageRepository y stripLegacyUnassigned.
// Los tests usan un fake en memoria (tests/helpers), no una segunda implementación de producción.
```

### `useLedgerStore` (Zustand — contrato de UI)
Cada acción de las User Flows tiene su operación: `addMovement`, `createNode`, `renameNode`, `deleteNode`, `moveNode`, `setLeafAmount`, `setPeriodFilter`, `hydrate`. Selectores memoizados: `useRollupBudget(id,m)`, `useRollupActual(id,m)`, `useVariance(...)`, `useDashboard(period)`, `useVisibleTree()`. Toda acción persiste vía `repository.save` tras mutar.

## Implementation Approach

Realización por MUST FR — método, contrato I/O y comportamiento ante fallo. Todo el cálculo vive en el dominio puro (`src/domain/*`) y la UI lo consume vía `useLedgerStore`; las acciones persisten con `repository.save` tras mutar.

- **FR-001 · Registrar movimiento** — *Método:* acción de dominio `addMovement(state, input)` con guarda previa `canSave({amount, catId})`; el monto se normaliza a entero COP ≥1 (`Math.max(1, round)`). *I/O:* `{ type, catId, subId?, month:MonthKey, amount:string|number, note? }` → nuevo `LedgerState` con el movimiento agregado y `actuals[leaf][month]` incrementado. *Fallo:* entrada inválida (monto <1, sin categoría) ⇒ `canSave=false`, la acción es no-op y el estado no muta (sin excepción).

- **FR-002 · CRUD de jerarquía 3 niveles** — *Método:* `createNode` / `renameNode` / `deleteNode` sobre árbol `LedgerNode[]` con `level ∈ {group,category,sub}` bajo 3 `type` FIJOS; `canRename`/`canDeleteNode` gobiernan la elegibilidad. *I/O:* `createNode(state,{type,level,parentId,name})` → estado con nodo nuevo (id `g-/c-/s-…` por slug); `renameNode(state,id,name)` con `name` 1..60. *Fallo:* nombre vacío/fuera de rango o nodo `system` ⇒ no-op; los tipos no son editables (invariante de eje de signo).

- **FR-003 · Borrado seguro (sin huérfanos)** — *Método:* `deleteNode` devuelve un `DeleteResult` discriminado (`{state}` | `{blocked:"has_children"|"has_data"}`); `canDeleteNode` gatea el control en la UI para que la acción ni se ofrezca cuando no aplica. *I/O:* `deleteNode(state,id)` → estado nuevo o rechazo con motivo; al borrar limpia `budgets`/`actuals` y los movimientos del subárbol. *Fallo:* borrar un nodo con hijos o con datos vigentes se rechaza sin mutar (cero huérfanos). *(Evolución: la política original del brief —convertir a "Sin asignar"— fue SUSTITUIDA por `grid-ux`/FR-110 con el bloqueo; BG-001/BG-002/BG-006 afinaron la señal a "monto vigente, no journal". El mecanismo `DeleteResult` es el mismo.)*

- **FR-004 · Roll-up jerárquico** — *Método:* funciones puras `rollupBudget` (suma de `leafDescendants`), `rollupActual` (suma de `subtreeIds`, incluye montos directos en categoría-hoja) y `typeTotals` por tipo. *I/O:* `(state, nodeId, month)` → `number` (COP entero). *Fallo:* nodo inexistente ⇒ `0`; ceros/negativos degenerados no producen `NaN`/`Infinity` (cubierto por TC-BSC-401f). *Guardrail:* recómputo ≤150ms (NFR-001/NFR-103, TC-212h).

- **FR-006 · Grilla de 12 meses (escritorio)** — *Método:* `BudgetGrid` con `div` flex (no `<table>`), columna de categoría sticky-izquierda y scroll horizontal; edición inline de celdas de hoja vía `setLeafAmount`. *I/O:* render de `useVisibleTree()` × 12 meses; edición `(leafId, month, kind, value)` → estado. *Fallo:* editar un nodo no-hoja (padre) es no-op (los padres son roll-up, no editables).

- **FR-008 · Tipo → signo/color/varianza** — *Método:* `sign.ts` deriva signo por tipo y `budgetState.ts` clasifica el estado (`within`/`over`/…) contra umbrales. *I/O:* `(type, budget, actual)` → `{sign, colorToken, state}`. *Fallo:* presupuesto 0 o valores negativos ⇒ estado degenerado seguro sin `NaN` (TC-BSC-401e/f).

- **FR-009 · Dashboard con filtro Mes/Año** — *Método:* `dashboard.ts` computa los 7 indicadores agregando `typeTotals` sobre el conjunto de meses del filtro. *I/O:* `useDashboard(period)` donde `period = {mode:'month'|'year', month?}` → `{ingresos, gastos, balance, …}`. *Fallo:* período sin ejecutado ⇒ KPIs en 0 (no error); el default abre en un período con ejecutado (FR-106/grid-ux).

- **FR-010 · Web responsive (móvil vs escritorio)** — *Método:* una sola app con breakpoint CSS; en móvil v1 se monta SOLO el módulo de registro (`MobileShell`), en escritorio la app completa (`DesktopShell`). *I/O:* viewport width → shell montado. *Fallo:* ninguna regresión de la vista móvil es un guardrail explícito (no se renderiza grilla/dashboard en móvil).

- **FR-011 · Persistencia en PostgreSQL como única fuente de verdad** — *Método:* `ServerRepository` guarda y carga el snapshot por `/api/v1/ledger`, con `baseRevision` para control optimista; el servidor valida con Zod y filtra por `ownerId`. *I/O:* `save(ownerId,state)` → bool · `load()` → estado validado o null. *Fallo:* sin datos ⇒ semilla (FR-013); 409 por revisión obsoleta ⇒ `resync` preservando la ventana de undo (BG-011); guardado que no llega o respuesta ilegible ⇒ `StorageBanner` (BG-012, BL-022), nunca un falso "guardado".

- **FR-012 · Sistema de diseño César Augusto** — *Método:* tokens **theme-aware** vía CSS custom properties (temas claro y oscuro, preferencia del sistema por defecto y toggle en la UI; bordes-sobre-rellenos); tipografía self-hosted vía `next/font`. *I/O:* tokens `--bg/--fg/--error/--success/…` resueltos por tema y aplicados por componente. *Fallo:* n/a (contrato visual estático). *(Evolución: `stack-upgrade-theme` FR-201/202/204/205 sustituyó el tema oscuro único por el par claro/oscuro sobre paleta zinc, con AA en ambos; `grid-ux/FR-109` reemplazó el mono Fira Code por Lexend + números tabulares.)*

- **FR-013 · Semilla determinística** — *Método:* `buildSeed(ownerId)` construye la jerarquía fija y `genBudget` deriva montos dummy por hoja/mes de forma determinística (hash del nombre, sin aleatoriedad). *I/O:* `buildSeed()` → `LedgerState` completo. *Fallo:* determinístico por diseño — misma entrada, misma semilla (verificable byte a byte).

- **FR-015 · Reparent por drag-drop** — *Método:* `moveNode(state, nodeId, dest, overflow=blockPolicy)` reubica un subárbol validando tipo y techo de 3 niveles; el manejo de desborde es una estrategia enchufable. *I/O:* `dest = {kind:'category'|'group'|'root', …}` → `{state}` o `{rejected:'cross_type'|'invalid_target'|'would_overflow'}`. *Fallo:* mover entre tipos distintos o desbordar el techo se rechaza sin mutar ni perder movimientos (cero huérfanos, NFR-602).

## Security Design

Superficie real (NFR-004, re-derivada): **app de servidor con usuarios autenticados** — hay endpoints, sesión,
secretos y datos personales que proteger. La redacción anterior ("client-only, sin backend, sin auth") describía
un sistema que dejó de existir con la feature `backend` (RQ-SEC-007).
- **Autenticación y sesión:** Better Auth con hashing **argon2id**; la sesión vive en Postgres e identifica al usuario en cada request (FR-501..FR-503). Cookie `SameSite`, que es la defensa CSRF efectiva.
- **Autorización:** `withApi` exige sesión válida antes de tocar datos (FR-504) y **todo** el contrato `/api/v1` filtra por `ownerId` (FR-507). Sin sesión no se lee ni se escribe nada.
- **Validación de entrada:** el cuerpo de la API se valida con Zod **antes** de castearlo (BG-012 — antes se casteaba a ciegas); monto = entero ≥1 COP (FR-001); nombres 1..60 no vacíos. Se rechaza en el borde del dominio, no solo en UI.
- **Origin:** la allowlist de `Origin` en mutaciones es **defensa en profundidad**, no la defensa principal: solo actúa si el header viene (RQ-SEC-008, aceptado y documentado).
- **Secretos:** por entorno, nunca en el repositorio. El quality gate `secret-scan` lo verifica en cada `verify-run` y `security-config` verifica la configuración de despliegue (ambos declarados tras la auditoría de seguridad).
- **XSS:** React escapa por defecto; **sin `dangerouslySetInnerHTML`**, sin `eval`/`Function`; nombres de categoría se renderizan como texto. La CSP conserva `unsafe-inline` por decisión registrada (RQ-SEC-001, P2 abierto).
- **Security headers (Next/Nginx):** CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- **Almacenamiento del cliente:** `localStorage` no guarda dato financiero alguno (FR-509) — solo preferencias del navegador.
- **Pendiente conocido:** el stream SSE no acota conexiones por usuario (RQ-SEC-009, P2).

## Performance & Scalability

- **Guardrail NFR-001 (≤150ms):** editar una hoja recalcula ancestros vía **selectores memoizados** (Zustand + reselect) que recomputan solo la rama afectada; keys estables por nodo/mes → React re-renderiza solo las celdas cambiadas, no 12×N.
- **Tamaño acotado:** 1 año por usuario → snapshot < 1MB. El modelo es snapshot-replace: cada guardado envía el libro entero, aceptable a este tamaño (la escritura incremental es BL-017, aún abierta). Sin paginación ni virtualización obligatoria.
- **Carga ≤2s (NFR-001):** bundle Next optimizado; **Recharts diferido** (`next/dynamic`) solo en Dashboard (escritorio), de modo que el móvil (solo Registrar) no paga ese costo. Fira Code `display:swap`.
- **Roll-up O(n) por rama:** `leafDescendants`/`subtreeIds` sobre índices `childrenByParent` precalculados; no recorre todo el árbol por celda.
- **Escalabilidad horizontal:** N/A en v1 (client-only). La interfaz `LedgerRepository` es donde Fase 2 introduce backend multi-instancia.

## Deployment Architecture

**Modelo: contenedor Docker** sirviendo Next.js (SPA client-side con server Node mínimo).
- **Imagen:** `node:20-alpine`, `next build` → `next start` (puerto 3000). Alternativa: `next export` estático tras Nginx (ADR-05).
- **Topología:** Ultron (Pi 5, 8GB) → **Nginx** reverse proxy (TLS + security headers + gzip) → contenedor Next. Portable a hosting profesional (misma imagen).
- **Config (12-factor):** `PORT`, `DATABASE_URL`, `BETTER_AUTH_SECRET` y `NEXT_PUBLIC_*` por entorno. Los secretos NUNCA en el repositorio (gate `secret-scan`).
- **Environments:** `dev` (`next dev`), `prod` (Docker en Ultron).
- **CI/CD (NFR-006):** en cada push a `main` → lint + typecheck + **suite completa de tests** + build; falla el pipeline si algo falla. **Smoke gate:** `smoke.sh` arranca el contenedor y hace `curl` a `/` esperando 200.
- **Observabilidad:** server Next loguea a stdout el request de `/`; app client-side con ErrorBoundary (fallback + recarga).

## Risk Analysis

**Top riesgos + mitigación:**
1. **Respuesta de la API corrupta o incompatible** → app rota o, peor, editando sobre datos que la fuente de verdad no confirma. Mitigación: Zod al validar (BG-012), semilla si no hay datos (NFR-003), y `StorageBanner` para que el fallo sea visible (BL-022); migraciones de esquema versionadas en el servidor (ensureV4InTx).
2. **Re-render de toda la grilla al editar** → incumple ≤150ms. Mitigación: selectores memoizados + keys estables + medición en Fase 3.
3. **Reestructurar un nodo con descendencia (FR-003/FR-015)** → ambigüedad de jerarquía. Mitigación: el borrado se bloquea mientras haya hijos (no hay degradación implícita), y en el reparent/demote la regla de aplanado es explícita y preserva cada `target`; cubierto por el invariante NFR-005 (cero huérfanos).
4. **Drag-drop accesibilidad/complejidad (@dnd-kit)** → interacción frágil. Mitigación: validación de destino por tipo, feedback ≤100ms, camino alterno "mover a…" por menú.
5. **Fidelidad visual del sistema de diseño** → drift vs prototipo. Mitigación: tokens `:root` exactos como contrato (FR-012) + tests de tokens y render por breakpoint (Fase 3).

### ADRs

**ADR-01: Framework de UI**
Context: la app web necesita routing, bundling e imagen desplegable; stack fijado a Next.js.
Option A: **Next.js 15 App Router** (cliente) — ecosistema, Docker estándar, shadcn/ui first-class; overhead de server Node para app client-only.
Option B: Vite + React SPA — más liviano, 100% estático; se desalinea del stack fijado y del deploy pedido.
Decision: **Next.js 15** — constraint del proyecto; da imagen Docker + `/` para el smoke gate. Consequences: deploy uniforme; server Node mínimo (aceptable en Pi 5).

**ADR-02: Gestión de estado**
Context: editar una celda debe recalcular roll-ups en ≤150ms sin re-render global (NFR-001).
Option A: **Zustand 4.x** — store fuera de React, selectores memoizados, render granular; una dependencia.
Option B: Context + useReducer — cero deps; Context re-renderiza todos los consumidores → grilla completa.
Decision: **Zustand** — cumple el guardrail. Consequences: render granular; librería activa (MIT, mínimas deps).

**ADR-03: Persistencia v1** — ⚠️ **SUPERADO** (ver ADR-03b)
Context: v1 sin backend; datos sobreviven recargas (FR-011) y permiten swap futuro (FR-014).
Option A: **localStorage tras `LedgerRepository`** — zero-ops, síncrono, alineado al prototipo; ~5MB, single-device.
Option B: IndexedDB (Dexie) — mayor capacidad; async y más complejo para <1MB.
Decision: **localStorage + interfaz repositorio** — suficiente y aísla el swap a Supabase. Consequences: simple/verificable; **single-device**.

**ADR-03b: PostgreSQL como única fuente de verdad** (sustituye a ADR-03)
Context: la app se aloja en un servidor y el usuario entra desde varios dispositivos esperando ver lo mismo. La
consecuencia "single-device" de ADR-03 resultó incompatible con el producto, y `localStorage` es legible por
cualquier JavaScript de la página — ante un XSS, el presupuesto completo se va en texto plano.
Option A: mantener los dos modos tras un interruptor (`NEXT_PUBLIC_LEDGER_SERVER_MODE`) — dos verdades que nadie
reconcilia, y un modo sin login que saltaba la sesión.
Option B: **retirar el modo localStorage; Postgres único**.
Decision: **Option B** (feature `servidor-fuente-unica`, FR-1101..FR-1103). Consequences: un solo punto de
construcción del repositorio; sesión obligatoria siempre; `localStorage` solo para preferencias (FR-509). Sin ruta
de importación de los datos que quedaran en algún navegador — aceptado a conciencia por no haber usuarios reales.
Se retiró también `stripLegacyUnassigned` (FR-1105), dejando los guards `!node.system` como única defensa ante
nodos heredados: declarado, no silenciado (ver ADR-04 de esa feature y la nota de BL-018).

**ADR-04: Roll-ups derivados vs almacenados**
Context: invariante "padre==Σ hojas" (FR-004, NFR-005) no debe romperse.
Option A: **Derivar por selector memoizado** — imposible desincronizar; recomputa por rama.
Option B: Almacenar totales de padres — lectura O(1) pero riesgo de desincronización.
Decision: **Derivar** — corrección por construcción; costo trivial al tamaño dado. Consequences: elimina una clase de bugs; recomputo memoizado.

**ADR-05: Empaquetado de despliegue**
Context: hosting en Ultron con Nginx; NFR-006 pide que el contenedor arranque y sirva.
Option A: **Docker `next start`** — soporta cualquier feature de Next; imagen algo mayor.
Option B: `next export` estático tras Nginx — imagen mínima; restringe features server y complica el smoke de `/`.
Decision: **Docker `next start`** — estándar, `/` responde 200, deja abierta rutas server en Fase 2. Consequences: server Node en Pi 5 (bajo consumo); reversible a estático.

**ADR-06: Drag-and-drop (FR-015)**
Context: reparent de subcategorías/categorías con validación por tipo y feedback ≤100ms.
Option A: **@dnd-kit/core 6.x** — accesible (teclado), sensores configurables, activo (MIT).
Option B: HTML5 Drag&Drop nativo — cero deps; API inconsistente entre navegadores, accesibilidad pobre.
Decision: **@dnd-kit** — control fino de destinos válidos + accesibilidad. Consequences: una dependencia enfocada; menor curva que react-dnd.

### Failure Blast Radius

Component: **ServerRepository + API (persistencia)**
Blast radius: servidor caído, red intermitente o respuesta ilegible → no carga/guarda. Es el fallo de mayor impacto del sistema: sin fuente de verdad no hay producto.
User impact: al cargar sin datos → **semilla** (no pantalla en blanco). Si un guardado no alcanza el servidor o la respuesta no valida, el estado sigue en memoria y el **`StorageBanner`** avisa en ambos shells (BL-022): el usuario NO sigue editando creyendo que se guardó. Ante 409 por revisión obsoleta, `resync` recarga preservando la ventana de undo (BG-011).
Recovery: el drenador reintenta con el último snapshot (coalescencia, BL-010); al recuperar la conexión converge sin intervención.

Component: **useLedgerStore (estado de dominio)**
Blast radius: excepción en acción/selector podría tumbar el árbol React de la vista activa.
User impact: **ErrorBoundary** por shell muestra "Algo salió mal — Recargar" en vez de app rota; los datos persistidos no se corrompen (mutación fallida no se guarda).
Recovery: recarga rehidrata desde la última persistencia válida; mutaciones puras (estado nuevo) → una que lanza no deja el store a medias.

## Technical Risk Flags

[RISK] Server Node de Next.js en Raspberry Pi 5 para app client-only
Conflict: la app no necesita SSR de datos, pero `next start` levanta un server Node (constraint de hosting Docker + Nginx en Pi 5).
Mitigation: `node:20-alpine`, Recharts diferido, sin data-fetching server; si molesta, ADR-05 permite caer a `next export` estático sin cambiar la app.
Severity: low

[RISK] Guardrail de ≤150ms en re-render de grilla (NFR-001)
Conflict: FR-004/FR-006 exigen recálculo de ancestros al instante; una implementación ingenua re-renderiza 12×N celdas.
Mitigation: Zustand + selectores memoizados + keys estables + Recharts `next/dynamic`; se mide explícitamente en Fase 3 (TC de rendimiento).
Severity: medium

[RISK] Semántica de borrado categoría→subcategoría con subcategorías anidadas (FR-003)
Conflict: degradar un nodo con descendencia choca con "sub siempre es hoja" (el conflicto original lo producía la conversión a "Sin asignar", ya retirada; hoy lo produce el demote de FR-702).
Mitigation: el borrado NO degrada nada — se bloquea mientras haya hijos. En el demote explícito, la regla de aplanado es explícita (los nietos pasan a subs del destino) y preserva cada `target`; cubierto por TC-753g-flatten y el invariante NFR-005 (cero huérfanos).
Severity: medium

[RISK] Accesibilidad/robustez del drag-and-drop (FR-015)
Conflict: reparent por arrastre puede ser frágil entre navegadores/entradas y difícil de testear.
Mitigation: @dnd-kit (soporte teclado), validación de destino por tipo antes de aplicar, y camino alterno "mover a…" por menú.
Severity: low
