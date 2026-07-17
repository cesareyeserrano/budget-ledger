# Technical Design Document (TRD / SDD) — Feature promote-to-group

## Executive Summary

Incremento sobre el dominio TypeScript puro del Ledger (grupo > categoría > subcategoría). **Cero cambios de stack y cero cambios server-side:** toda la lógica vive en `src/domain` (tree/rollup/mutations) + la UI de grilla (`BudgetGrid.tsx`) y de registro (`register/CategoryRow.tsx`). El servidor sigue persistiendo el snapshot completo que el cliente envía (`saveLedger`, aislamiento por `ownerId`, FR-508) sin conocer esta feature.

Decisión rectora: **el nivel de un nodo es su profundidad, y la editabilidad se deriva de la posición, no de una bandera nueva.** Hacer que un grupo *sin hijos* sea hoja (`isLeaf`) hace editable su presupuesto/ejecutado y lo incluye en el roll-up **sin migración de datos ni cambio de esquema**. El movimiento de montos reutiliza el patrón ya probado de FR-002 (traslado categoría→sub), extendido a grupo→primer-hijo, con su reverso emergente a 0. La promoción a grupo extiende el `moveNode` existente con un destino tipo-raíz.

Tecnologías (todas ya en el proyecto, sin versión nueva): TypeScript 5 (dominio puro), Zustand (store), @dnd-kit (drag-drop, la fila de tipo se vuelve `useDroppable`), vitest (unit) + Playwright (e2e).

## System Architecture

```
                     ┌─────────────────────────────────────────────┐
   Arrastre / clic   │                  UI (cliente)               │
   ───────────────▶  │  BudgetGrid.tsx        register/CategoryRow │
                     │  · TypeTotalRow =      · destino incluye     │
                     │    useDroppable         grupos sin hijos     │
                     │    id root:{type}      (FR-606)              │
                     │  · celda editable si                         │
                     │    isLeaf(grupo)  (FR-603)                   │
                     └───────────────┬─────────────────────────────┘
                                     │ acciones del store (Zustand)
                                     ▼
                     ┌─────────────────────────────────────────────┐
                     │           Dominio TS puro (src/domain)      │
                     │  tree.ts     isLeaf(grupo sin hijos)=hoja   │  FR-603
                     │  rollup.ts   usa monto propio del grupo-hoja│  FR-603
                     │  mutations   moveNode(dest root:'group')    │  FR-601/602
                     │              createNode: traslado 1er hijo  │  FR-604
                     │              (grupo→cat, mismo patrón FR-002)│
                     │              deleteNode/moveNode: reverso    │  FR-605
                     │              addMovement: target = grupo-hoja│  FR-606
                     └───────────────┬─────────────────────────────┘
                                     │ snapshot completo
                                     ▼
                     ┌─────────────────────────────────────────────┐
                     │   Repositorio (swap sin cambios)            │
                     │   LocalStorageRepository | ServerRepository │
                     │   → saveLedger(ownerId, snapshot)  (FR-508) │
                     └─────────────────────────────────────────────┘
```

Componentes y responsabilidad:
- **tree.ts / `isLeaf`** — única fuente de verdad de "qué es hoja". Cambio: un grupo sin hijos es hoja.
- **rollup.ts** — ya ramifica por `isLeaf` (`isLeaf ? [self] : leafDescendants/subtreeIds`); hereda el cambio sin tocar su código salvo verificación.
- **mutations.ts** — `moveNode` (nuevo destino), `createNode` (traslado al primer hijo de un grupo), `addMovement` (permite target grupo-hoja); el reverso a 0 es emergente.
- **BudgetGrid.tsx** — `TypeTotalRow` droppable; celda editable cuando el nodo es grupo-hoja.
- **register/CategoryRow.tsx** — lista grupos sin hijos como destino.

## Data Model

**Contrato de preservación (NO cambia):** el esquema `LedgerNode { id, ownerId, type, level, parentId, name, icon, order, system? }`, los mapas `budgets[id][month]` / `actuals[id][month]`, el journal `movements[]` con `target = subId ?? catId`, y las claves persistidas `ledger.nodes.v1` / `ledger.budget.v2`. **Sin migración:** un ledger guardado antes de la feature carga igual — un grupo con hijos sigue siendo no-hoja (calculado); un grupo sin hijos pasa a editable pero, al no tener entrada en `budgets/actuals`, lee 0 (correcto por FR-605).

