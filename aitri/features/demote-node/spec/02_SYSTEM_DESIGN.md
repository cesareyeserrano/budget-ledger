# Technical Design Document (TRD / SDD) — Feature demote-node

## Executive Summary

Incremento de dominio puro + UI que completa el reparent permitiendo BAJAR de nivel un nodo (degradar), el inverso de promote-to-group. Cero cambios server-side, cero migración de esquema.

Decisión rectora: **nivel = profundidad**, y el árbol tiene un techo de 3 niveles (grupo=0, categoría=1, subcategoría=2). Bajar un nodo desplaza la profundidad de TODO su subárbol por un delta fijo. La regla dura es aritmética: `profundidadDestino + profundidadDelSubárbol(nodo) ≤ 2`. Si se cumple, el movimiento cabe y se re-nivela; si no, DESBORDA.

Pieza de extensibilidad (requisito explícito del usuario, NFR-701): el manejo del desborde vive detrás de un **SEAM de política enchufable** — `moveNode` delega la decisión de desborde a una `OverflowPolicy` (estrategia nombrada). La única política provista es `blockPolicy` (rechaza sin tocar el estado). Políticas futuras (reasignar a la zona de no-asignados, aplanar) se registran como una estrategia nueva **sin reescribir** el algoritmo de cabida ni de re-nivelado — evita el mega-refactor.

Tecnologías (todas ya en el proyecto): TypeScript 5 (dominio puro), Zustand, @dnd-kit, vitest + Playwright.

## System Architecture

```
   Arrastre de un grupo         ┌──────────────────────────────────────────┐
   ───────────────────────────▶ │            UI (BudgetGrid)               │
                                 │  · NodeRow: grupos arrastrables (FR-701) │
                                 │  · onDragEnd: mapea would_overflow→toast │  FR-703
                                 └───────────────┬──────────────────────────┘
                                                 │ store.moveNode(id, dest)
                                                 ▼
                                 ┌──────────────────────────────────────────┐
                                 │        Dominio (src/domain)              │
                                 │  tree.subtreeDepth(node)   ── cabida     │  FR-702
                                 │  mutations.moveNode(state,id,dest,policy)│
                                 │    1. valida tipo/ancestro (existente)   │
                                 │    2. ¿cabe? destDepth+subDepth ≤ 2      │
                                 │    3a. cabe → re-nivela subárbol (delta) │
                                 │    3b. no cabe → policy(ctx)  ◄── SEAM   │  NFR-701
                                 │  OverflowPolicy: blockPolicy (default)   │
                                 └───────────────┬──────────────────────────┘
                                                 │ snapshot completo
                                                 ▼
                                 LocalStorageRepository | ServerRepository (sin cambios)
```

Componentes:
- **tree.subtreeDepth** — nuevo helper: profundidad máxima del subárbol bajo un nodo (0 = hoja, 1 = tiene hijos, 2 = tiene nietos). Reutiliza el recorrido existente (childrenOf).
- **mutations.moveNode** — deja de rechazar grupos como origen; agrega el chequeo de cabida y el re-nivelado por delta para el caso de degradación de grupo; delega el desborde al seam.
- **OverflowPolicy (seam)** — tipo de estrategia + `blockPolicy` por defecto; punto de extensión documentado.
- **BudgetGrid** — grupos arrastrables; `onDragEnd` traduce `would_overflow` al toast.

## Data Model

**Contrato de preservación (NO cambia):** `LedgerNode {id, ownerId, type, level, parentId, name, icon, order}`, mapas `budgets/actuals[id][month]`, `movements[]` con `target = subId ?? catId`, claves `ledger.nodes.v1`/`ledger.budget.v2`. Un ledger previo carga sin migración: la degradación solo cambia `level`/`parentId` de nodos existentes.

**Delta introducido:** ninguno en el esquema. La degradación reescribe `level` y `parentId` de un subconjunto de nodos (el subárbol movido) y nada más; los montos viajan con sus nodos por id (cero pérdida). El invariante padre == Σ hojas se mantiene por construcción (solo cambia la posición, no los montos-hoja).

## API Design

**Contrato preservado:** `rollupBudget/Actual/typeTotals`, `setLeafAmount`, `deleteNode/canDeleteNode`, `addMovement` — sin cambios de comportamiento. Las ramas existentes de `moveNode` para origen sub/categoría (incluido el aplanado categoría→categoría) se conservan idénticas (NFR-703).

**Firmas nuevas/cambiadas (dominio, TS idiomático):**

