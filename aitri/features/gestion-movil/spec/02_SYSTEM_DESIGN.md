# Technical Design Document (TRD / SDD)

Feature **gestion-movil** (BL-089). Segunda entrega del teléfono: organizar la estructura y cerrar o reabrir el mes.
Extiende la arquitectura de `presupuesto-movil` sin fundar una paralela: mismas capas, misma pila de pantallas, mismo
store, mismo guardado.

## Executive Summary

**No hay stack nuevo ni dependencias nuevas.** La feature es código de presentación para el shell móvil más dos
view-models puros en el dominio:

- **Next.js 15.5 (App Router) + React 19**, la app existente. Todo es cliente (`"use client"`), dentro de
  `src/components/mobile/`. Motivo: las pantallas del teléfono ya viven ahí y comparten la pila de pantallas.
- **Zustand (el store vigente, `src/state/store.ts`)** sin acciones nuevas: se llaman `createNode`, `renameNode`,
  `setNodeIcon`, `deleteNode`, `moveNode`, `closeMonth`, `reopenMonth` y el hook `useClosureStatus`, que son los que
  usa escritorio. Motivo: es la garantía de «mismo resultado y mismos bloqueos» (North Star y guardrail).
- **Dominio TypeScript puro (`src/domain/`)**: se reusan `createNode`, `renameNode`, `setNodeIcon`,
  `deleteBlockReason`, `moveNode`, `nextReopenable`, `closeBlockerText`, `isLeaf`, `orderedGroups`,
  `orderedChildren`. Se añade **un módulo de lectura**, `src/domain/structureView.ts`, con dos funciones puras que
  no escriben ni deciden reglas: preguntan a las funciones anteriores.
- **Tailwind v4 + tokens de `globals.css`, `ui/button`, `ui/input`, lucide-react**: sin tokens ni componentes base
  nuevos (UX spec).
- **Servidor, base de datos y rutas: sin cambios.** Sin migraciones, sin endpoints, sin variables de entorno.
- **Pruebas:** Vitest 5 (dominio e integración con Testing Library) y Playwright (e2e a 375 y 360 px), los runners
  vigentes.

Tres decisiones con alternativa real, documentadas como ADR en Risk Analysis: dónde viven las pantallas nuevas
(ADR-01), de dónde sale la lista de destinos de «Mover a…» (ADR-02) y cómo se informa el resultado del cierre sin
tocar las acciones del store (ADR-03). Dos más de menor peso: el selector de íconos (ADR-04) y las pruebas vigentes
que cambian a propósito (ADR-05).

## System Architecture