**Delta introducido (solo semántica, sin campos nuevos):**
- `budgets[groupId]` / `actuals[groupId]` pasan a ser válidos y significativos **cuando el grupo no tiene hijos** (antes se ignoraban). Se crean perezosamente al primer `setLeafAmount`/`addMovement` sobre el grupo, y `createNode` de un grupo los inicializa `{}` (igual que hoy hace con categoría/sub).
- Invariante reforzado: para todo nodo con hijos, no existe `budgets[id]`/`actuals[id]` propio (los montos viven en hojas). El traslado al primer hijo y el borrado al perder el último lo mantienen.

## API Design

**Contrato preservado (firmas públicas que NO cambian su comportamiento existente):** `rollupBudget/rollupActual/typeTotals`, `setLeafAmount(state, leafId, month, kind, value)`, `deleteNode/canDeleteNode`, `renameNode/setNodeIcon`, `addMovement(state, input)`. Siguen dando el mismo resultado para categorías/subs.

**Firmas que cambian o se agregan (dominio, estilo idiomático TS):**

```ts
// tree.ts — un grupo SIN hijos es hoja (FR-603)
export function isLeaf(node: LedgerNode, nodes: LedgerNode[]): boolean;
//   sub → true; category → sin hijos; group → sin hijos (NUEVO); antes group→false

// mutations.ts — moveNode admite destino tipo-raíz (promoción a grupo) (FR-601/602)
export type MoveDest =
  | { kind: "category"; id: string }
  | { kind: "group"; id: string }
  | { kind: "root"; type: NodeType };            // NUEVO: soltar en la fila de tipo
export function moveNode(state: LedgerState, id: string, dest: MoveDest): MoveResult;
//   dest.kind==="root": node.level="group", parentId=null, icon="folder";
//   hijos directos ascienden un nivel (sub→category); rechaza cross-type; preserva ids.

// store.ts — la acción refleja la nueva firma
moveNode: (id: string, dest: MoveDest) => void;

// mutations.ts — createNode traslada montos del GRUPO a su primera categoría (FR-604)
//   (misma lógica ya existente para categoría→1ª sub, generalizada a grupo→1ª categoría)

// register/CategoryRow.tsx — el selector incluye grupos sin hijos (FR-606)
//   destinos = categorías (con subs)  ∪  grupos con childrenOf(g).length===0
```

`addMovement`: sin cambio de firma; `input.catId` puede ser ahora el id de un grupo-hoja; `target = subId ?? catId` resuelve al grupo y `actuals[target]` se incrementa igual que cualquier hoja.

## Implementation Approach

**FR-601/FR-602 — Promover a grupo.** `TypeTotalRow` se registra como `useDroppable` con id `root:{type}`. `onDragEnd` en `BudgetGrid` mapea ese id a `moveNode(activeId, { kind:"root", type })`. En dominio: si `node.type !== dest.type` → `rejected:"cross_type"` (sin mutar). Si compatible: clonar, poner `moved.level="group"`, `parentId=null`, `icon="folder"`; para cada hijo directo (`childrenOf(moved)`) subir un nivel (`sub`→`category`). Se preservan ids de nodo y `movements` (target sigue válido) → cero huérfanos. Los montos de `moved`, si era hoja, permanecen en `budgets/actuals[moved.id]` (ahora grupo-hoja); si tenía hijos, viven en las hojas que ascendieron.

**FR-603 — Grupo-hoja editable.** `isLeaf(group)` = `!childrenOf(group).length`. `setLeafAmount` ya gatea por `isLeaf` → acepta el grupo sin hijos. La celda en `BudgetGrid` abre editor cuando `isLeaf(node)` (regla ya existente para hojas). `rollupBudget/Actual` ya usan la rama `isLeaf ? [self] : …` → cuentan el monto propio del grupo-hoja. Failure: si un grupo con hijos recibiera un `setLeafAmount` (no debería desde la UI), `isLeaf` es false → no-op (defensa en profundidad).

**FR-604 — Traslado al primer hijo.** Generalizar el bloque existente de `createNode` (hoy: 1ª sub de una categoría-hoja) para cubrir también la 1ª **categoría** de un grupo con montos: si el padre no tenía hijos del nivel hijo y tenía `budgets/actuals` propios, mover esos mapas al hijo nuevo y `delete` los del padre. El total no cae (mismo mapa, otra clave). Reconciliación: un nodo promovido a grupo **sin** hijos NO dispara traslado (conserva sus montos como grupo-hoja) — el traslado solo ocurre al agregar el primer hijo después. Igual tratamiento cuando el primer hijo llega por `moveNode` (destino `kind:"group"`): esa rama debe aplicar el mismo traslado si el grupo destino era hoja con montos.

