# Technical Design Document (TRD / SDD) — Ledger (T-Ledger)

## Executive Summary

Ledger es una **app web SPA client-side** en **Next.js 15.x (App Router)** + **React 19** + **TypeScript 5.x**, estilada con **Tailwind CSS v4** + **shadcn/ui** (Radix), gráficos **Recharts 2.x**, íconos **lucide-react**, drag-and-drop **@dnd-kit/core 6.x**, validación **Zod 3.x**, estado **Zustand 4.x**. Persistencia v1 en **localStorage** detrás de una **capa de repositorio** (`LedgerRepository`) que aísla el almacenamiento para sustituirlo por Supabase en Fase 2 sin tocar la UI (FR-014).

El diseño se ancla en dos fuentes ya aprobadas: la **lógica de referencia verificada del prototipo** (`Ledger (offline).html` — roll-up, semilla determinista, claves `ledger.nodes.v1`/`ledger.budget.v2`, edición de hoja) y las **reglas de negocio v1** de Fases 1/UX (que se apartan del prototipo: sin distribución proporcional, "Sin asignar" por grupo, móvil solo Registrar, drag-drop, sin teclado numérico). Todo el dominio (jerarquía, roll-ups, borrado→"Sin asignar", reparent, semilla) vive en un **núcleo TypeScript puro** sin React ni DOM — esto hace verificables FR-002/003/004/008/015 y el invariante de regresión NFR-005.

**Decisiones clave (ADRs en §Risk Analysis):** Next.js 15 (constraint + imagen Docker + `/` para smoke) · Zustand con selectores memoizados (guardrail ≤150ms, NFR-001) · roll-ups **derivados, no almacenados** (invariante padre==Σhojas por construcción) · localStorage tras interfaz repositorio (swap a Supabase) · @dnd-kit para reparent accesible.

North Star: demo funcional end-to-end sin bugs. La arquitectura prioriza **corrección verificable del dominio** y **fidelidad visual** (tokens exactos del prototipo) sobre escalabilidad (fuera de v1).

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
│        │  + <RecentList>    │       │  Dashboard · CategoryTree      │ │
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
│        │  tree, rollup, sign,   │       │  ├ LocalStorageRepository   ││
│        │  seed, deleteToUnassign│       │  │   (v1, JSON + Zod)        ││
│        │  reparent, editLeaf    │       │  └ SupabaseRepository (F2)  ││
│        └────────────────────────┘       └──────────┬──────────────────┘│
│                                          ┌─────────▼──────────────────┐│
│                                          │ window.localStorage         ││
│                                          │ ledger.nodes.v1             ││
│                                          │ ledger.budget.v2            ││
│                                          └─────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
   Deploy: Docker (node:20-alpine, next start) → Nginx (TLS/headers) → Ultron (Pi 5)
```

**Componentes y responsabilidad:**
- **ResponsiveShell** — elige Mobile/Desktop por media-query 760px (FR-010). Única responsabilidad: layout raíz.
- **MobileShell** — monta SOLO `MovementForm` + `RecentList` (FR-001, FR-010, divergencia v1 #1). No importa grilla ni dashboard (garantiza que no estén en el DOM en móvil).
- **DesktopShell** — orquesta MovementPanel (slideIn), BudgetGrid, Dashboard, CategoryTree y el toggle Resumen/Dashboard.
- **BudgetGrid** — divs flex + sticky (columna categoría 240px, encabezados 12 meses); edición inline SOLO de celdas-hoja; drag-drop de reparent (FR-006, FR-015).
- **useLedgerStore (Zustand)** — única fuente de verdad en memoria; acciones (mutaciones puras del dominio) + selectores (roll-ups derivados memoizados). Persiste vía repositorio tras cada mutación.
- **domain/ (TS puro)** — funciones sin efectos: `rollup`, `signOf`, `varianceOf`, `deleteNodeToUnassigned`, `moveNode`, `editLeaf`, `buildSeed`. Núcleo verificable (Fase 3).
- **LedgerRepository** — interfaz de persistencia; `LocalStorageRepository` en v1 con validación Zod al leer. Punto de sustitución para Supabase (FR-014).

**Patrón de interacción:** client-side, síncrono. Sin red → toda mutación es efectivamente optimista: muta store → recomputa selectores → persiste (async, no bloquea render). Sin paginación (dataset acotado a 1 año). Sin real-time.

## Data Model

Persistencia: `window.localStorage`, **2 claves versionadas** (verificadas en el prototipo, §3.3). Todo validado con **Zod** al cargar; si falla → semilla (FR-011, NFR-003).

### Entidades (TypeScript)
```ts
type NodeType  = 'expense' | 'income' | 'transfer';   // 3 tipos FIJOS (FR-002, D-1)
type NodeLevel = 'group' | 'category' | 'sub';
type MonthKey  = 'ene'|'feb'|'mar'|'abr'|'may'|'jun'|'jul'|'ago'|'sep'|'oct'|'nov'|'dic';