```ts
// tree.ts — profundidad del subárbol (0=hoja, 1=hijos, 2=nietos). FR-702
export function subtreeDepth(nodes: LedgerNode[], nodeId: string): number;

// mutations.ts — el seam de política de desborde (NFR-701)
export type OverflowCtx = {
  state: LedgerState; nodeId: string; dest: MoveDest; delta: number;
};
export type OverflowPolicy = (ctx: OverflowCtx) =>
  | { kind: "block" }                    // rechaza; el estado no cambia
  | { kind: "resolve"; state: LedgerState }; // política futura: produce un estado resuelto
export const blockPolicy: OverflowPolicy;  // única política provista hoy

// mutations.ts — moveNode admite grupo como origen + un motivo de rechazo nuevo
export type MoveResult =
  | { state: LedgerState }
  | { rejected: "cross_type" | "invalid_target" | "would_overflow" }; // +would_overflow
export function moveNode(
  state: LedgerState, id: string, dest: MoveDest,
  overflow: OverflowPolicy = blockPolicy   // ◄── SEAM: default block; futura política se enchufa aquí
): MoveResult;

// store.ts — la acción refleja el nuevo motivo de rechazo (para el toast)
moveNode: (id: string, dest: MoveDest) => "ok" | "cross_type" | "invalid_target" | "would_overflow";
```

Niveles como profundidad: `depth(group)=0, category=1, sub=2`. Profundidad destino: `root→0, group→1, category→2`. Cabida: `destDepth + subtreeDepth(node) ≤ 2`.

## Implementation Approach

**FR-701 — Grupos arrastrables.** En `BudgetGrid`, `useDraggable` deja de deshabilitar los grupos (`disabled: node.system` en vez de `node.level === "group" || node.system`); `canDrag` incluye grupos no-system. La afordancia grab y el realce de destino ya existen y se reutilizan. `onDragStart/onDragEnd` no cambian de forma salvo el manejo de `would_overflow`.

**FR-702 — moveNode con origen grupo + cabida + re-nivelado.** Se retira el guard `if (node.level === "group") return invalid_target`. Para el destino de reparent (kind category/group) con un nodo cualquiera: se calcula `destDepth` (category→2, group→1), `delta = destDepth - depth(node)`. Si `delta ≤ 0` (subir/lateral) el flujo es el existente (no lo tocamos). Si `delta > 0` (bajar): se evalúa la cabida `destDepth + subtreeDepth(node) ≤ 2`. Si cabe, se re-nivela: para cada nodo del subárbol (subtreeIds), `nivel_nuevo = depthToLevel(depth_actual + delta)`; el nodo movido toma `parentId = dest.id`, los descendientes conservan su `parentId` (estructura relativa intacta). Preserva ids de nodo y de movimiento → cero huérfanos. Cross-type y ancestro se rechazan antes (lógica existente reutilizada).

**FR-703 — Bloqueo por desborde (vía seam).** Si `delta > 0` y NO cabe, `moveNode` invoca `overflow({state, nodeId, dest, delta})`. `blockPolicy` devuelve `{kind:"block"}` → `moveNode` retorna `{rejected:"would_overflow"}` y el estado queda intacto. Una política futura devolvería `{kind:"resolve", state}` con el desborde resuelto (p.ej. nietos reasignados) y `moveNode` retorna `{state}` — sin cambiar nada del algoritmo de cabida/re-nivelado. En la UI, `onDragEnd` mapea `"would_overflow"` a `showToast("Vacía o mueve las subcategorías primero")`.

**NFR-701 — El seam.** El punto de extensión es el parámetro `overflow: OverflowPolicy` de `moveNode` (default `blockPolicy`). Un test sustituye la política por una de prueba (`{kind:"resolve", state: markerState}`) y verifica que `moveNode` la usa en el caso de desborde — evidencia mecánica de que el seam es funcional y que una política nueva se enchufa sin tocar el core.

## Security Design

Sin superficie nueva: no se agregan rutas `/api`, ni campos persistidos, ni dependencias. La degradación es una transformación en memoria sobre datos ya propios del usuario. En modo servidor la persistencia sigue por `saveLedger(ownerId, snapshot)` con el `ownerId` fijado por el servidor (FR-508). Validación intacta: montos por `setLeafAmount`/`addMovement`, nombres por `nodeNameSchema`. Sin HTML dinámico ni SQL nuevo.

## Performance & Scalability

El grafo es pequeño (decenas de nodos). `subtreeDepth` y el re-nivelado son O(tamaño del subárbol); `moveNode` sigue siendo O(nodos) como hoy. Sin nuevas consultas ni I/O; el guardado es el snapshot-replace existente. El re-render de la grilla tras una degradación se mantiene bajo el guardrail de 150ms (NFR-001 del padre) porque el conjunto de nodos no crece.

## Deployment Architecture

**Modelo de despliegue: sin cambios.** La app Next.js se despliega igual (contenedor Docker para modo servidor; estático/localStorage para offline). Esta feature es solo código de cliente/dominio: sin variables de entorno, servicios ni pasos de build nuevos; `Dockerfile`/`docker-compose.yml` no cambian; compatibilidad de datos sin migración.

## Risk Analysis

**Riesgo 1 — Romper el reparent existente al retirar el guard de grupos.** El aplanado categoría→categoría y los movimientos de subir/lateral deben quedar idénticos (NFR-703). Mitigación: solo el caso `delta > 0` (bajar) toma el nuevo camino de cabida/re-nivelado; `delta ≤ 0` (subir/lateral, todos los casos existentes) sigue por la lógica actual sin cambios. Severidad: media.