**FR-605 — Reverso a 0.** Emergente, sin código nuevo dedicado: al borrar (`deleteNode`) o mover fuera (`moveNode`) el último hijo, el grupo queda con 0 hijos → `isLeaf` true otra vez → editable. Como sus montos se trasladaron al hijo al ganarlo (FR-604), no hay `budgets/actuals[groupId]` → lee 0. Verificación: `deleteNode` ya retira `budgets/actuals/movements` del subárbol borrado (fix BG-006); `moveNode` preserva los del hijo que sale. En ningún caso el grupo reabsorbe montos (no_go_zone).

**FR-606 — Registro.** `CategoryRow` amplía su filtro de destinos de nivel 1 a `n.level==="category" || (n.level==="group" && childrenOf(state.nodes,n.id).length===0)`. El grupo-hoja se pinta con su ícono `folder`. `addMovement` no cambia. Un grupo con hijos nunca se lista.

## Security Design

Sin superficie nueva. No se agregan rutas `/api` ni campos persistidos. En modo servidor, el guardado sigue pasando por `saveLedger(ownerId, snapshot)` con el `ownerId` fijado por el servidor (nunca por el payload), preservando el aislamiento estructural (FR-508). Validación de entrada: los montos siguen pasando por `setLeafAmount` (`Math.max(0, round(...))`) y `addMovement` (`parseAmount`, rechaza negativos); nombres por `nodeNameSchema`. La promoción es una transformación de estado en memoria sobre datos ya propios del usuario — no cruza límites de confianza. XSS/inyección: sin cambios (no hay HTML dinámico ni SQL nuevo; Drizzle parametrizado en el path de guardado existente).

## Performance & Scalability

El grafo es pequeño (decenas de nodos, 12 meses, un usuario). `moveNode` es O(hijos directos); `isLeaf` es O(nodos) por el `childrenOf` — igual que hoy, sin regresión. El re-render de la grilla tras una promoción se mantiene bajo el guardrail de 150ms (NFR-001/NFR-605) porque el conjunto de nodos no crece y el roll-up ya es memoizado por selector. Sin nuevas consultas ni I/O; el guardado sigue siendo un snapshot-replace ya existente.

## Deployment Architecture

**Modelo de despliegue: sin cambios.** La app Next.js se despliega igual que hoy (contenedor Docker existente para modo servidor; estático/localStorage para modo offline). Esta feature es solo código de cliente/dominio: no agrega variables de entorno, servicios, ni pasos de build. CI/CD y `Dockerfile`/`docker-compose.yml` no cambian. Compatibilidad de datos garantizada (sin migración de esquema).

## Risk Analysis

**Riesgo 1 — Blast radius de `isLeaf` (el cambio más sensible).** `isLeaf` lo consumen `rollupBudget`, `rollupActual`, `typeTotals`, `setLeafAmount`, `leafDescendants` y la editabilidad de la grilla. Un grupo sin hijos ahora es hoja en TODOS. Mitigación: se auditó cada consumidor — ninguno doble-cuenta (un grupo-hoja no tiene descendientes, así que aparece exactamente una vez en `leafDescendants`/`typeTotals`); NFR-602 (padre==Σhojas, cero huérfanos) se prueba en Fase 3 sobre todas las transiciones. Severidad: media.

**Riesgo 2 — Traslado no aplicado al ganar el primer hijo vía `moveNode`.** Si solo se generaliza `createNode` y se olvida la rama `moveNode(kind:"group")`, un grupo-hoja con montos que gana su primer hijo por arrastre dejaría montos propios + un hijo → doble conteo. Mitigación: la Implementation Approach exige el traslado en AMBAS entradas; TC de Fase 3 cubre "grupo-hoja con montos + primer hijo por promoción". Severidad: alta.

**Riesgo 3 — Regresión del reparent existente.** Cambiar la firma de `moveNode` (dest union) podría romper `sub→categoría` / lateral. Mitigación: NFR-604 protege el comportamiento existente con tests; la union es aditiva (los kinds `category`/`group` quedan idénticos). Severidad: media.

**ADR-01: Editabilidad del grupo-hoja — derivada de posición vs. bandera explícita.**
Context: un grupo sin hijos debe ser editable; con hijos, calculado.
Option A: extender `isLeaf` (editabilidad = profundidad/posición, sin campo nuevo). Tradeoffs: cero migración, una sola fuente de verdad, hereda a todos los consumidores automáticamente; riesgo de blast radius que hay que auditar.
Option B: agregar un campo `editable`/`ownAmount` al nodo. Tradeoffs: explícito; pero exige migración del estado persistido, un segundo estado que sincronizar con la posición (fuente de verdad duplicada, justo lo que causó bugs de estado antes).
Decisión: **A**. Consecuencia: sin migración; obliga a auditar consumidores de `isLeaf` (hecho en Riesgo 1).