```
┌──────────────────────────── Navegador del teléfono (≤760 px) ─────────────────────────────┐
│ MobileShell (vigente, sin cambios)                                                         │
│   └─ MobileBudget (vigente; + despacha 5 pantallas nuevas y 2 botones en el título)        │
│        ├─ lista del periodo (vigente)  PeriodBar · ClosedNotice* · SummaryCard · Sections* │
│        ├─ LeafScreen / MovementEditScreen / WithdrawalsScreen / BalanceScreen (vigentes)   │
│        ├─ OrganizeScreen      [NUEVO]  árbol sin cifras · «＋ Grupo»            FR-3201     │
│        ├─ NodeScreen          [NUEVO]  identidad · acciones · borrar · ícono   FR-3201/03/04/05 │
│        ├─ NewNodeScreen       [NUEVO]  nombre · aviso de traslado · «Crear»    FR-3202     │
│        ├─ MoveScreen          [NUEVO]  destinos válidos y bloqueados           FR-3206     │
│        └─ ClosureScreen       [NUEVO]  bloque Cerrar · bloque Reabrir          FR-3207/08  │
│   (* = solo cambia el texto: FR-3209 y el vacío de sección)                                │
│                                                                                            │
│ screenStack.ts (vigente; + 5 variantes de Detail)   URL ?v=p&d=…  ⇄  history               │
│                                                                                            │
│ src/domain/structureView.ts [NUEVO, puro]                                                  │
│   organizeTree(state) ─────────► orderedGroups / orderedChildren                           │
│   moveDestinations(state, id) ─► moveNode (ensayo, sin escribir)                           │
│                                                                                            │
│ useLedgerStore (vigente, SIN acciones nuevas)                                              │
│   createNode · renameNode · setNodeIcon · deleteNode · moveNode ──► persist(data)          │
│   closeMonth · reopenMonth ──► repo.closure()        useClosureStatus()                    │
└───────────────┬───────────────────────────────────────────────┬────────────────────────────┘
                │ PUT /api/v1/ledger (vigente)                  │ POST /api/v1/closure (vigente)
                ▼                                               ▼
┌──────────────────────────── Servidor Next (sin cambios) ───────────────────────────────────┐
│ withApi (sesión + Origin) → reglas del dominio → Postgres 16 → SSE /api/v1/sync/stream     │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Componentes y responsabilidad**

| Componente | Archivo | Responsabilidad | Estado |
|---|---|---|---|
| `screenStack` | `src/components/mobile/screenStack.ts` | Qué pantalla se ve, respaldada por la URL y el historial. Se amplía `Detail`, `parseScreen`, `toSearch` y `parentOf` | modificado |
| `MobileBudget` | `src/components/mobile/MobileBudget.tsx` | Despacha la pantalla; pinta el título con los botones «Organizar» y «Cierre»; redirige enlaces rotos | modificado |
| `ClosedNotice` | `src/components/mobile/PeriodBar.tsx` | Aviso de periodo cerrado con el copy nuevo y el enlace a Cierre de mes | modificado (copy) |
| `BudgetSections` | `src/components/mobile/BudgetSections.tsx` | Texto de sección vacía con el enlace «Crear la primera ›» | modificado (copy) |
| `OrganizeScreen` | `src/components/mobile/OrganizeScreen.tsx` | Pinta `organizeTree`; abre `NodeScreen` y `NewNodeScreen` | nuevo |
| `NodeScreen` | `src/components/mobile/NodeScreen.tsx` | Identidad, renombrar, lista de acciones, confirmación y motivo de borrado; aloja `IconGrid` | nuevo |
| `IconGrid` | `src/components/mobile/IconGrid.tsx` | Búsqueda y cuadrícula sobre `ICON_CATALOG` | nuevo |
| `NewNodeScreen` | `src/components/mobile/NewNodeScreen.tsx` | Campo de nombre, aviso de traslado, «Crear» | nuevo |
| `MoveScreen` | `src/components/mobile/MoveScreen.tsx` | Pinta `moveDestinations`; aplica `moveNode` | nuevo |
| `ClosureScreen` | `src/components/mobile/ClosureScreen.tsx` | Bloques Cerrar y Reabrir con confirmación, espera y error | nuevo |
| `structureView` | `src/domain/structureView.ts` | `organizeTree` y `moveDestinations`: lectura pura para las pantallas | nuevo |
| `nodeText` | `src/components/mobile/nodeText.ts` | Sustantivos por nivel y textos de bloqueo (un solo lugar para el copy) | nuevo |

Regla de capas (la misma de `presupuesto-movil`): **las pantallas pintan y llaman acciones; no validan ni calculan**.
Toda decisión —si se puede borrar, si un destino es válido, qué mes es cerrable— sale del dominio o del store.

## Data Model

**Contrato de preservación: el esquema y los datos no cambian.** Ninguna tabla, columna, índice ni forma del
snapshot se toca. La feature escribe exclusivamente por las acciones vigentes, que producen las mismas formas:

- `LedgerNode { id, type, level: "group"|"category"|"sub", parentId, name, icon: string|null, order, system }` —
  intacto. Crear añade un nodo con `order = nodes.length`; mover cambia `parentId`/`level` del nodo y de su
  subárbol y re-deriva `catId`/`subId` de los movimientos (`repairMovementCats`); borrar quita el nodo.
- `budgets`, `actuals`, `movements`, `cellNotes`: los traslados al primer hijo (FR-002, FR-604) y el arrastre de
  comentarios (BG-077) los hace el dominio, como en escritorio.
- `closure { closedThrough, reopened }` y la tabla de eventos de cierre (solo INSERT): las escribe el servidor.

**Delta: solo estado de interfaz, no persistido.**

```ts
// screenStack.ts — variantes nuevas de Detail (en la URL: ?v=p&d=<kind>&…)
| { kind: "organize" }                                             // d=org
| { kind: "node"; id: string }                                     // d=node&id=<nodeId>
| { kind: "new"; parentId: string | null; type: NodeType }         // d=new&id=<parentId>  |  d=new&t=<type>
| { kind: "move"; id: string }                                     // d=move&id=<nodeId>
| { kind: "closure" }                                              // d=cierre
```

`id` y `t` son entrada no confiable: `t` solo acepta `income | expense | transfer`; `id` es texto opaco que solo se
BUSCA en el estado. `parentOf`: `node` → `organize`; `new` → `node(parentId)` u `organize`; `move` → `node(id)`;
`organize` y `closure` → la lista.

Estado local de cada pantalla (React `useState`, se pierde al salir, que es lo que el UX spec pide): modo edición
del nombre, borrador del nombre, selector de ícono abierto y su búsqueda, confirmación abierta, fase del cierre
(`idle | confirming | busy | failed`).

## API Design

**Red: sin endpoints nuevos ni modificados (NFR-3208, NFR-3209).** Contratos vigentes que la feature usa tal cual:

| Uso | Endpoint | Quién lo llama | Respuestas relevantes |
|---|---|---|---|
| Guardar estructura | `PUT /api/v1/ledger` (snapshot + revisión) | `persist(data)` del store | 200 · 409 conflicto de revisión · 422 regla de dominio · 401 |
| Cerrar / reabrir | `POST /api/v1/closure` `{ action: "close" \| "reopen", revision }` | `repo.closure()` desde `closeMonth` / `reopenMonth` | 200 con `closure` · 409 · 422 `not_closable` / `unbalanced_cells` / `already_reopened` · 401 |
| Sincronización | `GET /api/v1/sync/stream` (SSE) | el store | sin cambios |

**Superficie interna nueva** (lo único que se añade al contrato del código):

```ts
// src/domain/structureView.ts
export interface OrganizeRow { id: string; name: string; icon: string | null; level: NodeLevel; depth: 0|1|2; system: boolean }
export interface OrganizeSection { type: NodeType; groups: { group: OrganizeRow; rows: OrganizeRow[] }[] }
/** El árbol completo por tipo, en el orden de escritorio. rows = el grupo y todo su subárbol, aplanado en preorden. */
export function organizeTree(state: LedgerState): OrganizeSection[];

