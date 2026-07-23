# BUILD_PLAN — Feature demote-node (Fase 4)

Bajar de nivel un nodo (degradar): el inverso de promote-to-group. Grupos arrastrables;
soltar un grupo dentro de otro grupo → categoría, dentro de una categoría → subcategoría,
SIEMPRE dentro del mismo tipo, y todo su subárbol baja el mismo delta. Se permite SOLO si el
subárbol cabe en el techo de 3 niveles; si desborda, se BLOQUEA con aviso (seam de política).

Decisión rectora (02_SYSTEM_DESIGN): **nivel = profundidad** (grupo=0, categoría=1, sub=2),
techo `destDepth + subtreeDepth(node) ≤ 2`. Solo el **origen GRUPO** toma el camino nuevo;
sub/categoría siguen por la lógica existente **sin tocar** (protege NFR-703 — el aplanado
categoría→categoría es una resolución de desborde que no se debe romper, ADR-03).

## Epics

### Epic 1 — Dominio: helper de cabida + seam + moveNode (FR-702, FR-703, NFR-701, NFR-703)
Archivos: `src/domain/tree.ts`, `src/domain/mutations.ts`
- `tree.subtreeDepth(nodes, id)` → 0 hoja / 1 hijos / 2 nietos (reusa `childrenOf`, corta ciclos).
- `mutations`: tipos `OverflowCtx` / `OverflowPolicy` + `blockPolicy` (default); `MoveResult` suma
  `"would_overflow"`; `moveNode(state,id,dest,overflow=blockPolicy)`: se quita el guard de grupos;
  rama nueva SOLO para `node.level==="group"` con dest categoría/grupo → cabida, re-nivelado por
  delta del subárbol (descendientes conservan `parentId`), o delega el desborde al seam.
- **Makes pass (unit):** TC-702h/e/f, TC-703h/e/f, TC-751h/e/f, TC-752h/e/f, TC-753h/e/f,
  TC-754h/e/f.

### Epic 2 — Store: propagar el motivo de rechazo nuevo (FR-703)
Archivo: `src/state/store.ts`
- `moveNode` action: el union de retorno suma `"would_overflow"`.
- **Makes pass:** cubierto por Epic 3 e2e (el store no tiene test unit propio de esta rama).

### Epic 3 — UI: grupos arrastrables + toast de bloqueo (FR-701)
Archivo: `src/components/BudgetGrid.tsx`
- `useDraggable` deja de deshabilitar grupos (`disabled: node.system`); `canDrag = !node.system`.
- `onDragEnd` mapea `"would_overflow"` → `showToast("Vacía o mueve las subcategorías primero")`.
- **Makes pass (e2e):** TC-701h/e/f.

### Manual (sin runner) — seguridad, sin superficie nueva (NFR-705)
- TC-755h/e/f: 0 rutas /api nuevas, 0 columnas/tablas, guardado por `saveLedger`. Se verifican a
  mano en `verify-run` (revisión del diff).

## Cobertura de TCs
24 TCs: 9 FR (701/702/703 × h/e/f), 12 NFR unit (751–754 × h/e/f), 3 NFR-705 manual.

## Estado — todos los epics DONE
- Epic 1 (dominio) ✅ — `subtreeDepth` + seam + `moveNode`; 19 unit verdes (TC-702/703/751/752/753/754).
- Epic 2 (store) ✅ — `moveNode` propaga `would_overflow`; typecheck limpio.
- Epic 3 (UI) ✅ — grupos arrastrables + toast; 3 e2e verdes (TC-701h/e/f).
- Regresión: 205/205 unit verdes; reparent + promote-to-group e2e verdes; lint limpio.
- Un test del pipeline raíz actualizado (move-dashboard-seed TC-015f) al nuevo contrato (grupo cross-type → `cross_type`).

## Riesgos (del diseño)
- Regresión del reparent → mitigado: solo origen grupo entra al camino nuevo.
- Cabida mal calculada → `subtreeDepth` probado en aislamiento + TC-703f (no falso positivo).
- Seam ignorado → TC-751h/e/f prueban la sustitución de política mecánicamente.