**ADR-02: Propiedad del monto en transiciones — traslado a hoja vs. monto propio permanente del grupo.**
Context: al ganar/perder hijos, ¿de quién es el monto?
Option A: los montos SIEMPRE viven en hojas por id; se trasladan al primer hijo y el grupo queda en 0 al perder el último (mismo patrón que FR-002). Tradeoffs: preserva el invariante padre==Σhojas por construcción; reusa código probado.
Option B: el grupo mantiene un `ownAmount` separado que se suma/oculta según tenga hijos. Tradeoffs: más "intuitivo" pero rompe el invariante (padre tendría monto propio + hijos) y reintroduce reparto proporcional (no_go_zone).
Decisión: **A**. Consecuencia: FR-604/605 son un traslado + un reverso emergente; nada reabsorbe montos.

**ADR-03: Promoción a grupo — extender `moveNode` vs. función nueva.**
Context: convertir un nodo en grupo por drag-drop.
Option A: extender `moveNode` con `dest.kind:"root"` y un droppable `root:{type}` en la fila de tipo. Tradeoffs: un solo punto de entrada de reparent, consistente con el dnd existente y con `onDragEnd`.
Option B: `promoteToGroup(id)` separada + su propio handler. Tradeoffs: dos caminos de reparent divergentes que mantener y probar; duplica validación cross-type/ancestro.
Decisión: **A**. Consecuencia: la union de destino es aditiva; los kinds existentes no cambian.

## Technical Risk Flags

[RISK] Blast radius de isLeaf sobre el roll-up
Conflict: FR-603 requiere que un grupo sin hijos sea hoja editable, pero `isLeaf` es consumido por `rollupBudget`, `rollupActual`, `typeTotals`, `leafDescendants` y `setLeafAmount`; un cambio incorrecto podría doble-contar o romper el invariante padre==Σhojas (NFR-602).
Mitigation: `isLeaf` es la única fuente de verdad y ya ramifica el roll-up; un grupo-hoja no tiene descendientes, por lo que aparece exactamente una vez. Fase 3 prueba el invariante y cero huérfanos en todas las transiciones (crear 1er hijo, borrar/mover último hijo, promover).
Severity: medium

[RISK] Traslado omitido en la rama moveNode al ganar el primer hijo
Conflict: FR-604 requiere trasladar los montos del grupo-hoja a su primer hijo, pero el primer hijo puede llegar por DOS caminos (createNode y moveNode kind:'group'); implementar solo uno deja doble conteo.
Mitigation: la Implementation Approach exige el traslado en ambas entradas; TC dedicado "grupo-hoja con montos + primer hijo por promoción".
Severity: high

[RISK] Regresión del reparent existente por el cambio de firma de moveNode
Conflict: NFR-604 exige que sub→categoría, lateral de categoría y el comportamiento cross-type actuales no cambien, pero `moveNode` cambia su tipo de destino a una union.
Mitigation: la union es aditiva (kinds `category`/`group` idénticos); NFR-604 protege el comportamiento existente con tests happy/negative.
Severity: medium

[RISK] Compatibilidad de estado persistido sin migración
Conflict: la constraint de compatibilidad exige que ledgers `ledger.nodes.v1/budget.v2` previos carguen sin migración, pero ahora `budgets[groupId]` cobra significado.
Mitigation: sin campos nuevos; un grupo con hijos sigue siendo no-hoja (sus posibles montos previos, inexistentes por diseño, se ignoran igual); un grupo sin hijos sin entrada en budgets lee 0. Verificado en Data Model.
Severity: low

## Traceability Checklist
- FR-601 (promover a grupo) → System Architecture, Implementation Approach, ADR-03
- FR-602 (moveNode re-nivela hijos) → API Design, Implementation Approach
- FR-603 (grupo-hoja editable) → tree/rollup, Implementation Approach, ADR-01
- FR-604 (traslado 1er hijo) → Implementation Approach, ADR-02, RISK #2
- FR-605 (reverso a 0) → Implementation Approach (emergente), ADR-02
- FR-606 (destino en registro) → API Design, Implementation Approach
- NFR-601..605 (regresión) → Risk Analysis, Technical Risk Flags
- NFR-606 (seguridad) → Security Design
- no_go_zone: no degradación, no reparto proporcional, no reabsorción → ADR-02/ADR-03 excluyen explícitamente estas rutas.