export type MoveOutcome = "group" | "category" | "sub";
export interface MoveOption {
  dest: MoveDest;                 // lo que se pasa a moveNode
  name: string;                   // rótulo del destino (para root: el nombre del tipo)
  icon: string | null;
  depth: 0 | 1;                   // sangría
  becomes: MoveOutcome;           // root→group, group→category, category→sub
  status: "ok" | "current" | "overflow";
}
/** Destinos del MISMO tipo, sin el propio nodo ni sus descendientes ni subcategorías. `status` sale de ensayar moveNode. */
export function moveDestinations(state: LedgerState, id: string): { toRoot: MoveOption | null; options: MoveOption[] };
```

```ts
// src/components/mobile/nodeText.ts
export const LEVEL_NOUN: Record<NodeLevel, { one: string; created: string; deleted: string; fem: boolean }>;
export const CHILD_LEVEL: Record<"group" | "category", NodeLevel>;         // group→category, category→sub
export function deleteBlockText(block: DeleteBlock, level: NodeLevel): string; // los tres textos del UX spec (F6)
```

**Superficie preservada (no cambia de firma ni de comportamiento):** todas las acciones del store listadas en el
Executive Summary, `useClosureStatus`, `IconPicker` de escritorio, `ICON_CATALOG` y `NodeIcon`.

## Implementation Approach

FR-3201: Cada elemento ofrece sus acciones de estructura
Method: pantalla `OrganizeScreen` que pinta `organizeTree(state)`; cada fila es un `<button>` que hace
`openScreen({ kind: "node", id })`. `NodeScreen` compone la lista de acciones por nivel: «Renombrar» y «Borrar» si
`canRename(node)` / `canDelete(node)` (no `system`); «Añadir» si `level !== "sub"`; «Mover a…» y «Cambiar ícono»
siempre. Los tipos no tienen `NodeScreen`: su única acción es «＋ Grupo» en el encabezado de sección. Entrada:
botones «Organizar» y «Cierre» en la línea del `h1` de la lista.
I/O: `LedgerState` → `OrganizeSection[]`; toque → entrada de historial `?v=p&d=node&id=…`.
Failure: `d=node`/`move`/`new` con un `id` que no existe (enlace roto, borrado en otro dispositivo) → `replaceScreen`
a `organize`, nunca pantalla en blanco (mismo patrón que `brokenLeaf`).

FR-3202: Crear grupos, categorías y subcategorías
Method: `NewNodeScreen` con borrador local; «Crear» llama `store.createNode({ level, parentId, type, name: draft.trim() })`.
El nivel sale del padre (`CHILD_LEVEL`) o es `group` si `parentId === null`. El aviso de traslado se muestra si el
padre es hoja (`isLeaf`) y `deleteBlockReason(state, parentId, periods) === "has_data"` (misma pregunta «¿tiene
valores?» que ya responde el dominio, sin exportar un predicado nuevo). Tras crear: `goBack()` y `showToast`.
I/O: `{ parentId | type, draft: string }` → id del nodo nuevo (`string`) o `null`.
Failure: `draft.trim() === ""` → botón deshabilitado, no se llama a la acción. `createNode` devuelve `null`
(forma inválida: padre borrado mientras tanto) → no se navega y se muestra «No se pudo crear: el elemento donde iba
ya no existe.» Fallo de guardado → `StorageBanner` vigente.

FR-3203: Renombrar
Method: `NodeScreen` en modo edición; «Guardar» llama `store.renameNode(id, draft)`. Habilitado solo si
`draft.trim() !== "" && draft.trim() !== node.name`.
I/O: `(id, name: string)` → estado con el nombre nuevo; el `h1` lee `node.name` del store, así que se actualiza solo.
Failure: nombre vacío no llega a la acción; si llegara, `renameNode` del dominio conserva el anterior. «Cancelar»
descarta el borrador.

FR-3204: Cambiar el ícono
Method: `IconGrid` filtra `ICON_CATALOG` por `name.toLowerCase().includes(q)` (el mismo criterio que `IconPicker`)
y pinta celdas de 48 px en una cuadrícula `repeat(auto-fill, 48px)`; tocar una llama `store.setNodeIcon(id, name)` y
cierra.
I/O: `(id, icon: string)` → estado con `node.icon` nuevo.
Failure: búsqueda sin resultados → texto de vacío; cerrar sin elegir no llama a la acción.

FR-3205: Borrar solo cuando escritorio lo permitiría, diciendo por qué
Method: al tocar «Borrar», `deleteBlockReason(state, id, store.activePeriods())`. `null` → confirmación; al
confirmar, `store.deleteNode(id)`: si devuelve `"ok"`, `replaceScreen(organize)` + toast; si devuelve un
`DeleteBlock` (cambió entre medias), se cierra la confirmación y se muestra su texto. Distinto de `null` → sin
confirmación, se muestra `deleteBlockText(block, level)`.
I/O: `(state, id, periods)` → `null | "has_children" | "has_data" | "has_operations"`; `deleteNode(id)` → `"ok" | DeleteBlock`.
Failure: nunca se borra sin que `deleteNode` devuelva `"ok"`; la pantalla no decide el bloqueo.

FR-3206: «Mover a…», incluido convertir en grupo y bajar de nivel
Method: `moveDestinations(state, id)`: recorre `orderedGroups(type)` y `orderedChildren` (solo grupos y categorías),
descarta el nodo y su subárbol (`subtreeIds`), y para cada candidato ensaya `moveNode(state, id, dest)`:
`rejected: "would_overflow"` → `status: "overflow"`; `invalid_target` → se omite; resultado con estado → `"ok"`,
salvo que `dest` sea el padre actual → `"current"`. `toRoot` es `null` si el nodo ya es grupo. La pantalla llama
`store.moveNode(id, dest)` solo en opciones `ok`; con `"ok"` hace `goBack()` (vuelve a `NodeScreen`, que muestra la
ruta nueva) y toast «Movido a <nombre>».
I/O: `(state, id)` → `{ toRoot, options }`; `store.moveNode(id, dest)` → `"ok" | "cross_type" | "invalid_target" | "would_overflow"`.
Failure: un rechazo al aplicar (estado cambiado) deja el libro intacto y muestra bajo esa fila «Vacía o mueve las
subcategorías primero» (overflow) o «Ese lugar ya no está disponible.» (otros). Sin opciones `ok` → texto «No hay
otro lugar donde quepa».

FR-3207: Cerrar el mes cerrable, con confirmación
Method: `ClosureScreen` lee `useClosureStatus()`; el motivo es `closeBlockerText(blockedBy)`. Máquina local
`idle → confirming → busy → idle | failed`. En `busy` hace `await store.closeMonth()` (la acción vigente, que no
propone el mes: el servidor decide). Para saber si cerró, compara `closure.closedThrough` leído del store antes y
después del `await` (ADR-03). Un guard `if (phase === "busy") return` más el `exclusive` del store impiden el doble
cierre.
I/O: toque → `POST /api/v1/closure { action: "close" }` → `closure` nuevo en el store.
Failure: frontera sin cambio tras el `await` → fase `failed` con «No se pudo cerrar. Revisa la conexión e inténtalo
de nuevo.»; el store ya muestra su aviso con el motivo concreto (celdas descuadradas, nada que cerrar) y resincroniza
si hace falta. Con `blockedBy` no vacío el botón está deshabilitado y el motivo se pinta sin truncar.

FR-3208: Reabrir el último mes cerrado
Method: mismo patrón con `store.reopenMonth()`; el éxito se detecta porque `closure.reopened` pasa a ser el periodo
que el bloque ofrecía. Estados del bloque: `reopenable` → botón; `reopened && !reopenable` → texto «<mes> está
reabierto…»; ninguno → «Aún no has cerrado ningún mes.»
I/O: toque → `POST /api/v1/closure { action: "reopen" }`.
Failure: sin cambio tras el `await` → «No se pudo reabrir. Revisa la conexión e inténtalo de nuevo.»; el periodo
sigue cerrado.

FR-3209: El aviso de periodo cerrado ya no manda a escritorio
Method: `ClosedNotice` recibe el periodo y lee `nextReopenable(closure)`. Si coincide con el periodo: texto +
enlace que hace `openScreen({ kind: "closure" })`. Si no: texto que nombra el reabrible (`cycleLabel`), sin enlace.
Se usa en la lista, `LeafScreen` y `WithdrawalsScreen` sin cambiar sus props.
I/O: `(period, closure)` → texto con o sin enlace.
Failure: `nextReopenable` nulo con el periodo cerrado (hay otro mes reabierto) → texto «…Solo se puede reabrir
el último mes cerrado.» sin nombrar ninguno.

FR-3210: Las pantallas nuevas caben y se tocan con el dedo
Method: mismas clases que las pantallas vigentes: contenedor `px-5` del shell, `min-w-0` + `truncate` en nombres de
fila, `break-words` en la tarjeta de identidad y en los motivos, alturas por token (`h-(--control-md)`,
`min-h-(--control-lg)`), cuadrícula de íconos por `auto-fill`. Sin anchos fijos que sumen más de 320 px.
I/O: n/a (presentación).
Failure: n/a; lo verifica la prueba de `scrollWidth === clientWidth` a 375 y 360 px con nombres de 60 caracteres.

FR-3211: Lo que se cambia en el teléfono queda guardado y se ve en escritorio
Method: ninguna pantalla guarda por su cuenta: las acciones del store ya hacen `set({ data })` + `persist(data)` y
el cierre va por `repo.closure`. `StorageBanner` se monta en las pantallas nuevas dentro de `MobileShell`, que ya lo
envuelve.
I/O: acción del store → `PUT /api/v1/ledger` → SSE a las demás sesiones.
Failure: guardado rechazado → `StorageBanner` y la convergencia vigente del store (`convergerTrasConflicto`); al
recargar, el libro es el del servidor.

**NFR → decisión de diseño**
- NFR-3201 (escritorio no cambia): no se toca `BudgetGrid`, `ClosureControl`, `IconPicker` ni las acciones del store.
- NFR-3202 (la primera entrega sigue igual): `BudgetSections` y las pantallas vigentes solo cambian dos textos; las
  filas no reciben controles nuevos (decisión de UX «modo Organizar»).
- NFR-3203 (el registro conserva lo escrito): el registro sigue siempre montado (ADR-05 de `presupuesto-movil`); las
  pantallas nuevas viven dentro de `MobileBudget`.
- NFR-3204 (borrado): única fuente `deleteBlockReason` / `deleteNode`.
- NFR-3205 (orden del cierre): la petición no lleva mes; `ClosureScreen` solo ofrece `closable` y `reopenable`.
- NFR-3206 (periodo cerrado): `closed` sigue llegando a las pantallas vigentes igual; el servidor conserva el 422.
- NFR-3207 (dashboard, grilla y corte): `MobileShell` y el breakpoint no se tocan.
- NFR-3208 / NFR-3209: sin rutas nuevas. NFR-3210: las specs nuevas entran por el patrón de archivos vigente.

## Security Design

**NFR-3208 — No aplica**, por la razón que dio la fase 1: sin endpoints, sesiones, secretos ni entradas nuevas en el
servidor; el teléfono usa las mismas acciones y el mismo `/api/v1` autenticado, validado y filtrado por dueño.

Lo que se cuida igualmente en el cliente:
- **URL como entrada no confiable:** `parseScreen` solo acepta los `d` conocidos; `t` se valida contra los tres
  tipos; `id` nunca se interpola en HTML ni se usa más que para `findNode`. Un valor desconocido cae a la lista.
- **Nombres:** se pintan como texto de React (escapado); no hay `dangerouslySetInnerHTML`. La validación de forma
  sigue en el servidor (zod) al guardar.
- **Autoridad:** deshabilitar un botón es ergonomía. El servidor sigue rechazando un cierre fuera de orden, una
  cifra de periodo cerrado y cualquier snapshot inválido.
- **Límite de confianza:** no cambia — navegador ↔ `withApi` (sesión + Origin).

## Performance & Scalability

- `organizeTree` es O(n) sobre los nodos (hoy ~60); se memoiza por identidad de `data.nodes` con `useMemo`.
- `moveDestinations` ensaya `moveNode` una vez por candidato: O(c · n) con c ≤ número de grupos y categorías (~45) y
  n nodos + movimientos (el ensayo re-deriva `catId`). Con el libro real (cientos de movimientos) queda en pocos
  milisegundos; se calcula **solo al abrir** `MoveScreen`, memoizado por `data`, nunca al pintar la lista.
- El selector de íconos pinta el catálogo completo (decenas de íconos ya empaquetados); sin virtualización.
- Las pantallas nuevas se cargan con el resto del shell móvil; no se añade peso de dependencias.
- Sin efecto sobre NFR-3107 de `presupuesto-movil` (≤150 ms al cambiar de periodo): la lista no calcula nada nuevo.

## Deployment Architecture

**Modelo de despliegue: contenedor, sin cambios.** La misma imagen Docker (`next start`) detrás de Nginx en Ultron.
- Sin migraciones y sin variables de entorno nuevas.
- Ambientes: dev local (`:3100` + Postgres en Docker), CI (GitHub Actions: `test:run`, `test:e2e`, gates de calidad)
  y producción (Ultron). El despliegue lo corre el usuario y termina con `scripts/verificar-prod.sh`.
- Rama: `develop`, PR directo a `main` con merge commit (sin squash).

## Risk Analysis

**ADR-01: Dónde viven las pantallas nuevas**
Context: hacen falta cinco pantallas con «atrás» del navegador (UX: app web, sin hojas inferiores).
Option A: Variantes nuevas de `Detail` en `screenStack` — un solo mecanismo de navegación, historial y enlaces
rotos ya resueltos; `MobileBudget` crece.
Option B: Rutas de Next (`/organizar`, `/cierre`) — URL más legibles, pero desmontan el shell: se pierde lo escrito
en Registrar (rompe NFR-3203) y se rehidrata el store en cada salto.
Option C: Diálogos modales — sin entrada de historial, el «atrás» saldría de la app.
Decision: A — es la arquitectura aprobada del teléfono (ADR-01 de `presupuesto-movil`).
Consequences: `MobileBudget` despacha nueve pantallas; para que no crezca más, el despacho se extrae a una función
`renderDetail` y cada pantalla nueva es un archivo propio.

**ADR-02: De dónde sale la lista de destinos de «Mover a…»**
Context: escritorio valida el destino al soltar; el teléfono tiene que listar los válidos antes de tocar.
Option A: View-model puro en el dominio que ensaya `moveNode` por candidato — cero reglas duplicadas, probado sin
DOM; coste O(c · n) al abrir la pantalla.
Option B: Reimplementar las reglas (mismo tipo, techo de 3 niveles, no descendientes) en el componente — más barato
de ejecutar, pero una segunda lista de reglas que acabaría discrepando (el defecto que BG-080 (f) corrigió en
escritorio).
Decision: A.
Consequences: si cambia una regla de `moveNode`, la lista del teléfono cambia sola. El filtro previo (mismo tipo,
sin subárbol propio, sin subcategorías) es solo para no listar ruido; quien decide `ok` u `overflow` es `moveNode`.

**ADR-03: Cómo sabe la pantalla si el cierre funcionó**
Context: `closeMonth` y `reopenMonth` devuelven `Promise<void>` y avisan por `Toaster` con textos de escritorio
(«Mes cerrado.», «Mes reabierto: ya puedes corregirlo.»). El UX spec pide un error dentro del bloque y avisos con el
nombre del mes.
Option A: Cambiar las acciones para que devuelvan el resultado y acepten el texto — limpio para el teléfono, pero
toca el contrato y los textos que usa escritorio (NFR-3201) y sus pruebas.
Option B: Dejar las acciones como están y deducir el resultado comparando la frontera de cierre antes y después del
`await` — no toca nada vigente; el aviso de éxito es el del store.
Decision: B.
Consequences: **desviación declarada del UX spec** en un punto de copy: tras cerrar o reabrir, el aviso del
`Toaster` es el vigente («Mes cerrado.» / «Mes reabierto: ya puedes corregirlo.»), no «Septiembre cerrado». El mes
ya está nombrado en el botón y en la confirmación, y el bloque pasa al estado siguiente. En un fallo se ven dos
mensajes coherentes: el del store (el motivo concreto) y el del bloque (qué hacer). Si el usuario quiere el aviso
con el nombre del mes, es un cambio de una línea en el store que también cambia escritorio.

**ADR-04: El selector de íconos en el teléfono**
Context: `IconPicker` es un popover de 264 px con celdas de 36 px, por debajo del mínimo táctil de 40 px.
Option A: Componente móvil `IconGrid` sobre el mismo `ICON_CATALOG` y el mismo criterio de búsqueda — celdas de
48 px, desplegado en la pantalla; duplica unas 15 líneas de filtro y cuadrícula.
Option B: Parametrizar `IconPicker` (tamaño de celda, sin popover) — un solo componente, pero cambia uno de
escritorio con pruebas propias (NFR-3201) para servir un caso que no comparte presentación.
Decision: A — desviación del estándar padre ya justificada en el UX spec.
Consequences: si el catálogo cambia, cambia en los dos porque ambos leen `ICON_CATALOG`.

**ADR-05: Pruebas vigentes que cambian a propósito**
Context: dos aserciones de `presupuesto-movil` fijan el texto «reábrelo desde el cierre de mes en el computador»
(`tests/integration/presupuesto-movil-pantallas.test.ts` y `tests/e2e/presupuesto-movil.spec.ts`), y FR-3209 lo
cambia.
Option A: Reescribir esas dos aserciones al copy nuevo, dejando el motivo escrito — el enunciado anterior es falso
desde esta feature.
Option B: Conservar el texto viejo y añadir el enlace al lado — las pruebas siguen en verde pero el aviso mandaría
al computador para algo que ya se hace en el teléfono (incumple FR-3209).
Decision: A.
Consequences: son las ÚNICAS aserciones vigentes que se tocan; se actualizan en un commit propio con el motivo. No
son anclas vigiladas (las anclas son TC-CDM-202e y TC-RES-202e, sobre multi-año y techo-de-flujo, que esta feature
no toca). Ninguna prueba se borra ni se salta. El texto de sección vacía («Se crean desde el computador») no tiene
aserción vigente; se cubre con una prueba nueva.

**Failure Blast Radius**

Component: Guardado del libro (`PUT /api/v1/ledger`)
Blast radius: crear, renombrar, ícono, borrar y mover no se persisten.
User impact: el cambio se ve en pantalla (optimista) y aparece el `StorageBanner`; al recargar, el libro es el del
servidor.
Recovery: reintento y convergencia vigentes del store; el usuario repite la operación.

Component: Ruta de cierre (`POST /api/v1/closure`)
Blast radius: no se puede cerrar ni reabrir.
User impact: el bloque vuelve a su estado anterior con «No se pudo cerrar/reabrir…» y el aviso del store; ningún
mes cambia de estado.
Recovery: reintentar; con conflicto de revisión el store se resincroniza solo y el bloque refleja el estado real.

Component: Sesión (401)
Blast radius: todas las escrituras.
User impact: el flujo vigente de sesión expirada (`onSessionExpired`, BG-073) lleva al acceso.
Recovery: iniciar sesión; el libro del servidor no cambió.

Component: Sincronización (SSE)
Blast radius: un cambio hecho en otro dispositivo no llega en vivo.
User impact: la pantalla puede ofrecer algo ya inválido (un elemento borrado, un mes ya cerrado).
Recovery: las acciones lo rechazan en el dominio o en el servidor y la pantalla lo dice; los enlaces a elementos
inexistentes vuelven a Organizar.

**Riesgos principales**
1. **Borrar o cerrar por un toque accidental.** Mitigación: confirmación en la misma pantalla para borrar, cerrar y
   reabrir; el botón de confirmar nunca queda bajo el dedo que abrió la confirmación (el bloque sustituye al botón).
2. **Mover cambia los totales por grupo de meses cerrados.** Es la regla vigente de escritorio (las cifras de hoja
   no cambian; el reparto por grupo sí). No se altera aquí; se deja escrito para que la fase 3 no lo pruebe como
   defecto.
3. **Ancho en Linux.** La línea del título con dos botones cabe a 360 px con ~36 px de holgura en macOS; Linux mide
   el texto ~3 px más ancho por palabra. Mitigación: la prueba exige holgura ≥4 px y, si no la hay, el rótulo
   «Cierre» pasa a solo ícono con `aria-label` (declarado en la prueba, no improvisado).
4. **`MobileBudget` crece.** Mitigación en ADR-01.
5. **Dos mensajes en un fallo de cierre** (ADR-03). Aceptado: dicen cosas compatibles.

**Traceability Checklist**
- [x] FR-3201 a FR-3211: cada uno con componente y entrada en Implementation Approach.
- [x] NFR-3201 a NFR-3210: cada uno con su decisión de diseño.
- [x] Cinco ADR, todos con ≥2 opciones.
- [x] no_go_zone respetado: sin arrastre, sin reordenar hermanos, sin historial de cierres ni aviso de meses sin
  cerrar en el teléfono, sin dashboard, sin reglas nuevas, sin rutas ni esquema.
- [x] Failure Blast Radius para cuatro componentes.

## Technical Risk Flags

[RISK] El aviso de éxito del cierre no lleva el nombre del mes que pide el UX spec
Conflict: FR-3207 / FR-3208 (UX: «Septiembre cerrado») frente a NFR-3201: las acciones `closeMonth` / `reopenMonth`
del store emiten textos fijos que también usa escritorio.
Mitigation: ADR-03 — se conservan las acciones y sus textos; el mes queda nombrado en el botón, la confirmación y
el estado siguiente del bloque. Cambiarlo es una decisión del usuario que afecta a escritorio.
Severity: low

[RISK] Sin límite de longitud en el nombre
Conflict: FR-3203 / FR-3210 piden que un nombre de 60 caracteres no desborde; el dominio (`z.string()`) no pone
tope, así que un nombre de 300 caracteres también es válido.
Mitigation: el diseño no depende del largo: truncado en filas y `break-words` en identidad, confirmaciones y
motivos. No se añade un tope (sería una regla nueva, fuera de alcance).
Severity: low

[RISK] El ensayo de `moveNode` por candidato escala con nodos × movimientos
Conflict: FR-3206 frente al guardrail de inmediatez del teléfono (NFR-3107 de `presupuesto-movil`).
Mitigation: se calcula solo al abrir «Mover a…» y se memoiza; la fase 3 mide el tiempo con el libro semilla
completo y un diario de 1.000 movimientos, con un presupuesto de 150 ms.
Severity: low