interface LedgerNode {
  id: string;              // uid (prototipo: 'n' + base36(now) + rand); crypto.randomUUID en prod
  ownerId: string;         // FR-014 andamiaje multiusuario; default "local" en v1
  type: NodeType;          // heredado del tipo raíz; invariante en reparent (no cruza de tipo)
  level: NodeLevel;
  parentId: string | null; // null solo para grupos
  name: string;            // 1..60, no vacío
  icon: string | null;     // glifo Lucide (group/category) | null (sub)
  system?: boolean;        // true para "Sin asignar" (no renombrable/borrable)
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
- **"Sin asignar" (FR-003):** categoría `system:true`, `name:"Sin asignar"`, **una por grupo** (su `parent` es el grupo); creada perezosamente al primer borrado que la necesite dentro de ese grupo; oculta en UI si no tiene descendientes con datos. Montos editables; sin renombrar/borrar.
- **Borrado categoría con movimientos (FR-003):** la categoría se **re-parenta** como `sub` bajo la "Sin asignar" de su **grupo**, conservando su `id` → los `target` de sus movimientos siguen válidos (cero huérfanos). Si tenía subcategorías, se aplanan como hermanas dentro de "Sin asignar" (cada `target` preservado). Borrar hoja sin movimientos → directo (elimina sus entradas budgets/actuals). Grupo con categorías → bloqueado.
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
class LocalStorageRepository implements LedgerRepository { /* JSON + Zod.safeParse; parse error → null */ }
// Fase 2: class SupabaseRepository implements LedgerRepository (misma interfaz, sin cambios de UI)
```

### `useLedgerStore` (Zustand — contrato de UI)
Cada acción de las User Flows tiene su operación: `addMovement`, `createNode`, `renameNode`, `deleteNode`, `moveNode`, `setLeafAmount`, `setPeriodFilter`, `hydrate`. Selectores memoizados: `useRollupBudget(id,m)`, `useRollupActual(id,m)`, `useVariance(...)`, `useDashboard(period)`, `useVisibleTree()`. Toda acción persiste vía `repository.save` tras mutar.

## Security Design

Superficie de v1 (declarada explícitamente, NFR-004): **app web single-user, client-only, sin backend, sin auth, sin secretos, sin PII por red.** No hay endpoints, tokens ni DB que proteger en v1.
- **Validación de entrada (única frontera real):** monto = entero ≥1 COP con Zod antes de persistir (FR-001); nombres 1..60 no vacíos. Se rechaza en el borde de la acción del dominio, no solo en UI.
- **Integridad al cargar:** todo lo leído de localStorage pasa por `Zod.safeParse`; payload manipulado/corrupto NO se confía → se descarta y se regenera semilla (NFR-003). Evita inyección de estructuras vía localStorage adulterado.
- **XSS:** React escapa por defecto; **sin `dangerouslySetInnerHTML`**, sin `eval`/`Function`; nombres de categoría se renderizan como texto.
- **Security headers (Next/Nginx):** `Content-Security-Policy` (default-src 'self'; style/font-src para Google Fonts Fira Code), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Sin cookies, sin secretos en localStorage.
- **Andamiaje Fase 2:** `ownerId` reserva el eje multiusuario; auth (Clerk/Supabase), autorización por `ownerId` y TLS se diseñan en Fase 2 con backend — fuera de v1 (no_go_zone).

## Performance & Scalability

- **Guardrail NFR-001 (≤150ms):** editar una hoja recalcula ancestros vía **selectores memoizados** (Zustand + reselect) que recomputan solo la rama afectada; keys estables por nodo/mes → React re-renderiza solo las celdas cambiadas, no 12×N.
- **Tamaño acotado:** 1 año, single-user → payload localStorage < 1MB (límite ~5MB). Sin paginación ni virtualización obligatoria.
- **Carga ≤2s (NFR-001):** bundle Next optimizado; **Recharts diferido** (`next/dynamic`) solo en Dashboard (escritorio), de modo que el móvil (solo Registrar) no paga ese costo. Fira Code `display:swap`.
- **Roll-up O(n) por rama:** `leafDescendants`/`subtreeIds` sobre índices `childrenByParent` precalculados; no recorre todo el árbol por celda.
- **Escalabilidad horizontal:** N/A en v1 (client-only). La interfaz `LedgerRepository` es donde Fase 2 introduce backend multi-instancia.

## Deployment Architecture

**Modelo: contenedor Docker** sirviendo Next.js (SPA client-side con server Node mínimo).
- **Imagen:** `node:20-alpine`, `next build` → `next start` (puerto 3000). Alternativa: `next export` estático tras Nginx (ADR-05).
- **Topología:** Ultron (Pi 5, 8GB) → **Nginx** reverse proxy (TLS + security headers + gzip) → contenedor Next. Portable a hosting profesional (misma imagen).
- **Config (12-factor):** `PORT`, `NEXT_PUBLIC_*` por env; sin secretos en v1.
- **Environments:** `dev` (`next dev`), `prod` (Docker en Ultron).
- **CI/CD (NFR-006):** en cada push a `main` → lint + typecheck + **suite completa de tests** + build; falla el pipeline si algo falla. **Smoke gate:** `smoke.sh` arranca el contenedor y hace `curl` a `/` esperando 200.
- **Observabilidad:** server Next loguea a stdout el request de `/`; app client-side con ErrorBoundary (fallback + recarga).

## Risk Analysis

**Top riesgos + mitigación:**
1. **Corrupción/incompatibilidad de esquema en localStorage** → app rota. Mitigación: versión + Zod safeParse + fallback a semilla (NFR-003); migraciones futuras versionadas.
2. **Re-render de toda la grilla al editar** → incumple ≤150ms. Mitigación: selectores memoizados + keys estables + medición en Fase 3.
3. **Borrado categoría→sub con subcategorías anidadas (FR-003)** → ambigüedad de jerarquía. Mitigación: regla explícita (aplanar subs como hermanas bajo "Sin asignar"; `target` preservado) + test de invariante NFR-005.
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

**ADR-03: Persistencia v1**
Context: v1 sin backend; datos sobreviven recargas (FR-011) y permiten swap futuro (FR-014).
Option A: **localStorage tras `LedgerRepository`** — zero-ops, síncrono, alineado al prototipo; ~5MB, single-device.
Option B: IndexedDB (Dexie) — mayor capacidad; async y más complejo para <1MB.
Decision: **localStorage + interfaz repositorio** — suficiente y aísla el swap a Supabase. Consequences: simple/verificable; single-device (ok en v1).

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

Component: **LocalStorageRepository (persistencia)**
Blast radius: JSON corrupto o localStorage no disponible (modo privado/quota) → no carga/guarda.
User impact: al cargar, `safeParse` falla → se muestra **semilla** (no pantalla en blanco); si `setItem` lanza (quota) → toast "No se pudo guardar" y el estado sigue en memoria durante la sesión.
Recovery: recarga regenera semilla; ErrorBoundary ofrece "Reiniciar datos" (limpia claves y reconstruye semilla).

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
Conflict: convertir una categoría (que puede tener subs) en `sub` bajo "Sin asignar" choca con "sub siempre es hoja".
Mitigation: regla explícita — al degradar, las subs se aplanan como hermanas dentro de "Sin asignar", preservando cada `target`; cubierto por test de invariante NFR-005 (cero huérfanos).
Severity: medium

[RISK] Accesibilidad/robustez del drag-and-drop (FR-015)
Conflict: reparent por arrastre puede ser frágil entre navegadores/entradas y difícil de testear.
Mitigation: @dnd-kit (soporte teclado), validación de destino por tipo antes de aplicar, y camino alterno "mover a…" por menú.
Severity: low