**Riesgo 2 — Cabida mal calculada (falso positivo/negativo).** Un error en `subtreeDepth` o en la aritmética bloquearía movimientos válidos o permitiría desbordes. Mitigación: `subtreeDepth` probado en aislamiento; FR-703 cubre happy (bloqueo correcto) y negative (un movimiento que cabe NO se bloquea). Severidad: media.

**Riesgo 3 — El seam se filtra o se ignora.** Si `moveNode` decidiera el desborde en línea en vez de delegar, la extensibilidad (NFR-701) se pierde. Mitigación: la decisión de desborde SOLO ocurre invocando `overflow(ctx)`; un test con una política sustituta prueba que se la respeta. Severidad: baja.

**ADR-01: Chequeo de cabida — aritmético anticipado vs. mover-y-validar.**
Context: decidir si una degradación cabe en el techo de 3 niveles.
Option A: calcular `destDepth + subtreeDepth(node) ≤ 2` ANTES de mover. Tradeoffs: barato, predecible, no muta hasta saber que cabe; requiere un helper de profundidad.
Option B: aplicar el re-nivelado y luego validar que ningún nodo excede el nivel 2, revertir si no. Tradeoffs: no necesita helper, pero muta-y-revierte (más frágil, clona de más) y mezcla "intentar" con "validar".
Decisión: **A**. Consecuencia: se agrega `subtreeDepth`; la pureza de "no mutar si no cabe" es trivial.

**ADR-02: Manejo del desborde — política enchufable (seam) vs. bloqueo incrustado.**
Context: hoy el desborde se bloquea; el usuario pidió poder agregar reglas futuras sin mega-refactor.
Option A: `OverflowPolicy` como parámetro de `moveNode` con default `blockPolicy`; una política nueva se registra y se pasa, sin tocar el algoritmo. Tradeoffs: un tipo y un parámetro extra; extensible por diseño.
Option B: incrustar `return {rejected:"would_overflow"}` en `moveNode` y agregar ramas cuando lleguen reglas nuevas. Tradeoffs: más simple hoy; pero cada regla futura edita el core de `moveNode` (el mega-refactor que el usuario quiere evitar).
Decisión: **A**. Consecuencia: cumple NFR-701; el core queda cerrado a modificación, abierto a extensión.

**ADR-03: Camino de degradación — dedicado vs. unificar toda la lógica de move.**
Context: agregar la degradación de grupos sin romper las ramas existentes.
Option A: el caso `delta > 0` (bajar) toma un camino nuevo (cabida + re-nivelado + seam); las ramas existentes (subir/lateral, incluido el aplanado categoría→categoría) quedan intactas.
Option B: unificar todos los orígenes bajo un único desplazamiento de profundidad general. Tradeoffs: más elegante, pero el aplanado categoría→categoría existente ES en sí una resolución de desborde; unificar lo convertiría en "block" y rompería NFR-703.
Decisión: **A**. Consecuencia: cero regresión del reparent existente; el seam se estrena en el camino de degradación.

## Technical Risk Flags

[RISK] Regresión del reparent existente al habilitar grupos como origen
Conflict: NFR-703 exige que sub→categoría, categoría→categoría/grupo y la promoción a grupo no cambien, pero se retira el guard que rechazaba grupos y se agrega un camino de re-nivelado.
Mitigation: solo el caso delta>0 (bajar) toma el camino nuevo; todos los casos existentes (delta≤0) siguen por la lógica actual sin cambios. NFR-702/703 se prueban con happy/negative.
Severity: medium

[RISK] Cálculo de cabida incorrecto (subtreeDepth / aritmética de profundidad)
Conflict: FR-702/703 dependen de decidir con exactitud si un subárbol cabe; un error bloquearía válidos o permitiría desbordes (rompe el techo de 3 niveles).
Mitigation: subtreeDepth probado en aislamiento; FR-703 cubre el bloqueo correcto y el no-falso-positivo (un movimiento que cabe no se bloquea).
Severity: medium

[RISK] El seam de política ignorado (extensibilidad perdida)
Conflict: NFR-701 exige que el desborde se decida vía una política enchufable, no en línea.
Mitigation: la decisión de desborde solo ocurre invocando overflow(ctx); un test sustituye la política y verifica que moveNode la respeta.
Severity: low

## Traceability Checklist
- FR-701 (grupos arrastrables) → System Architecture, Implementation Approach (BudgetGrid)
- FR-702 (moveNode origen grupo + cabida + re-nivelado) → API Design, Implementation Approach, ADR-01/03
- FR-703 (bloqueo por desborde) → Implementation Approach, ADR-02, seam
- NFR-701 (seam de política) → API Design (OverflowPolicy), Implementation Approach, ADR-02, RISK #3
- NFR-702/703/704 (regresión) → Risk Analysis, Technical Risk Flags, ADR-03
- NFR-705 (seguridad) → Security Design
- no_go_zone: no reintroducir zona no-asignados (solo el seam), no forzar desbordes, no cruzar tipo → ADR-02 (block default) + validación cross-type existente.
